mod archive;
mod commands;
mod drive_watcher;
mod file_ops;
mod indexer_worker;
pub mod settings;
#[cfg(windows)]
mod shell_integration;
mod state;
mod terminal;
mod watcher;

use state::AppState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    let db_path = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("chimaera-files")
        .join("index.db");

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let (app_state, index_rx) =
        AppState::new(&db_path).expect("failed to initialize database");

    // If the process was launched from the shell with a path argument
    // (e.g. via our "Open in Chimaera" right-click verb), stash it so the
    // frontend can pick it up on mount.
    if let Some(path) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
        if let Ok(mut slot) = app_state.pending_open_path.lock() {
            *slot = Some(path);
        }
    }

    let watchers_for_startup = app_state.journal_watchers.clone();
    let db_path_for_startup = db_path.clone();
    let db_path_for_worker = db_path.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus the existing window and, if launched with a path argument
            // (e.g. from the `OpenInChimaera` shell verb), tell the frontend
            // to navigate there.
            use tauri::Emitter;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            if let Some(path) = args.iter().skip(1).find(|a| !a.starts_with('-')) {
                let _ = app.emit("open-path", path.clone());
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(app_state)
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            // Open devtools in debug mode
            #[cfg(debug_assertions)]
            window.open_devtools();

            // Apply Mica Dark backdrop
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_mica;
                apply_mica(&window, Some(true)).ok();
            }

            // Register global hotkeys.
            //   Win+E         → focus main window
            //   Ctrl+Shift+K  → toggle the launcher popup (Spotlight-style)
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
                let win_for_hotkey = window.clone();
                let main_shortcut: Shortcut = "Super+E".parse().unwrap();
                let _ = app.global_shortcut().on_shortcut(main_shortcut, move |_app, _shortcut, _event| {
                    let _ = win_for_hotkey.show();
                    let _ = win_for_hotkey.set_focus();
                });

                let app_for_launcher = app.handle().clone();
                let launcher_shortcut: Shortcut = "Ctrl+Shift+K".parse().unwrap();
                let _ = app.global_shortcut().on_shortcut(
                    launcher_shortcut,
                    move |_app, _shortcut, event| {
                        // `on_shortcut` fires for both Pressed and Released —
                        // only toggle on Pressed so one key stroke = one toggle.
                        use tauri_plugin_global_shortcut::ShortcutState;
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }
                        if let Some(lw) = app_for_launcher.get_webview_window("launcher") {
                            if lw.is_visible().unwrap_or(false) {
                                let _ = lw.hide();
                            } else {
                                let _ = lw.show();
                                let _ = lw.set_focus();
                            }
                        }
                    },
                );
            }

            // Start the serial indexer worker. One drive scans at a time
            // so multiple `toggle_drive_index` requests don't contend for
            // SQLite's write lock.
            let active_index_for_worker = app.state::<AppState>().active_index.clone();
            let pauses_for_worker = app.state::<AppState>().drive_pause_flags.clone();
            indexer_worker::spawn(
                db_path_for_worker.clone(),
                app.handle().clone(),
                index_rx,
                active_index_for_worker,
                pauses_for_worker,
            );

            // Per-drive startup behavior driven by `DriveSyncMode`:
            //   Auto  → realtime watcher; auto-enqueue if last scan incomplete
            //   Timed → realtime watcher; spawn periodic-rescan timer thread
            //   Manual → no automatic activity at all
            //
            // The watcher and timer share a single per-drive stop flag stored
            // in `journal_watchers` so `toggle_drive_index(false)` stops both.
            {
                use indexer_worker::IndexCommand;
                use settings::DriveSyncMode;
                let state: tauri::State<AppState> = app.state();

                // Defensive: a drive marked `fully_scanned` but whose
                // folder_stats row is missing (or has `file_count = 0`) is
                // lying — the earlier global-wipe `compute_all` bug could
                // leave drives in this zombie state, and an interrupted
                // scan can leave a `folder_stats` row populated with zero
                // counts. Drop the stale flag either way so the Auto
                // branch below re-enqueues.
                {
                    let mut cfg = settings::load();
                    let conn = state.db_lock();
                    let before = cfg.fully_scanned_drives.len();
                    cfg.fully_scanned_drives.retain(|d| {
                        let trimmed = d.replace('\\', "/");
                        let trimmed = trimmed.trim_end_matches('/');
                        let count: i64 = conn
                            .query_row(
                                "SELECT fs.file_count FROM folder_stats fs
                                 JOIN files f ON f.id = fs.folder_id
                                 WHERE f.path = ?1",
                                [trimmed],
                                |row| row.get(0),
                            )
                            .unwrap_or(0);
                        let has_real_stats = count > 0;
                        if !has_real_stats {
                            eprintln!(
                                "Startup: clearing stale fully_scanned flag for {} (file_count = {})",
                                d, count
                            );
                        }
                        has_real_stats
                    });
                    if cfg.fully_scanned_drives.len() != before {
                        drop(conn);
                        let _ = settings::save(&cfg);
                    }
                }

                let cfg = settings::load();
                let sender = state
                    .index_tx
                    .lock()
                    .expect("index_tx poisoned")
                    .clone();
                for drive in &cfg.indexed_drives {
                    let normalized = drive.replace('\\', "/");
                    let mode = settings::sync_mode_for(&cfg, &normalized);

                    if matches!(mode, DriveSyncMode::Manual) {
                        // No background activity; user-driven Rescan only.
                        continue;
                    }

                    // One stop flag drives both the realtime watcher and any
                    // periodic timer for this drive.
                    let drive_stop = Arc::new(AtomicBool::new(false));
                    if let Ok(mut map) = watchers_for_startup.lock() {
                        if let Some(prev) = map.insert(normalized.clone(), drive_stop.clone()) {
                            prev.store(true, Ordering::Relaxed);
                        }
                    }

                    // Shared pause flag — the worker flips it true while
                    // scanning this drive so we don't race for the DB lock.
                    let pause_flag = {
                        let mut map = state.drive_pause_flags.lock().expect("pauses poisoned");
                        map.entry(normalized.clone())
                            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
                            .clone()
                    };

                    drive_watcher::spawn(
                        db_path_for_startup.clone(),
                        normalized.clone(),
                        drive_stop.clone(),
                        pause_flag,
                        app.handle().clone(),
                    );

                    if matches!(mode, DriveSyncMode::Auto) {
                        let complete = cfg
                            .fully_scanned_drives
                            .iter()
                            .any(|d| d.replace('\\', "/") == normalized);
                        if !complete {
                            eprintln!("Auto-enqueue: {} (mode=auto, not fully scanned)", drive);
                            let cancel = Arc::new(AtomicBool::new(false));
                            if let Ok(mut map) = state.index_cancel_flags.lock() {
                                map.insert(normalized.clone(), cancel.clone());
                            }
                            let _ = sender.send(IndexCommand::Enqueue {
                                drive: normalized.clone(),
                                cancel,
                            });
                        }
                    }

                    if let DriveSyncMode::Timed { interval_minutes } = mode {
                        let interval = std::time::Duration::from_secs(
                            (interval_minutes.max(1) as u64) * 60,
                        );
                        let stop_for_timer = drive_stop.clone();
                        let sender_for_timer = sender.clone();
                        let drive_for_timer = normalized.clone();
                        std::thread::spawn(move || {
                            const TICK: std::time::Duration = std::time::Duration::from_secs(1);
                            loop {
                                let mut waited = std::time::Duration::ZERO;
                                while waited < interval {
                                    if stop_for_timer.load(Ordering::Relaxed) {
                                        return;
                                    }
                                    std::thread::sleep(TICK);
                                    waited += TICK;
                                }
                                let cancel = Arc::new(AtomicBool::new(false));
                                let _ = sender_for_timer.send(IndexCommand::Enqueue {
                                    drive: drive_for_timer.clone(),
                                    cancel,
                                });
                            }
                        });
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::navigate_to,
            commands::get_drives,
            commands::search_files,
            commands::search_subtree_counts,
            commands::get_folder_stats,
            commands::get_folder_sizes,
            commands::open_file,
            commands::open_file_with,
            commands::get_home_dir,
            commands::get_known_folders,
            commands::is_archive_path,
            commands::extract_archive,
            commands::read_file_bytes,
            commands::prepare_media_file,
            commands::read_file_text,
            commands::write_file_text,
            commands::get_settings,
            commands::save_settings,
            commands::get_index_status,
            commands::get_indexing_state,
            commands::debug_folder_stats,
            commands::set_drive_sync_mode,
            commands::rescan_drive,
            commands::install_shell_integration,
            commands::uninstall_shell_integration,
            commands::is_shell_integration_installed,
            commands::take_pending_open_path,
            commands::hide_launcher,
            commands::launcher_navigate,
            commands::download_and_run_installer,
            commands::start_index,
            commands::remove_index,
            commands::toggle_drive_index,
            commands::watch_directory,
            commands::unwatch_directory,
            commands::copy_files,
            commands::move_files,
            commands::delete_files,
            commands::rename_file,
            commands::create_folder,
            commands::undo_last_operation,
            commands::read_file_preview,
            commands::get_file_metadata,
            commands::get_workspace,
            commands::save_workspace,
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

