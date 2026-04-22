//! Serial indexer worker.
//!
//! SQLite allows one writer at a time. When the user enables several drives
//! back-to-back, naïve `std::thread::spawn` for each blocks every walker
//! except the first on the write lock, stalling the UI indefinitely. This
//! module owns a single worker thread that pulls jobs off an mpsc channel
//! and runs them one at a time.

use crate::state::{ActiveIndexProgress, ActiveIndexState, DrivePauseFlags};
use serde_json::json;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub enum IndexCommand {
    /// Enqueue a drive to be indexed. `cancel` lets the caller abort both
    /// queued and in-flight jobs.
    Enqueue {
        drive: String,
        cancel: Arc<AtomicBool>,
    },
    /// Remove a drive from the queue. If the drive is currently running,
    /// the cancel flag on the original Enqueue is the way to stop it —
    /// this command only affects queued (not-yet-started) jobs.
    CancelQueued { drive: String },
}

pub fn make_channel() -> (Sender<IndexCommand>, Receiver<IndexCommand>) {
    mpsc::channel()
}

pub fn spawn(
    db_path: PathBuf,
    app: AppHandle,
    rx: Receiver<IndexCommand>,
    active: ActiveIndexState,
    pauses: DrivePauseFlags,
) {
    std::thread::spawn(move || run(db_path, app, rx, active, pauses));
}

fn run(
    db_path: PathBuf,
    app: AppHandle,
    rx: Receiver<IndexCommand>,
    active: ActiveIndexState,
    pauses: DrivePauseFlags,
) {
    let mut queue: VecDeque<(String, Arc<AtomicBool>)> = VecDeque::new();
    eprintln!("[worker] started");

    loop {
        // Drain any commands that are already waiting — both to seed the
        // queue and to pick up cancels for entries already in it.
        drain_commands(&rx, &mut queue);

        // If nothing queued, block for the next command.
        if queue.is_empty() {
            match rx.recv() {
                Ok(cmd) => apply_command(cmd, &mut queue),
                Err(_) => {
                    eprintln!("[worker] channel closed, exiting");
                    break;
                }
            }
            continue;
        }

        // Emit queue position for everyone waiting so the UI can show order.
        for (i, (drive, _)) in queue.iter().enumerate() {
            let position = (i + 1) as u32;
            if let Ok(mut map) = active.lock() {
                map.insert(
                    drive.clone(),
                    ActiveIndexProgress {
                        drive: drive.clone(),
                        phase: "queued".into(),
                        files: 0,
                        dirs: 0,
                        bytes: 0,
                        position: Some(position),
                    },
                );
            }
            let _ = app.emit(
                "index-progress",
                json!({
                    "drive": drive,
                    "files": 0,
                    "dirs": 0,
                    "bytes": 0,
                    "phase": "queued",
                    "position": position,
                }),
            );
        }

        let (drive, cancel) = queue.pop_front().expect("non-empty");
        if cancel.load(Ordering::Relaxed) {
            eprintln!("[worker] {} cancelled before start, skipping", drive);
            if let Ok(mut map) = active.lock() {
                map.remove(&drive);
            }
            continue;
        }

        eprintln!("[worker] starting scan for {}", drive);

        // Pause the realtime watcher for this drive — the walker is about
        // to do a ton of writes and any concurrent upserts from the watcher
        // would lose the DB write-lock race (cost us an entire day of
        // debugging the first time).
        let pause_flag = {
            let mut map = pauses.lock().expect("drive_pause_flags poisoned");
            map.entry(drive.clone())
                .or_insert_with(|| Arc::new(AtomicBool::new(false)))
                .clone()
        };
        pause_flag.store(true, Ordering::Relaxed);

        run_job(&db_path, &app, &active, &drive, cancel);

        pause_flag.store(false, Ordering::Relaxed);
        eprintln!("[worker] finished scan for {}", drive);
    }
}

fn drain_commands(rx: &Receiver<IndexCommand>, queue: &mut VecDeque<(String, Arc<AtomicBool>)>) {
    while let Ok(cmd) = rx.try_recv() {
        apply_command(cmd, queue);
    }
}

