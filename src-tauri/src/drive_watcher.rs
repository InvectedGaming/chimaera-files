//! Drive-wide realtime index updates.
//!
//! Uses `notify-debouncer-mini` (ReadDirectoryChangesW on Windows) to watch
//! an entire indexed drive. Events are coalesced by the debouncer and then
//! translated into idempotent DB upserts / cascade deletes so the index
//! stays in sync without waiting for a full rescan.
//!
//! This is the non-admin alternative to the NTFS USN journal watcher in
//! `chimaera_indexer::journal_watcher`. USN is more efficient but requires
//! elevated privileges that most users don't grant the app.

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

/// Spawn a watcher thread for `drive_root`. Exits cleanly when `stop` flips.
/// `pause` lets the indexer worker tell us "the walker is writing, don't
/// touch the DB" — we still drain events from notify so the kernel buffer
/// doesn't overflow, we just skip the SQL writes until the flag clears.
pub fn spawn(
    db_path: PathBuf,
    drive_root: String,
    stop: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        if let Err(e) = run(&db_path, &drive_root, stop, pause, app) {
            eprintln!("drive watcher {}: exited with error: {}", drive_root, e);
        }
    });
}

fn run(
    db_path: &Path,
    drive_root: &str,
    stop: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<(), String> {
    // Mirror the channel element type used in `watcher.rs` — the error side
    // of the debouncer's Result is crate-version specific, so we let the
    // type inferencer match it via the underscore below.
    let (tx, rx) = mpsc::channel();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: Result<Vec<DebouncedEvent>, _>| {
            let _ = tx.send(res);
        },
    )
    .map_err(|e| format!("new_debouncer: {}", e))?;

    debouncer
        .watcher()
        .watch(Path::new(drive_root), RecursiveMode::Recursive)
        .map_err(|e| format!("watch({}): {}", drive_root, e))?;

    eprintln!("drive watcher {}: watching for changes...", drive_root);

    // Open a dedicated connection for the watcher. Separate from the main
    // AppState connection to avoid holding the lock while draining events.
    let conn = chimaera_indexer::db::open(db_path)
        .map_err(|e| format!("db::open: {}", e))?;

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }

        // Block up to 1s at a time so we can poll the stop flag between batches.
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(Ok(events)) => {
                // Walker is mid-scan for this drive — drop events rather
                // than fighting it for the write lock. The walker will
                // re-insert every row when it finishes, so anything we'd
                // have written is already in the scan's output.
                if pause.load(Ordering::Relaxed) {
                    continue;
                }
                let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
                if paths.is_empty() {
                    continue;
                }
                let applied = apply_events(&conn, &paths);
                if applied > 0 {
                    let _ = app.emit(
                        "index-updated",
                        serde_json::json!({
                            "volume": drive_root,
                            "changes": applied,
                        }),
                    );
                }
            }
            Ok(Err(e)) => {
                eprintln!("drive watcher {}: notify error: {:?}", drive_root, e);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    // Drop order: explicit for clarity — debouncer first stops watching.
    drop(debouncer);
    eprintln!("drive watcher {}: stopped", drive_root);
    Ok(())
}

/// For each changed path: if it exists on disk, upsert a row; if not, delete
/// the path and any descendants. Returns the number of applied DB mutations.
fn apply_events(conn: &Connection, paths: &[PathBuf]) -> u64 {
    let mut applied = 0u64;
    for raw in paths {
        let path_str = normalize_path(raw);
        match std::fs::metadata(raw) {
            Ok(meta) => {
                if upsert_row(conn, raw, &path_str, &meta).is_ok() {
                    applied += 1;
                }
            }
            Err(_) => {
                // Path is gone — cascade delete any row for it or anything
                // inside it. Only count as 1 regardless of rows removed.
                let like = format!("{}/%", path_str);
                if let Ok(n) = conn.execute(
                    "DELETE FROM files WHERE path = ?1 OR path LIKE ?2",
                    params![&path_str, &like],
                ) {
                    if n > 0 {
                        applied += 1;
                    }
                }
            }
        }
    }
    applied
}

fn upsert_row(
    conn: &Connection,
    raw_path: &Path,
    path_str: &str,
    meta: &std::fs::Metadata,
) -> rusqlite::Result<()> {
    let name = raw_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let is_dir = meta.is_dir();
    let size = if is_dir { 0 } else { meta.len() as i64 };
    let extension = if is_dir {
        None
    } else {
        raw_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    let created = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

    let parent_path = raw_path.parent().map(normalize_path);
    let parent_id: Option<i64> = parent_path.and_then(|pp| {
        conn.query_row("SELECT id FROM files WHERE path = ?1", [&pp], |r| r.get(0))
            .ok()
    });

    conn.execute(
        "INSERT INTO files (parent_id, name, path, is_directory, size, extension, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(path) DO UPDATE SET
             name = excluded.name,
             is_directory = excluded.is_directory,
             size = excluded.size,
             extension = excluded.extension,
             modified_at = excluded.modified_at",
        params![parent_id, name, path_str, is_dir as i32, size, extension, created, modified],
    )?;
    Ok(())
}

fn normalize_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    s.replace('\\', "/")
}
