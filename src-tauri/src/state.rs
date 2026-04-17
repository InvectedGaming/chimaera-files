use crate::terminal::{SharedTerminalManager, TerminalManager};
use crate::watcher::{FsWatcher, SharedWatcher};
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub watcher: SharedWatcher,
    pub terminals: SharedTerminalManager,
}

impl AppState {
    pub fn new(db_path: &Path) -> rusqlite::Result<Self> {
        let conn = chimaera_indexer::db::open(db_path)?;
        Ok(Self {
            db: Mutex::new(conn),
            watcher: Arc::new(Mutex::new(FsWatcher::new())),
            terminals: Arc::new(Mutex::new(TerminalManager::new())),
        })
    }
}
