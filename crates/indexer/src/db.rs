use chimaera_common::SCHEMA_SQL;
use rusqlite::{Connection, OpenFlags, Result};
use std::path::Path;

/// Current schema version. Bump when the `SCHEMA_SQL` in `chimaera_common`
/// changes in a way that requires rebuilding derived tables (e.g. FTS).
///
///  v0 → v1: initial schema.
///  v1 → v2: `files_fts` switched from `unicode61` to `trigram` tokenizer so
///           queries like `eadm` can substring-match `readme.md`. Requires
///           dropping and recreating the virtual table; FTS rebuilt by
///           `crate::fts::populate` after migration.
const SCHEMA_VERSION: i32 = 2;

/// Open (or create) the database and initialize the schema.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    let migrated = migrate(&conn)?;
    conn.execute_batch(SCHEMA_SQL)?;
    // Only rebuild the FTS table if migration actually just dropped it.
    // Re-populating on every `db::open` is extremely wasteful — the worker
    // opens a fresh connection per job and would re-index 700k+ rows each
    // time, adding tens of seconds of blocking writes per scan.
    if migrated {
        let _ = crate::fts::populate(&conn);
    }
    Ok(conn)
}

/// Returns `true` iff the database was just upgraded — so the caller knows
/// whether follow-up work (like `fts::populate`) is needed.
fn migrate(conn: &Connection) -> Result<bool> {
    let current: i32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if current >= SCHEMA_VERSION {
        return Ok(false);
    }

    // v1 → v2: drop files_fts so the schema init recreates it with the
    // trigram tokenizer.
    if current < 2 {
        conn.execute_batch("DROP TABLE IF EXISTS files_fts;")?;
    }

    conn.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION))?;
    Ok(true)
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
        PRAGMA busy_timeout = 30000;
        ",
    )?;
    Ok(())
}
