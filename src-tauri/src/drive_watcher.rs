//! Drive-wide realtime index updates.
//!
//! Uses `notify-debouncer-mini` (ReadDirectoryChangesW on Windows) to watch
//! an entire indexed drive. Events are coalesced by the debouncer and then
//! translated into:
//!   1. An incremental mutation of the `files` table (insert / update / delete).
//!   2. A delta-update of the `folder_stats` table along the file's ancestor
//!      chain, so `file_count` / `total_size` stay accurate without waiting
//!      for the next full `compute_for_subtree` pass.
//!
//! The walker owns folder_stats computation for a full scan; this module
//! keeps it fresh for single-path events in between scans. Per-event cost
//! is O(tree depth) — typically <20 SQL writes, sub-millisecond.
//!
//! Known limitations (improve in v0.1.3+):
//!   - Renames are treated as delete+create. A directory rename loses
//!     descendants from the index until the next full rescan. Proper
//!     handling needs paired-event tracking or NTFS FileID as PK.
//!   - Events for a file whose parent dir isn't yet in `files` (arrived
//!     out of order in the batch) insert with `parent_id = NULL`. Sorting
//!     by path length first minimises this.

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use rusqlite::{params, Connection, OptionalExtension};
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

    let conn = chimaera_indexer::db::open(db_path)
        .map_err(|e| format!("db::open: {}", e))?;

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }

        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(Ok(events)) => {
                if pause.load(Ordering::Relaxed) {
                    continue;
                }
                let mut paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
                if paths.is_empty() {
                    continue;
                }
                // Parents must exist in `files` before we try to look up
                // parent_id for their children. Sorting ascending-by-length
                // is a cheap heuristic — true ancestors are always shorter.
                paths.sort_by_key(|p| p.as_os_str().len());

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

    drop(debouncer);
    eprintln!("drive watcher {}: stopped", drive_root);
    Ok(())
}

// --- Event processing ---

/// Existing row state we need to diff against the filesystem.
struct ExistingRow {
    id: i64,
    parent_id: Option<i64>,
    is_dir: bool,
    size: i64,
}

/// Process a batch of debounced event paths. Wraps everything in a single
/// transaction so the whole batch is atomic — either we apply all of it
/// or none of it. Returns a count of mutations applied.
fn apply_events(conn: &Connection, paths: &[PathBuf]) -> u64 {
    if conn.execute_batch("BEGIN IMMEDIATE").is_err() {
        // Couldn't get a write lock — drop this batch, next one will retry.
        return 0;
    }

    let mut applied = 0u64;
    for path in paths {
        if apply_one(conn, path).unwrap_or(false) {
            applied += 1;
        }
    }

    let _ = conn.execute_batch("COMMIT");
    applied
}

/// Handle one debounced path. Returns true if a mutation was written.
fn apply_one(conn: &Connection, raw: &Path) -> rusqlite::Result<bool> {
    let path_str = normalize_path(raw);

    let existing: Option<ExistingRow> = conn
        .query_row(
            "SELECT id, parent_id, is_directory, size FROM files WHERE path = ?1",
            [&path_str],
            |r| {
                Ok(ExistingRow {
                    id: r.get(0)?,
                    parent_id: r.get(1)?,
                    is_dir: r.get::<_, i32>(2)? != 0,
                    size: r.get(3)?,
                })
            },
        )
        .optional()?;

    let disk_meta = std::fs::metadata(raw).ok();

    match (existing, disk_meta) {
        (Some(old), Some(meta)) => handle_update(conn, raw, &path_str, old, &meta),
        (None, Some(meta)) => handle_create(conn, raw, &path_str, &meta),
        (Some(old), None) => handle_delete(conn, &path_str, old),
        (None, None) => Ok(false), // spurious event, nothing to do
    }
}

