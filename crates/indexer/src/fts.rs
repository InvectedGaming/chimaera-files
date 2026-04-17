use chimaera_common::FileEntry;
use rusqlite::{params, Connection};

/// Populate the FTS5 index from the files table.
/// Uses the 'rebuild' command which is the correct way to populate
/// a content-synced FTS5 table.
pub fn populate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO files_fts(files_fts) VALUES('rebuild')", [])?;
    Ok(())
}

/// Search the FTS5 index. Returns matching file entries.
pub fn search(conn: &Connection, query: &str, limit: usize) -> rusqlite::Result<Vec<FileEntry>> {
    // Escape the query for FTS5: wrap each token in quotes to handle special chars
    let fts_query = query
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ");

    let mut stmt = conn.prepare_cached(
        "SELECT f.id, f.parent_id, f.name, f.path, f.is_directory, f.size,
                f.extension, f.created_at, f.modified_at, f.accessed_at
         FROM files_fts fts
         JOIN files f ON f.id = fts.rowid
         WHERE files_fts MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![fts_query, limit as i64], |row| {
        Ok(FileEntry {
            id: row.get(0)?,
            parent_id: row.get(1)?,
            name: row.get(2)?,
            path: row.get(3)?,
            is_directory: row.get::<_, i32>(4)? != 0,
            size: row.get(5)?,
            extension: row.get(6)?,
            created_at: row.get(7)?,
            modified_at: row.get(8)?,
            accessed_at: row.get(9)?,
        })
    })?;

    rows.collect()
}
