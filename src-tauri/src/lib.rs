mod archive;
mod commands;
mod file_ops;
pub mod settings;
mod state;
mod terminal;
mod watcher;

use state::AppState;
use std::path::PathBuf;
use tauri::Manager;

pub fn run() {
    let db_path = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("chimaera-files")
        .join("index.db");

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let app_state = AppState::new(&db_path).expect("failed to initialize database");
    let db_path_for_startup = db_path.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(app_state)
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            // Apply Mica Dark backdrop
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_mica;
                apply_mica(&window, Some(true)).ok();
            }

            // Register Win+E global hotkey
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
                let win_for_hotkey = window.clone();
                let shortcut: Shortcut = "Super+E".parse().unwrap();
                let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                    let _ = win_for_hotkey.show();
                    let _ = win_for_hotkey.set_focus();
                });
            }

            // Start journal watchers for enabled drives
            let db_path_clone = db_path_for_startup.clone();
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                start_journal_watchers(&db_path_clone, app_handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::navigate_to,
            commands::get_drives,
            commands::search_files,
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

fn start_journal_watchers(db_path: &PathBuf, app_handle: tauri::AppHandle) {
    use tauri::Emitter;

    let cfg = settings::load();
    if cfg.indexed_drives.is_empty() {
        eprintln!("Journal watcher: no drives enabled");
        return;
    }

    // Check if each drive has existing index data (has a checkpoint)
    if let Ok(conn) = chimaera_indexer::db::open(db_path) {
        for drive in &cfg.indexed_drives {
            let has_data: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM files WHERE path = ?1 OR path LIKE ?1 || '%' LIMIT 1",
                    [drive],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !has_data {
                // No index data — do a full scan first
                eprintln!("Journal watcher: {} has no index data, running initial scan...", drive);
                let target = std::path::PathBuf::from(drive);
                if target.exists() {
                    match chimaera_indexer::walker::index_directory(&conn, &target) {
                        Ok(stats) => {
                            eprintln!("Journal watcher: {} initial scan complete — {} files, {} dirs",
                                drive, stats.files_inserted, stats.dirs_inserted);
                            let _ = chimaera_indexer::stats::compute_all(&conn);
                            let _ = chimaera_indexer::fts::populate(&conn);
                        }
                        Err(e) => {
                            eprintln!("Journal watcher: {} initial scan failed: {}", drive, e);
                        }
                    }
                }
            }
        }
    }

    // Spawn a journal watcher thread for each enabled drive
    for drive in cfg.indexed_drives {
        let db = db_path.clone();
        let app = app_handle.clone();
        let drive_clone = drive.clone();

        std::thread::spawn(move || {
            let app_for_cb = app.clone();
            let drive_for_cb = drive_clone.clone();

            chimaera_indexer::journal_watcher::run_watcher(
                &db,
                &drive_clone,
                Some(Box::new(move |num_changes| {
                    let _ = app_for_cb.emit(
                        "index-updated",
                        serde_json::json!({
                            "volume": drive_for_cb,
                            "changes": num_changes,
                        }),
                    );
                })),
            );
        });
    }
}
