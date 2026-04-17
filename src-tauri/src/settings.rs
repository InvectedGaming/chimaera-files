use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub default_path: String,
    pub show_hidden_files: bool,
    pub confirm_delete: bool,
    #[serde(default = "default_true")]
    pub animations_enabled: bool,
    #[serde(default)]
    pub indexed_drives: Vec<String>,
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
        }
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
