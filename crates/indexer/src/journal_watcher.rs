#![cfg(windows)]

use crate::usn::{self, UsnEntry, VolumeHandle};
use rusqlite::{params, Connection};
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Callback for notifying the app that the index was updated.
pub type OnUpdateCallback = Box<dyn Fn(u64) + Send>; // (num_changes)

/// Start the journal watcher for a volume. Blocks the calling thread.
/// `volume_root` should be like "C:/" or "E:/".
/// `on_update` is called when changes are applied to the DB.
pub fn run_watcher(
    db_path: &Path,
    volume_root: &str,
    on_update: Option<OnUpdateCallback>,
) {
    let drive_letter = volume_root.chars().next().unwrap_or('C');

    let handle = match VolumeHandle::open(drive_letter) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Journal watcher {}: failed to open volume: {}", volume_root, e);
            return;
        }
    };

    let conn = match crate::db::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Journal watcher {}: failed to open DB: {}", volume_root, e);
            return;
        }
    };

    // Query the journal
    let journal_info = match usn::query_journal(&handle) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Journal watcher {}: failed to query journal: {}", volume_root, e);
            return;
        }
    };

    // Load checkpoint
    let (saved_journal_id, saved_usn) = load_checkpoint(&conn, volume_root);

    let mut current_usn = if saved_journal_id == Some(journal_info.journal_id) && saved_usn.is_some() {
        let usn = saved_usn.unwrap();
        eprintln!(
            "Journal watcher {}: resuming from USN {} (journal ID {})",
            volume_root, usn, journal_info.journal_id
        );
        usn
    } else {
        // No valid checkpoint — start from current position (skip history)
        eprintln!(
            "Journal watcher {}: no valid checkpoint, starting from current position (USN {})",
            volume_root, journal_info.next_usn
        );
        save_checkpoint(&conn, volume_root, journal_info.journal_id, journal_info.next_usn);
        journal_info.next_usn
    };

    eprintln!("Journal watcher {}: watching for changes...", volume_root);

    loop {
        match usn::read_entries(&handle, current_usn, journal_info.journal_id) {
            Ok((entries, next_usn)) => {
                if !entries.is_empty() {
                    let close_entries: Vec<&UsnEntry> = entries
                        .iter()
                        .filter(|e| e.is_close())
                        .collect();

                    if !close_entries.is_empty() {
                        let applied = apply_changes(&conn, volume_root, &close_entries);
                        if applied > 0 {
                            if let Some(ref cb) = on_update {
                                cb(applied);
                            }
                        }
                    }
                }

                if next_usn != current_usn {
                    current_usn = next_usn;
                    save_checkpoint(&conn, volume_root, journal_info.journal_id, current_usn);
                }
            }
            Err(e) => {
                eprintln!("Journal watcher {}: read error: {}", volume_root, e);
                // Journal may have been deleted/recreated — re-query
                if let Ok(new_info) = usn::query_journal(&handle) {
                    if new_info.journal_id != journal_info.journal_id {
                        eprintln!("Journal watcher {}: journal ID changed, restarting from current", volume_root);
                        current_usn = new_info.next_usn;
                        save_checkpoint(&conn, volume_root, new_info.journal_id, current_usn);
                    }
                }
            }
        }

        std::thread::sleep(Duration::from_millis(500));
    }
}

/// Apply a batch of USN close entries to the database.
/// Returns the number of changes applied.
fn apply_changes(conn: &Connection, volume_root: &str, entries: &[&UsnEntry]) -> u64 {
    let mut changes = 0u64;

    let _ = conn.execute_batch("PRAGMA foreign_keys = OFF");

    for entry in entries {
        let full_path = usn::resolve_path_from_db(conn, volume_root, entry.parent_ref, &entry.file_name);

        if entry.is_delete() {
            // Try to delete by mft_ref first, then by path
            let deleted = conn
                .execute(
                    "DELETE FROM files WHERE mft_ref = ?1 AND path LIKE ?2 || '%'",
                    params![entry.file_ref as i64, volume_root],
                )
                .unwrap_or(0);

            if deleted > 0 {
                // Also clean up folder_stats
                let _ = conn.execute(
                    "DELETE FROM folder_stats WHERE folder_id NOT IN (SELECT id FROM files WHERE is_directory = 1)",
                    [],
                );
                changes += 1;
            }
        } else if entry.is_create() {
            if let Some(ref path) = full_path {
                // Get file metadata from filesystem
                if let Ok(meta) = std::fs::metadata(path) {
                    let is_dir = meta.is_dir();
                    let size = if is_dir { 0 } else { meta.len() as i64 };
                    let ext = if is_dir {
                        None
                    } else {
                        std::path::Path::new(path)
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

                    // Find parent_id
                    let parent_path = std::path::Path::new(path)
                        .parent()
                        .map(|p| p.to_string_lossy().replace('\\', "/"));
                    let parent_id: Option<i64> = parent_path.and_then(|pp| {
                        conn.query_row(
                            "SELECT id FROM files WHERE path = ?1",
                            [&pp],
                            |row| row.get(0),
                        )
                        .ok()
                    });

                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO files (parent_id, name, path, is_directory, size, extension, created_at, modified_at, mft_ref)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            parent_id,
                            entry.file_name,
                            path,
                            is_dir as i32,
                            size,
                            ext,
                            created,
                            modified,
                            entry.file_ref as i64,
                        ],
                    );
                    changes += 1;
                }
            }
        } else if entry.is_rename_new() {
            if let Some(ref new_path) = full_path {
                // Update the path and name for this file ref
                let updated = conn
                    .execute(
                        "UPDATE files SET name = ?1, path = ?2 WHERE mft_ref = ?3 AND path LIKE ?4 || '%'",
                        params![entry.file_name, new_path, entry.file_ref as i64, volume_root],
                    )
                    .unwrap_or(0);
                if updated > 0 {
                    changes += 1;
                }
            }
        } else if entry.is_size_change() {
            // Update file size from filesystem
            if let Some(ref path) = full_path {
                if let Ok(meta) = std::fs::metadata(path) {
                    if !meta.is_dir() {
                        let _ = conn.execute(
                            "UPDATE files SET size = ?1, modified_at = ?2 WHERE mft_ref = ?3 AND path LIKE ?4 || '%'",
                            params![
                                meta.len() as i64,
                                meta.modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as i64),
                                entry.file_ref as i64,
                                volume_root,
                            ],
                        );
                        changes += 1;
                    }
                }
            }
        }
    }

    let _ = conn.execute_batch("PRAGMA foreign_keys = ON");

    changes
}

fn load_checkpoint(conn: &Connection, volume: &str) -> (Option<u64>, Option<u64>) {
    conn.query_row(
        "SELECT journal_id, last_usn FROM journal_state WHERE volume = ?1",
        [volume],
        |row| {
            let jid: i64 = row.get(0)?;
            let usn: i64 = row.get(1)?;
            Ok((Some(jid as u64), Some(usn as u64)))
        },
    )
    .unwrap_or((None, None))
}

fn save_checkpoint(conn: &Connection, volume: &str, journal_id: u64, usn: u64) {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let _ = conn.execute(
        "INSERT OR REPLACE INTO journal_state (volume, journal_id, last_usn, updated_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![volume, journal_id as i64, usn as i64, now],
    );
}