fn handle_create(
    conn: &Connection,
    raw: &Path,
    path_str: &str,
    meta: &std::fs::Metadata,
) -> rusqlite::Result<bool> {
    let is_dir = meta.is_dir();
    let size: i64 = if is_dir { 0 } else { meta.len() as i64 };
    let name = raw
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let extension = if is_dir {
        None
    } else {
        raw.extension()
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

    let parent_id = lookup_parent_id(conn, raw)?;

    conn.execute(
        "INSERT INTO files (parent_id, name, path, is_directory, size, extension, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![parent_id, name, path_str, is_dir as i32, size, extension, created, modified],
    )?;
    let new_id = conn.last_insert_rowid();

    if is_dir {
        // Seed an empty folder_stats row so the new directory shows up in
        // per-folder aggregate queries without waiting for a full recompute.
        let now = now_ms();
        conn.execute(
            "INSERT INTO folder_stats
                 (folder_id, total_size, file_count, direct_file_count,
                  subfolder_count, deepest_file_depth, last_modified, computed_at)
             VALUES (?1, 0, 0, 0, 0, 0, ?2, ?2)
             ON CONFLICT(folder_id) DO NOTHING",
            params![new_id, now],
        )?;
        // Parent gains a subfolder.
        if let Some(pid) = parent_id {
            conn.execute(
                "UPDATE folder_stats SET subfolder_count = subfolder_count + 1 WHERE folder_id = ?1",
                [pid],
            )?;
        }
    } else {
        // File: bump ancestors.
        bump_ancestors(conn, parent_id, 1, size)?;
        if let Some(pid) = parent_id {
            conn.execute(
                "UPDATE folder_stats SET direct_file_count = direct_file_count + 1 WHERE folder_id = ?1",
                [pid],
            )?;
        }
    }

    Ok(true)
}

fn handle_update(
    conn: &Connection,
    raw: &Path,
    path_str: &str,
    old: ExistingRow,
    meta: &std::fs::Metadata,
) -> rusqlite::Result<bool> {
    // Type change (file ↔ dir) is rare enough that we treat it as delete+create.
    if old.is_dir != meta.is_dir() {
        handle_delete(conn, path_str, old)?;
        return handle_create(conn, raw, path_str, meta);
    }

    let new_size: i64 = if meta.is_dir() { 0 } else { meta.len() as i64 };
    let size_delta = new_size - old.size;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

    conn.execute(
        "UPDATE files SET size = ?1, modified_at = ?2 WHERE id = ?3",
        params![new_size, modified, old.id],
    )?;

    // Only files contribute to ancestor `total_size`. Directories have
    // `size = 0` by convention.
    if !old.is_dir && size_delta != 0 {
        bump_ancestors(conn, old.parent_id, 0, size_delta)?;
    }

    Ok(true)
}

fn handle_delete(
    conn: &Connection,
    path_str: &str,
    old: ExistingRow,
) -> rusqlite::Result<bool> {
    let like = format!("{}/%", path_str);

    if old.is_dir {
        // Before deleting, tally what the subtree was contributing to
        // ancestor aggregates so we can subtract the right amount.
        let (subtree_files, subtree_size): (i64, i64) = conn.query_row(
            "SELECT
                 COALESCE(SUM(CASE WHEN is_directory = 0 THEN 1 ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN is_directory = 0 THEN size ELSE 0 END), 0)
             FROM files WHERE path = ?1 OR path LIKE ?2",
            [path_str, &like],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        // Cascade-delete descendant rows + the dir itself. folder_stats
        // rows for the deleted subtree become orphans — cleaned up below.
        conn.execute(
            "DELETE FROM folder_stats WHERE folder_id IN (
                 SELECT id FROM files WHERE path = ?1 OR path LIKE ?2
             )",
            [path_str, &like],
        )?;
        conn.execute(
            "DELETE FROM files WHERE path = ?1 OR path LIKE ?2",
            [path_str, &like],
        )?;

        // Subtract the subtree totals from ancestors.
        bump_ancestors(conn, old.parent_id, -subtree_files, -subtree_size)?;
        if let Some(pid) = old.parent_id {
            conn.execute(
                "UPDATE folder_stats SET subfolder_count = subfolder_count - 1 WHERE folder_id = ?1",
                [pid],
            )?;
        }
    } else {
        // Single file: subtract its size, decrement counts.
        bump_ancestors(conn, old.parent_id, -1, -old.size)?;
        if let Some(pid) = old.parent_id {
            conn.execute(
                "UPDATE folder_stats SET direct_file_count = direct_file_count - 1 WHERE folder_id = ?1",
                [pid],
            )?;
        }
        conn.execute("DELETE FROM files WHERE id = ?1", [old.id])?;
    }

    Ok(true)
}

// --- Helpers ---

/// Apply a delta to every ancestor folder_stats row from `start_parent_id`
/// up to the drive root. `files_delta` updates `file_count`,
/// `size_delta` updates `total_size`. Direct-parent-only counters
/// (`direct_file_count`, `subfolder_count`) are bumped by the caller.
fn bump_ancestors(
    conn: &Connection,
    start_parent_id: Option<i64>,
    files_delta: i64,
    size_delta: i64,
) -> rusqlite::Result<()> {
    if files_delta == 0 && size_delta == 0 {
        return Ok(());
    }
    let mut current = start_parent_id;
    while let Some(id) = current {
        conn.execute(
            "UPDATE folder_stats
             SET file_count = file_count + ?1,
                 total_size = total_size + ?2
             WHERE folder_id = ?3",
            params![files_delta, size_delta, id],
        )?;
        current = conn
            .query_row(
                "SELECT parent_id FROM files WHERE id = ?1",
                [id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
    }
    Ok(())
}

fn lookup_parent_id(conn: &Connection, path: &Path) -> rusqlite::Result<Option<i64>> {
    let Some(parent) = path.parent() else {
        return Ok(None);
    };
    let parent_path = normalize_path(parent);
    conn.query_row(
        "SELECT id FROM files WHERE path = ?1",
        [&parent_path],
        |r| r.get(0),
    )
    .optional()
}

fn normalize_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    let s = s.replace('\\', "/");
    if s.len() > 1 {
        s.trim_end_matches('/').to_string()
    } else {
        s
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
