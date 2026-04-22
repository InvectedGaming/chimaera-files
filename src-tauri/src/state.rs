use crate::indexer_worker::IndexCommand;
use crate::terminal::{SharedTerminalManager, TerminalManager};
use crate::watcher::{FsWatcher, SharedWatcher};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};

pub type JournalWatchers = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;
pub type IndexCancelFlags = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

/// A snapshot of the latest progress payload for a drive that is currently
/// scanning / queued. Terminal-phase drives (done / cancelled / error) are
/// removed from the map so a mount-time query reflects only live work.
#[derive(Debug, Clone, Serialize)]
pub struct ActiveIndexProgress {
    pub drive: String,
    pub phase: String,
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub position: Option<u32>,
}

pub type ActiveIndexState = Arc<Mutex<HashMap<String, ActiveIndexProgress>>>;

/// Per-drive "pause watcher writes" flags. Set to `true` by the indexer
/// worker for the duration of a walker scan on that drive, so the realtime
/// `drive_watcher` doesn't race the walker for the DB write lock — its
/// in-flight events would be redundant anyway because the walker is about
/// to re-insert every row from scratch.
pub type DrivePauseFlags = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub watcher: SharedWatcher,
    pub terminals: SharedTerminalManager,
    /// Stop flags for running journal watcher threads, keyed by volume root (e.g. `"C:/"`).
    pub journal_watchers: JournalWatchers,
    /// Sends index jobs / cancellations to the worker thread spawned in `setup`.
    /// Wrapped in a `Mutex` because `mpsc::Sender` is `Send` but not `Sync`,
    /// and Tauri's `State<AppState>` gives out `&self` across threads.
    pub index_tx: Mutex<Sender<IndexCommand>>,
    /// Shared cancel flags per drive. Flipping one aborts both a queued
    /// job (before the worker picks it up) and an in-flight walker.
    pub index_cancel_flags: IndexCancelFlags,
    /// Most recent non-terminal progress per drive. Allows a newly mounted
    /// Settings page to display current scan state without relying on having
    /// caught the original `"index-progress"` event.
    pub active_index: ActiveIndexState,
    /// Path the app was launched to navigate to (from shell integration or
    /// a double-click). Cleared by the first call to `take_pending_open_path`.
    pub pending_open_path: Arc<Mutex<Option<String>>>,
    /// Pause flags shared with the realtime drive watcher. See
    /// [`DrivePauseFlags`] for the "why".
    pub drive_pause_flags: DrivePauseFlags,
}

impl AppState {
    /// Creates state + the receiver end of the indexer channel. The caller
    /// (tauri `setup`) spawns the worker thread with the receiver.
    pub fn new(db_path: &Path) -> rusqlite::Result<(Self, Receiver<IndexCommand>)> {
        let conn = chimaera_indexer::db::open(db_path)?;
        let (tx, rx) = crate::indexer_worker::make_channel();
        let state = Self {
            db: Mutex::new(conn),
            watcher: Arc::new(Mutex::new(FsWatcher::new())),
            terminals: Arc::new(Mutex::new(TerminalManager::new())),
            journal_watchers: Arc::new(Mutex::new(HashMap::new())),
            index_tx: Mutex::new(tx),
            index_cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            active_index: Arc::new(Mutex::new(HashMap::new())),
            pending_open_path: Arc::new(Mutex::new(None)),
            drive_pause_flags: Arc::new(Mutex::new(HashMap::new())),
        };
        Ok((state, rx))
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
