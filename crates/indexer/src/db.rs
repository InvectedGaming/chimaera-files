use chimaera_common::SCHEMA_SQL;
use rusqlite::{Connection, OpenFlags, Result};
use std::path::Path;

/// Open (or create) the database and initialize the schema.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(conn)
}

/// Open the database in read-only mode.
pub fn open_readonly(path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA cache_size = -64000;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 268435456;
        PRAGMA foreign_keys = ON;
        ",
    )?;
    Ok(())
}
