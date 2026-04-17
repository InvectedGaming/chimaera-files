use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Holds the active directory watcher. When a new directory is watched,
/// the old watcher is dropped (stops watching).
pub struct FsWatcher {
    _debouncer: Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>,
    watched_path: Option<String>,
}

impl FsWatcher {
    pub fn new() -> Self {
        Self {
            _debouncer: None,
            watched_path: None,
        }
    }

    /// Start watching a directory. Replaces any previous watch.
    /// Emits "fs-changed" events with { path } when changes are detected.
    pub fn watch(&mut self, path: &str, app: AppHandle) -> Result<(), String> {
        // Stop previous watcher by dropping it
        self._debouncer = None;
        self.watched_path = None;

        let dir = PathBuf::from(path);
        if !dir.is_dir() {
            return Err(format!("Not a directory: {}", path));
        }

        let watched = path.to_string();
        let watched_for_event = watched.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(200),
            move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
                if let Ok(events) = result {
                    // Only emit if there are real changes (not just access)
                    let has_changes = events.iter().any(|e| e.kind == DebouncedEventKind::Any);
                    if has_changes {
                        let _ = app.emit(
                            "fs-changed",
                            serde_json::json!({ "path": watched_for_event }),
                        );
                    }
                }
            },
        )
        .map_err(|e| e.to_string())?;

        debouncer
            .watcher()
            .watch(&dir, notify::RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;

        self.watched_path = Some(watched);
        self._debouncer = Some(debouncer);

        Ok(())
    }

    pub fn unwatch(&mut self) {
        self._debouncer = None;
        self.watched_path = None;
    }
}

pub type SharedWatcher = Arc<Mutex<FsWatcher>>;
