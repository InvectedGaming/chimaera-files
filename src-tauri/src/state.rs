use crate::terminal::{SharedTerminalManager, TerminalManager};
use crate::watcher::{FsWatcher, SharedWatcher};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub type JournalWatchers = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub watcher: SharedWatcher,
    pub terminals: SharedTerminalManager,
    /// Stop flags for running journal watcher threads, keyed by volume root (e.g. `"C:/"`).
    pub journal_watchers: JournalWatchers,
}

impl AppState {
    pub fn new(db_path: &Path) -> rusqlite::Result<Self> {
        let conn = chimaera_indexer::db::open(db_path)?;
        Ok(Self {
            db: Mutex::new(conn),
            watcher: Arc::new(Mutex::new(FsWatcher::new())),
            terminals: Arc::new(Mutex::new(TerminalManager::new())),
            journal_watchers: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Acquire the DB mutex, recovering from poisoning.
    ///
    /// SQLite manages its own transactional integrity, so a panic in one
    /// command doesn't corrupt the database file. Without this, a single
    /// poisoned lock would break every subsequent command.
    pub fn db_lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