fn apply_command(cmd: IndexCommand, queue: &mut VecDeque<(String, Arc<AtomicBool>)>) {
    match cmd {
        IndexCommand::Enqueue { drive, cancel } => {
            // Dedupe: re-enqueue of the same drive wins.
            queue.retain(|(d, _)| d != &drive);
            queue.push_back((drive, cancel));
        }
        IndexCommand::CancelQueued { drive } => {
            queue.retain(|(d, _)| d != &drive);
        }
    }
}

fn run_job(
    db_path: &PathBuf,
    app: &AppHandle,
    active: &ActiveIndexState,
    drive: &str,
    cancel: Arc<AtomicBool>,
) {
    let emit = |phase: &str,
                files: u64,
                dirs: u64,
                bytes: u64,
                extra: Option<(&str, &str)>| {
        // Update the shared map so a late-mounting UI can query current state.
        if let Ok(mut map) = active.lock() {
            let terminal = matches!(phase, "done" | "cancelled" | "error");
            if terminal {
                map.remove(drive);
            } else {
                map.insert(
                    drive.to_string(),
                    ActiveIndexProgress {
                        drive: drive.to_string(),
                        phase: phase.to_string(),
                        files,
                        dirs,
                        bytes,
                        position: None,
                    },
                );
            }
        }

        let mut payload = json!({
            "drive": drive,
            "files": files,
            "dirs": dirs,
            "bytes": bytes,
            "phase": phase,
        });
        if let Some((k, v)) = extra {
            payload[k] = json!(v);
        }
        let _ = app.emit("index-progress", payload);
    };

    emit("scanning", 0, 0, 0, None);

    eprintln!("[worker] {} opening DB connection", drive);
    let conn = match chimaera_indexer::db::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[worker] {} db::open failed: {}", drive, e);
            emit("error", 0, 0, 0, Some(("message", &e.to_string())));
            return;
        }
    };
    eprintln!("[worker] {} DB opened, checking target", drive);

    let target = PathBuf::from(drive);
    if !target.exists() {
        eprintln!("[worker] {} target does not exist, aborting", drive);
        emit("error", 0, 0, 0, Some(("message", "drive not available")));
        return;
    }
    eprintln!("[worker] {} target exists, calling walker", drive);

    // Progress emitter used from inside the walker callback.
    let app_cb = app.clone();
    let drive_cb = drive.to_string();
    let result = chimaera_indexer::walker::index_directory_with_progress(
        &conn,
        &target,
        Some(Box::new(move |files, dirs, bytes| {
            let _ = app_cb.emit(
                "index-progress",
                json!({
                    "drive": drive_cb,
                    "files": files,
                    "dirs": dirs,
                    "bytes": bytes,
                    "phase": "scanning",
                }),
            );
        })),
        Some(cancel.clone()),
    );

    match result {
        Ok(stats) if stats.cancelled => {
            eprintln!(
                "[worker] {} walker returned CANCELLED after {} files, {} dirs",
                drive, stats.files_inserted, stats.dirs_inserted
            );
            crate::settings::unmark_scan_complete(drive);
            emit(
                "cancelled",
                stats.files_inserted,
                stats.dirs_inserted,
                stats.bytes_indexed,
                None,
            );
        }
        Ok(stats) => {
            eprintln!(
                "[worker] {} walker OK: {} files, {} dirs, {} bytes; computing stats...",
                drive, stats.files_inserted, stats.dirs_inserted, stats.bytes_indexed
            );
            emit(
                "computing_stats",
                stats.files_inserted,
                stats.dirs_inserted,
                stats.bytes_indexed,
                None,
            );
            if let Err(e) = chimaera_indexer::stats::compute_for_subtree(&conn, drive) {
                eprintln!("[worker] {} compute_for_subtree ERROR: {}", drive, e);
            } else {
                eprintln!("[worker] {} folder_stats computed", drive);
            }
            if let Err(e) = chimaera_indexer::fts::populate(&conn) {
                eprintln!("[worker] {} fts::populate ERROR: {}", drive, e);
            }
            crate::settings::mark_scan_complete(drive);
            emit(
                "done",
                stats.files_inserted,
                stats.dirs_inserted,
                stats.bytes_indexed,
                None,
            );
        }
        Err(e) => {
            eprintln!("[worker] {} walker FAILED: {}", drive, e);
            crate::settings::unmark_scan_complete(drive);
            emit("error", 0, 0, 0, Some(("message", &e.to_string())));
        }
    }
}
