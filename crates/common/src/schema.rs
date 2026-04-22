use serde::{Deserialize, Serialize};

/// SQL statements to initialize the database schema.
pub const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS files (
    id           INTEGER PRIMARY KEY,
    parent_id    INTEGER REFERENCES files(id),
    name         TEXT    NOT NULL,
    path         TEXT    NOT NULL UNIQUE,
    is_directory INTEGER NOT NULL,
    size         INTEGER NOT NULL DEFAULT 0,
    extension    TEXT,
    created_at   INTEGER,
    modified_at  INTEGER,
    accessed_at  INTEGER,
    attributes   INTEGER,
    mft_ref      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified_at);

CREATE TABLE IF NOT EXISTS folder_stats (
    folder_id          INTEGER PRIMARY KEY REFERENCES files(id),
    total_size         INTEGER NOT NULL,
    file_count         INTEGER NOT NULL,
    direct_file_count  INTEGER NOT NULL,
    subfolder_count    INTEGER NOT NULL,
    deepest_file_depth INTEGER NOT NULL,
    last_modified      INTEGER,
    computed_at        INTEGER NOT NULL
);

-- Trigram tokenizer gives us true substring match: `eadm` finds `readme.md`.
-- Requires SQLite 3.34+; the bundled rusqlite ships 3.4x.
-- Migration to this is handled in `db::open` via the `user_version` pragma.
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    name, path, extension,
    content='files', content_rowid='id',
    tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    color TEXT
);

CREATE TABLE IF NOT EXISTS file_tags (
    file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
    tag_id  INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, tag_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    query TEXT NOT NULL,
    icon  TEXT
);

CREATE TABLE IF NOT EXISTS pinned (
    id       INTEGER PRIMARY KEY,
    path     TEXT NOT NULL,
    label    TEXT,
    icon     TEXT,
    position INTEGER
);

CREATE TABLE IF NOT EXISTS workspaces (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    layout  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_log (
    id         INTEGER PRIMARY KEY,
    timestamp  INTEGER NOT NULL,
    operation  TEXT NOT NULL,
    payload    TEXT NOT NULL,
    reverted   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_state (
    volume       TEXT PRIMARY KEY,
    journal_id   INTEGER NOT NULL,
    last_usn     INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: i64,
    pub extension: Option<String>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub accessed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderStats {
    pub folder_id: i64,
    pub total_size: i64,
    pub file_count: i64,
    pub direct_file_count: i64,
    pub subfolder_count: i64,
    pub deepest_file_depth: i64,
    pub last_modified: Option<i64>,
    pub computed_at: i64,
}
