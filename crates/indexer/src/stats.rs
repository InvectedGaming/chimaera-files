use chimaera_common::FolderStats;
use rusqlite::{params, Connection};
use std::time::SystemTime;

/// Compute folder_stats for every directory in the index.
/// Wipes ALL existing folder_stats and recomputes globally — only safe to
/// call when the entire index has been freshly populated. For per-drive
/// recomputation after a single-drive scan, use [`compute_for_subtree`].
pub fn compute_all(conn: &Connection) -> rusqlite::Result<()> {
    compute_inner(conn, None)
}

/// Compute folder_stats for directories under `root_path` only. Leaves
/// folder_stats for other subtrees untouched — important when a single
/// drive completes a scan while other drives' stats are still valid.
pub fn compute_for_subtree(conn: &Connection, root_path: &str) -> rusqlite::Result<()> {
    compute_inner(conn, Some(root_path))
}

fn compute_inner(conn: &Connection, root_path: Option<&str>) -> rusqlite::Result<()> {
    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // Ensure no leftover transactions
    let _ = conn.execute_batch("COMMIT");

    // Trim a trailing `/` so the LIKE prefix doesn't end up as `C://%`,
    // which silently matches no rows (the walker stores paths with a
    // single slash separator).
    let root_trimmed: Option<String> =
        root_path.map(|p| p.trim_end_matches('/').to_string());

    // Wipe stats for the targeted subtree (or all of folder_stats if global).
    if let Some(root) = &root_trimmed {
        let prefix_like = format!("{}/%", root);
        conn.execute(
            "DELETE FROM folder_stats WHERE folder_id IN (
                 SELECT id FROM files WHERE path = ?1 OR path LIKE ?2
             )",
            [root.as_str(), prefix_like.as_str()],
        )?;
    } else {
        conn.execute("DELETE FROM folder_stats", [])?;
    }

    // Pull directories scoped to the root (deepest first, so children are
    // processed before their parents — required for the bottom-up rollup).
    let dirs: Vec<(i64, String)> = if let Some(root) = &root_trimmed {
        let prefix_like = format!("{}/%", root);
        let mut s = conn.prepare(
            "SELECT id, path FROM files
             WHERE is_directory = 1 AND (path = ?1 OR path LIKE ?2)
             ORDER BY LENGTH(path) DESC",
        )?;
        s.query_map([root.as_str(), prefix_like.as_str()], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        let mut s = conn.prepare(
            "SELECT id, path FROM files WHERE is_directory = 1 ORDER BY LENGTH(path) DESC",
        )?;
        s.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect()
    };

    let mut insert_stmt = conn.prepare_cached(
        "INSERT INTO folder_stats (folder_id, total_size, file_count, direct_file_count, subfolder_count, deepest_file_depth, last_modified, computed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;

    // Direct children stats query
    let mut direct_files_stmt = conn.prepare_cached(
        "SELECT COALESCE(SUM(size), 0), COUNT(*), MAX(modified_at)
         FROM files WHERE parent_id = ?1 AND is_directory = 0",
    )?;

    let mut direct_subdirs_stmt = conn.prepare_cached(
        "SELECT COUNT(*) FROM files WHERE parent_id = ?1 AND is_directory = 1",
    )?;

    // Child folder stats (already computed since we go bottom-up)
    let mut child_stats_stmt = conn.prepare_cached(
        "SELECT COALESCE(SUM(fs.total_size), 0),
                COALESCE(SUM(fs.file_count), 0),
                COALESCE(MAX(fs.deepest_file_depth), 0),
                MAX(fs.last_modified)
         FROM files f
         JOIN folder_stats fs ON fs.folder_id = f.id
         WHERE f.parent_id = ?1",
    )?;

    conn.execute_batch("BEGIN")?;

    for (i, (dir_id, _path)) in dirs.iter().enumerate() {
        // Direct file stats
        let (direct_size, direct_file_count, direct_last_mod): (i64, i64, Option<i64>) =
            direct_files_stmt.query_row(params![dir_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?;

        // Direct subfolder count
        let subfolder_count: i64 =
            direct_subdirs_stmt.query_row(params![dir_id], |row| row.get(0))?;

        // Aggregated child folder stats
        let (child_size, child_file_count, child_max_depth, child_last_mod): (
            i64,
            i64,
            i64,
            Option<i64>,
        ) = child_stats_stmt.query_row(params![dir_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;

        let total_size = direct_size + child_size;
        let file_count = direct_file_count + child_file_count;
        let deepest = if direct_file_count > 0 {
            (child_max_depth + 1).max(1)
        } else if child_file_count > 0 {
            child_max_depth + 1
        } else {
            0
        };
        let last_modified = match (direct_last_mod, child_last_mod) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };

        insert_stmt.execute(params![
            dir_id,
            total_size,
            file_count,
            direct_file_count,
            subfolder_count,
            deepest,
            last_modified,
            now_ms,
        ])?;

        if (i + 1) % 10_000 == 0 {
            conn.execute_batch("COMMIT; BEGIN")?;
        }
    }

    conn.execute_batch("COMMIT")?;

    Ok(())
}

/// Get folder stats for a specific path.
pub fn get_folder_stats(conn: &Connection, path: &str) -> rusqlite::Result<Option<FolderStats>> {
    let mut stmt = conn.prepare_cached(
        "SELECT fs.folder_id, fs.total_size, fs.file_count, fs.direct_file_count,
                fs.subfolder_count, fs.deepest_file_depth, fs.last_modified, fs.computed_at
         FROM folder_stats fs
         JOIN files f ON f.id = fs.folder_id
         WHERE f.path = ?1",
    )?;

    let result = stmt.query_row(params![path], |row| {
        Ok(FolderStats {
            folder_id: row.get(0)?,
            total_size: row.get(1)?,
            file_count: row.get(2)?,
            direct_file_count: row.get(3)?,
            subfolder_count: row.get(4)?,
            deepest_file_depth: row.get(5)?,
            last_modified: row.get(6)?,
            computed_at: row.get(7)?,
        })
    });

    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}
