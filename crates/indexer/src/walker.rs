use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;
use walkdir::WalkDir;

pub struct IndexStats {
    pub files_inserted: u64,
    pub dirs_inserted: u64,
    pub errors: u64,
    /// Total bytes of files seen during the walk. Used to render a
    /// `indexed_bytes / drive_used_bytes` progress percentage.
    pub bytes_indexed: u64,
    /// True if the scan exited early because the cancel flag was set.
    pub cancelled: bool,
}

/// Progress callback: (files_so_far, dirs_so_far, bytes_so_far)
pub type ProgressCallback = Box<dyn Fn(u64, u64, u64) + Send>;

/// Walk a directory tree and insert all entries into the database.
pub fn index_directory(conn: &Connection, root: &Path) -> rusqlite::Result<IndexStats> {
    index_directory_with_progress(conn, root, None, None)
}

/// Walk a directory tree with an optional progress callback called every 10K entries.
/// If `cancel` is provided and flipped to `true` during the walk, the loop
/// exits cleanly at the next entry and returns the partial stats.
pub fn index_directory_with_progress(
    conn: &Connection,
    root: &Path,
    on_progress: Option<ProgressCallback>,
    cancel: Option<Arc<AtomicBool>>,
) -> rusqlite::Result<IndexStats> {
    let root = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());
    let root_str = normalize_path(&root);

    // Ensure no leftover transactions
    let _ = conn.execute_batch("COMMIT");

    // Clear existing data for this root path only. The trailing-slash trim
    // is critical: without it, `'C:/' || '/%'` becomes `'C://%'` which
    // matches zero rows, leaving stale descendants in the index forever.
    //
    // Both DELETEs run inside a single transaction so the write lock is
    // held continuously — otherwise the realtime drive_watcher could sneak
    // a write in between them and perpetually starve us via SQLITE_BUSY.
    let root_trimmed = root_str.trim_end_matches('/').to_string();
    let prefix_like = format!("{}/%", root_trimmed);
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    conn.execute(
        "DELETE FROM folder_stats WHERE folder_id IN (
             SELECT id FROM files WHERE path = ?1 OR path LIKE ?2
         )",
        [root_trimmed.as_str(), prefix_like.as_str()],
    )?;
    conn.execute(
        "DELETE FROM files WHERE path = ?1 OR path LIKE ?2",
        [root_trimmed.as_str(), prefix_like.as_str()],
    )?;
    conn.execute_batch("COMMIT")?;
    conn.execute_batch("PRAGMA foreign_keys = ON")?;

    let mut stats = IndexStats {
        files_inserted: 0,
        dirs_inserted: 0,
        errors: 0,
        bytes_indexed: 0,
        cancelled: false,
    };

    let mut path_to_id: HashMap<String, i64> = HashMap::new();

    let mut insert_stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO files (parent_id, name, path, is_directory, size, extension, created_at, modified_at, accessed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;

    conn.execute_batch("BEGIN")?;
    let mut batch_count = 0u64;
    const BATCH_SIZE: u64 = 10_000;
    // Avoid a syscall per entry — poll the cancel flag every 512 iterations.
    const CANCEL_POLL_EVERY: u64 = 512;
    let mut poll_counter = 0u64;

    for entry in WalkDir::new(&root).follow_links(false) {
        poll_counter = poll_counter.wrapping_add(1);
        if poll_counter % CANCEL_POLL_EVERY == 0 {
            if let Some(ref c) = cancel {
                if c.load(Ordering::Relaxed) {
                    stats.cancelled = true;
                    break;
                }
            }
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };

        let path = entry.path();
        let path_str = normalize_path(path);
        let name = entry
            .file_name()
            .to_str()
            .unwrap_or("")
            .to_string();
        let is_dir = metadata.is_dir();
        let size = if is_dir { 0 } else { metadata.len() as i64 };
        let extension = if is_dir {
            None
        } else {
            path.extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
        };

        let created_at = metadata.created().ok().and_then(|t| to_unix_ms(t));
        let modified_at = metadata.modified().ok().and_then(|t| to_unix_ms(t));
        let accessed_at = metadata.accessed().ok().and_then(|t| to_unix_ms(t));

        let parent_id = if path_str == root_str {
            None
        } else {
            path.parent()
                .map(|p| normalize_path(p))
                .and_then(|pp| path_to_id.get(&pp).copied())
        };

        insert_stmt.execute(params![
            parent_id, name, path_str, is_dir as i32, size, extension,
            created_at, modified_at, accessed_at,
        ])?;

        let row_id = conn.last_insert_rowid();
        path_to_id.insert(path_str, row_id);

        if is_dir {
            stats.dirs_inserted += 1;
        } else {
            stats.files_inserted += 1;
            stats.bytes_indexed = stats.bytes_indexed.saturating_add(size as u64);
        }

        batch_count += 1;
        if batch_count % BATCH_SIZE == 0 {
            conn.execute_batch("COMMIT; BEGIN")?;
            if let Some(ref cb) = on_progress {
                cb(stats.files_inserted, stats.dirs_inserted, stats.bytes_indexed);
            }
        }
    }

    conn.execute_batch("COMMIT")?;

    // Final progress callback
    if let Some(ref cb) = on_progress {
        cb(stats.files_inserted, stats.dirs_inserted, stats.bytes_indexed);
    }

    Ok(stats)
}

fn normalize_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    s.replace('\\', "/")
}

fn to_unix_ms(t: SystemTime) -> Option<i64> {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}
