use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// How a drive's index is kept in sync with the filesystem.
///
/// All modes are independent of the `enabled` flag — disabling a drive
/// drops it from the index entirely regardless of mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DriveSyncMode {
    /// Realtime watcher + auto-rescan on incomplete startup. Default.
    Auto,
    /// No automatic activity. User triggers rescans via the Rescan button.
    /// The realtime fs watcher is also off — the index drifts from disk
    /// reality until the next manual scan.
    Manual,
    /// Realtime watcher + scheduled full rescan every N minutes.
    Timed { interval_minutes: u32 },
}

impl Default for DriveSyncMode {
    fn default() -> Self {
        DriveSyncMode::Auto
    }
}

/// Which channel the auto-updater follows.
///
///   Stable  — tagged releases from the main branch. Recommended.
///   Beta    — pre-release tagged builds.
///   Dev     — HEAD of the main branch, auto-built by CI on every commit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
    Dev,
}

impl Default for UpdateChannel {
    fn default() -> Self {
        UpdateChannel::Stable
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub default_path: String,
    pub show_hidden_files: bool,
    pub confirm_delete: bool,
    #[serde(default = "default_true")]
    pub animations_enabled: bool,
    #[serde(default)]
    pub indexed_drives: Vec<String>,
    /// Drives whose most recent scan ran to completion. Used at startup to
    /// auto-requeue drives that were interrupted (app killed mid-scan,
    /// cancelled, errored). A drive in `indexed_drives` but not here is
    /// considered "incomplete" and gets rescanned on next launch.
    #[serde(default)]
    pub fully_scanned_drives: Vec<String>,
    /// Sync mode per drive (forward-slash form). Drives without an entry
    /// fall back to `DriveSyncMode::default()` (Auto).
    #[serde(default)]
    pub drive_sync_modes: HashMap<String, DriveSyncMode>,
    #[serde(default)]
    pub update_channel: UpdateChannel,
    #[serde(default = "default_true")]
    pub update_auto_check: bool,
}

fn default_true() -> bool { true }

impl Default for Settings {
    fn default() -> Self {
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| "C:/".to_string());
        Self {
            default_path: home,
            show_hidden_files: false,
            confirm_delete: true,
            animations_enabled: true,
            indexed_drives: Vec::new(),
            fully_scanned_drives: Vec::new(),
            drive_sync_modes: HashMap::new(),
            update_channel: UpdateChannel::Stable,
            update_auto_check: true,
        }
    }
}

/// Look up a drive's sync mode (defaults to Auto if no entry).
pub fn sync_mode_for(cfg: &Settings, drive: &str) -> DriveSyncMode {
    let key = drive.replace('\\', "/");
    cfg.drive_sync_modes
        .get(&key)
        .cloned()
        .unwrap_or_default()
}

/// Mark a drive as having completed a full scan.
pub fn mark_scan_complete(drive: &str) {
    let mut cfg = load();
    let d = drive.replace('\\', "/");
    if !cfg.fully_scanned_drives.iter().any(|x| x.replace('\\', "/") == d) {
        cfg.fully_scanned_drives.push(d);
        let _ = save(&cfg);
    }
}

/// Remove a drive from the fully-scanned set (scan is starting over or failed).
pub fn unmark_scan_complete(drive: &str) {
    let mut cfg = load();
    let d = drive.replace('\\', "/");
    let before = cfg.fully_scanned_drives.len();
    cfg.fully_scanned_drives.retain(|x| x.replace('\\', "/") != d);
    if cfg.fully_scanned_drives.len() != before {
        let _ = save(&cfg);
    }
}

// --- Workspace state ---

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceState {
    #[serde(default)]
    pub tabs: Vec<WorkspaceTab>,
    #[serde(default)]
    pub active_tab_index: usize,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: f64,
    #[serde(default)]
    pub terminal_visible: bool,
    #[serde(default = "default_terminal_height")]
    pub terminal_height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceTab {
    pub path: String,
    pub label: String,
}

fn default_sidebar_width() -> f64 { 240.0 }
fn default_terminal_height() -> f64 { 250.0 }

fn workspace_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("chimaera-files")
        .join("workspace.json")
}

pub fn load_workspace() -> WorkspaceState {
    let path = workspace_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        WorkspaceState::default()
    }
}

pub fn save_workspace(state: &WorkspaceState) -> Result<(), String> {
    let path = workspace_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn settings_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("chimaera-files")
        .join("settings.json")
}

pub fn load() -> Settings {
    let path = settings_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Settings::default()
    }
}

pub fn save(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}
