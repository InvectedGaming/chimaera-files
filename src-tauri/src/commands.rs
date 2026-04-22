use crate::archive;
use crate::file_ops;
use crate::settings;
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub extension: Option<String>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriveInfo {
    pub mount_point: String,
    pub label: String,
    pub total_space: u64,
    pub free_space: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderStatsResult {
    pub total_size: i64,
    pub file_count: i64,
    pub direct_file_count: i64,
    pub subfolder_count: i64,
}

/// List directory contents by reading the filesystem directly.
/// Also handles browsing inside zip archives.
#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileItem>, String> {
    // Special "drives://" path — return all drives as folder entries
    if path == "drives://" {
        let drives = get_drives();
        return Ok(drives
            .into_iter()
            .map(|d| {
                let mount = d.mount_point.replace('\\', "/");
                FileItem {
                    name: d.label,
                    path: mount,
                    is_directory: true,
                    size: d.total_space,
                    extension: None,
                    modified_at: None,
                }
            })
            .collect());
    }

    // Check if this is an archive path
    if let Some((archive_path, inner_path)) = archive::parse_archive_path(&path) {
        return archive::list_archive(&archive_path, &inner_path);
    }

    let target = PathBuf::from(&path);
    // Use fs::metadata which follows symlinks/junctions
    match std::fs::metadata(&target) {
        Ok(meta) if meta.is_dir() => {}
        _ => return Err(format!("Not a directory: {}", path)),
    }

    let mut items = Vec::new();
    let entries = std::fs::read_dir(&target).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path();
        let is_dir = metadata.is_dir();

        items.push(FileItem {
            name,
            path: normalize_path(&file_path),
            is_directory: is_dir,
            size: if is_dir { 0 } else { metadata.len() },
            extension: if is_dir {
                None
            } else {
                file_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
            },
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|t| {
                    t.duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_millis() as i64)
                }),
        });
    }

    // Sort: directories first, then alphabetical
    items.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

/// Compute folder sizes for a batch of paths.
/// Tries the index first, falls back to a shallow filesystem walk.
/// Returns a map of path -> size in bytes.
#[tauri::command]
pub async fn get_folder_sizes(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, u64>, String> {
    let mut result = std::collections::HashMap::new();

    // Try index first for all paths
    {
        let conn = state.db_lock();
        for path in &paths {
            if let Ok(Some(stats)) = chimaera_indexer::stats::get_folder_stats(&conn, path) {
                result.insert(path.clone(), stats.total_size as u64);
            }
        }
    }

    // For paths not in the index, do a filesystem walk (capped depth to stay fast)
    let missing: Vec<String> = paths
        .into_iter()
        .filter(|p| !result.contains_key(p))
        .collect();

    for path in missing {
        let size = dir_size_shallow(&path);
        result.insert(path, size);
    }

    Ok(result)
}

/// Quick recursive directory size. Caps at ~2 levels deep for speed,
/// using direct children sizes + immediate subfolder direct children.
fn dir_size_shallow(path: &str) -> u64 {
    let mut total: u64 = 0;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_file() {
            total += meta.len();
        } else if meta.is_dir() {
            // One level deeper
            if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                for sub in sub_entries.flatten() {
                    if let Ok(sm) = sub.metadata() {
                        if sm.is_file() {
                            total += sm.len();
                        }
                    }
                }
            }
        }
    }
    total
}

/// Navigate to a path, returning the directory listing.
#[tauri::command]
pub fn navigate_to(path: String) -> Result<Vec<FileItem>, String> {
    list_directory(path)
}

/// Get available drives on Windows with volume labels.
#[tauri::command]
pub fn get_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let mount = format!("{}:\\", letter as char);
        let path = PathBuf::from(&mount);
        if path.exists() {
            let volume_label = get_volume_label(&mount).unwrap_or_default();
            let label = if volume_label.is_empty() {
                format!("Local Disk ({}:)", letter as char)
            } else {
                format!("{} ({}:)", volume_label, letter as char)
            };
            let (total_space, free_space) = get_disk_space(&mount).unwrap_or((0, 0));
            drives.push(DriveInfo {
                mount_point: mount,
                label,
                total_space,
                free_space,
            });
        }
    }
    drives
}

#[cfg(target_os = "windows")]
fn get_volume_label(root: &str) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;

    let root_wide: Vec<u16> = OsStr::new(root).encode_wide().chain(Some(0)).collect();
    let mut label_buf = [0u16; 260];

    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW(
            root_wide.as_ptr(),
            label_buf.as_mut_ptr(),
            label_buf.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };

    if ok != 0 {
        let len = label_buf.iter().position(|&c| c == 0).unwrap_or(0);
        let name = String::from_utf16_lossy(&label_buf[..len]);
        if name.is_empty() { None } else { Some(name) }
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn get_volume_label(_root: &str) -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn get_disk_space(root: &str) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;

    let root_wide: Vec<u16> = OsStr::new(root).encode_wide().chain(Some(0)).collect();
    let mut free_bytes_available: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free_bytes: u64 = 0;

    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            root_wide.as_ptr(),
            &mut free_bytes_available as *mut u64,
            &mut total_bytes as *mut u64,
            &mut total_free_bytes as *mut u64,
        )
    };

    if ok != 0 {
        Some((total_bytes, total_free_bytes))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn get_disk_space(_root: &str) -> Option<(u64, u64)> {
    None
}

/// Search indexed files using FTS5.
#[tauri::command]
pub fn search_files(
    query: String,
    limit: Option<usize>,
    state: State<AppState>,
) -> Result<Vec<FileItem>, String> {
    let conn = state.db_lock();
    let results = chimaera_indexer::fts::search(&conn, &query, limit.unwrap_or(50))
        .map_err(|e| e.to_string())?;

    Ok(results
        .into_iter()
        .map(|f| FileItem {
            name: f.name,
            path: f.path,
            is_directory: f.is_directory,
            size: f.size as u64,
            extension: f.extension,
            modified_at: f.modified_at,
        })
        .collect())
}

/// Count matches per direct-child folder of `parent_path`.
/// Powers the "+N" badge on folder rows during type-ahead.
/// Returns an empty map if the drive isn't indexed or the query is empty.
#[tauri::command]
pub fn search_subtree_counts(
    query: String,
    parent_path: String,
    mode: Option<chimaera_indexer::search::MatchMode>,
    state: State<AppState>,
) -> Result<std::collections::HashMap<String, u64>, String> {
    let conn = state.db_lock();
    chimaera_indexer::search::count_subtree_matches(
        &conn,
        &query,
        &parent_path,
        mode.unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}

/// Get folder stats from the index.
#[tauri::command]
pub fn get_folder_stats(
    path: String,
    state: State<AppState>,
) -> Result<Option<FolderStatsResult>, String> {
    let conn = state.db_lock();
    let stats =
        chimaera_indexer::stats::get_folder_stats(&conn, &path).map_err(|e| e.to_string())?;

    Ok(stats.map(|s| FolderStatsResult {
        total_size: s.total_size,
        file_count: s.file_count,
        direct_file_count: s.direct_file_count,
        subfolder_count: s.subfolder_count,
    }))
}

/// Open a file with the default system application.
/// If the file is inside an archive, extract it to temp first.
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    // Check if this is a file inside an archive
    if let Some((archive_path, inner_path)) = archive::parse_archive_path(&path) {
        if !inner_path.is_empty() {
            // Extract to temp
            let data = archive::extract_file(&archive_path, &inner_path)?;
            let file_name = inner_path.split('/').last().unwrap_or("file");
            let temp_dir = std::env::temp_dir().join("chimaera-files-preview");
            std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
            let temp_path = temp_dir.join(file_name);
            std::fs::write(&temp_path, data).map_err(|e| e.to_string())?;
            return open::that(&temp_path).map_err(|e| e.to_string());
        }
    }
    open::that(&path).map_err(|e| e.to_string())
}

/// Open the "Open with" dialog for a file (Windows).
#[tauri::command]
pub fn open_file_with(path: String) -> Result<(), String> {
    // Only allow paths that resolve to an existing, regular file. This stops a
    // compromised frontend from passing arbitrary strings as process arguments.
    let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let meta = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("open_file_with requires a regular file".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .arg("shell32.dll,OpenAs_RunDLL")
            .arg(canonical.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        open::that(&canonical).map_err(|e| e.to_string())
    }
}

/// Read a file's bytes as base64 — works for both regular files and files inside archives.
/// Caps at 200MB.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<String, String> {
    use base64::Engine;

    let data = if let Some((archive_path, inner_path)) = archive::parse_archive_path(&path) {
        if !inner_path.is_empty() {
            archive::extract_file(&archive_path, &inner_path)?
        } else {
            std::fs::read(&path).map_err(|e| e.to_string())?
        }
    } else {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > 200 * 1024 * 1024 {
            return Err("File too large for byte loading".to_string());
        }
        std::fs::read(&path).map_err(|e| e.to_string())?
    };

    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// For large media files: copies/symlinks to a temp location and returns a path
/// the webview can use. For archive files, extracts to temp.
#[tauri::command]
pub fn prepare_media_file(path: String) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("chimaera-files-preview");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    if let Some((archive_path, inner_path)) = archive::parse_archive_path(&path) {
        if !inner_path.is_empty() {
            let data = archive::extract_file(&archive_path, &inner_path)?;
            let file_name = inner_path.split('/').last().unwrap_or("file");
            let temp_path = temp_dir.join(file_name);
            std::fs::write(&temp_path, data).map_err(|e| e.to_string())?;
            return Ok(temp_path.to_string_lossy().replace('\\', "/"));
        }
    }

    // For regular files, create a hard link or copy
    let file_name = std::path::Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let temp_path = temp_dir.join(&file_name);

    // Remove stale temp file
    let _ = std::fs::remove_file(&temp_path);

    // Try hard link first (instant, no copy), fall back to copy
    if std::fs::hard_link(&path, &temp_path).is_err() {
        std::fs::copy(&path, &temp_path).map_err(|e| e.to_string())?;
    }

    Ok(temp_path.to_string_lossy().replace('\\', "/"))
}

/// Check if a path is a browsable archive.
#[tauri::command]
pub fn is_archive_path(path: String) -> bool {
    archive::is_archive(&path)
}

/// Extract an entire archive to a destination.
#[tauri::command]
pub fn extract_archive(archive_path: String, dest_dir: String) -> Result<String, String> {
    archive::extract_all(&archive_path, &dest_dir)
}

/// Get known Windows folder paths (Documents, Downloads, Pictures, etc.)
#[tauri::command]
pub fn get_known_folders() -> std::collections::HashMap<String, String> {
    let mut folders = std::collections::HashMap::new();

    let known = [
        ("Desktop", dirs::desktop_dir()),
        ("Documents", dirs::document_dir()),
        ("Downloads", dirs::download_dir()),
        ("Pictures", dirs::picture_dir()),
        ("Music", dirs::audio_dir()),
        ("Videos", dirs::video_dir()),
    ];

    for (name, path) in known {
        if let Some(p) = path {
            let normalized = normalize_path(&p);
            folders.insert(name.to_string(), normalized);
        }
    }

    if let Some(home) = dirs::home_dir() {
        folders.insert("Home".to_string(), normalize_path(&home));
    }

    folders
}

/// Watch a directory for changes. Emits "fs-changed" events.
#[tauri::command]
pub fn watch_directory(
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    watcher.watch(&path, app)
}

/// Stop watching the current directory.
#[tauri::command]
pub fn unwatch_directory(state: State<AppState>) -> Result<(), String> {
    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    watcher.unwatch();
    Ok(())
}

/// Get the user's home directory.
#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| normalize_path(&p))
        .ok_or_else(|| "Could not determine home directory".to_string())
}

fn normalize_path(path: &std::path::Path) -> String {
    let s = path.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    s.replace('\\', "/")
}

// --- Settings commands ---

#[tauri::command]
pub fn get_settings() -> settings::Settings {
    settings::load()
}

#[tauri::command]
pub fn save_settings(settings: settings::Settings) -> Result<(), String> {
    settings::save(&settings)
}

// --- Index management commands ---

#[derive(Debug, Clone, Serialize)]
pub struct DriveIndexInfo {
    pub drive: String,
    pub label: String,
    pub enabled: bool,
    /// Live row count in the `files` table for this drive. Reflects whatever
    /// rows exist right now — partial during a scan, complete after one.
    pub file_count: i64,
    pub dir_count: i64,
    pub total_size: i64,
    pub last_indexed: Option<i64>,
    pub drive_total_bytes: u64,
    pub drive_free_bytes: u64,
    /// File count recorded by `folder_stats` at the most recent fully
    /// completed scan. Used as the denominator in "X of Y indexed" labels.
    /// `None` if the drive has never finished a scan.
    pub baseline_file_count: Option<i64>,
    /// How this drive's index is kept in sync. Defaults to `Auto`.
    pub sync_mode: settings::DriveSyncMode,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStatus {
    pub total_files: i64,
    pub total_dirs: i64,
    pub db_size_bytes: u64,
    pub drives: Vec<DriveIndexInfo>,
}

/// Update a drive's sync mode (auto / manual / timed).
/// Lifecycle changes (timer start/stop, watcher start/stop) are handled on
/// next app launch — the new mode persists immediately.
#[tauri::command]
pub fn set_drive_sync_mode(
    drive: String,
    mode: settings::DriveSyncMode,
) -> Result<(), String> {
    let mut cfg = settings::load();
    let key = drive.replace('\\', "/");
    cfg.drive_sync_modes.insert(key, mode);
    settings::save(&cfg)
}

/// Trigger a fresh full scan of a drive. Goes through the same serial
/// worker queue as the auto-rescan path, so it composes correctly with
/// other in-flight scans.
#[tauri::command]
pub fn rescan_drive(drive: String, state: State<AppState>) -> Result<String, String> {
    use crate::indexer_worker::IndexCommand;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let drive_normalized = drive.replace('\\', "/");

    // Fresh cancel flag — replace any prior one for this drive (which would
    // have belonged to a completed scan and is no longer useful).
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = state.index_cancel_flags.lock() {
        if let Some(prev) = map.insert(drive_normalized.clone(), cancel.clone()) {
            // Stop any in-flight scan for this drive before starting a new one.
            prev.store(true, Ordering::Relaxed);
        }
    }

    // Drop the "fully scanned" flag — a fresh scan is starting.
    settings::unmark_scan_complete(&drive_normalized);

    state
        .index_tx
        .lock()
        .map_err(|_| "index channel lock poisoned".to_string())?
        .send(IndexCommand::Enqueue {
            drive: drive_normalized.clone(),
            cancel,
        })
        .map_err(|_| "indexer worker has stopped".to_string())?;

    Ok(format!("Rescan queued for {}", drive))
}

/// Download an installer to `%TEMP%` and spawn it, then exit the current
/// app so the installer can overwrite the running binary. `installer_name`
/// is used as the temp filename (e.g. `"chimaera-setup.exe"`).
///
/// Uses bundled `curl.exe` (shipped with Windows 10 1803+) to avoid pulling
/// in an HTTP client crate just for this. No cryptographic signature check —
/// by default Windows SmartScreen / UAC is the gate.
#[tauri::command]
pub async fn download_and_run_installer(
    url: String,
    installer_name: String,
) -> Result<(), String> {
    use std::process::Command;

    // Sanitize the filename — don't let a malicious manifest drop a file
    // with path separators in %TEMP%.
    if installer_name.contains('/')
        || installer_name.contains('\\')
        || installer_name.contains("..")
    {
        return Err("Invalid installer filename".to_string());
    }

    let dest = std::env::temp_dir().join(&installer_name);

    // Stream the download; `-L` follows redirects (GitHub's release download
    // URLs redirect to a CDN), `-f` fails on HTTP errors, `-sS` keeps the
    // output quiet but still surfaces fatal errors, `-o` writes to disk.
    let status = Command::new("curl.exe")
        .args(["-L", "-f", "-sS", "-o"])
        .arg(&dest)
        .arg(&url)
        .status()
        .map_err(|e| format!("failed to spawn curl: {}", e))?;
    if !status.success() {
        return Err(format!("curl exited with status {}", status));
    }

    // Launch the installer. Per-machine NSIS/MSI installers self-elevate
    // and show a UAC prompt. Detach so it survives this process exiting.
    Command::new(&dest)
        .spawn()
        .map_err(|e| format!("failed to launch installer: {}", e))?;

    // Give the installer a brief head start before we exit, otherwise
    // Windows may kill the fresh installer process as our parent dies.
    std::thread::sleep(std::time::Duration::from_millis(300));
    std::process::exit(0);
}

/// Install the "Open in Chimaera" right-click shell integration (HKCU,
/// no admin needed). On Windows 11 the entry appears under "Show more
/// options" until we ship an `IExplorerCommand` shell extension.
#[cfg(windows)]
#[tauri::command]
pub fn install_shell_integration() -> Result<(), String> {
    crate::shell_integration::install().map_err(|e| e.to_string())
}

#[cfg(windows)]
#[tauri::command]
pub fn uninstall_shell_integration() -> Result<(), String> {
    crate::shell_integration::uninstall().map_err(|e| e.to_string())
}

#[cfg(windows)]
#[tauri::command]
pub fn is_shell_integration_installed() -> bool {
    crate::shell_integration::is_installed()
}

// Non-windows stubs so the frontend can call the commands unconditionally.
#[cfg(not(windows))]
#[tauri::command]
pub fn install_shell_integration() -> Result<(), String> {
    Err("Shell integration is Windows-only".to_string())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn uninstall_shell_integration() -> Result<(), String> {
    Err("Shell integration is Windows-only".to_string())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn is_shell_integration_installed() -> bool {
    false
}

/// If the app was invoked from the shell with a path argument (e.g.
/// `"C:\foo" "bar"`), this returns that path once and clears it — the
/// frontend calls it on mount to honour the launch target.
#[tauri::command]
pub fn take_pending_open_path(state: State<AppState>) -> Option<String> {
    let mut guard = state.pending_open_path.lock().ok()?;
    guard.take()
}

/// Hide the launcher popup. Called from the launcher on Esc / blur.
#[tauri::command]
pub fn hide_launcher(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("launcher") {
        let _ = w.hide();
    }
}

/// Hide the launcher and navigate the main window to `path`.
/// Used when the user picks a folder from the launcher.
#[tauri::command]
pub fn launcher_navigate(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    if let Some(lw) = app.get_webview_window("launcher") {
        let _ = lw.hide();
    }
    if let Some(mw) = app.get_webview_window("main") {
        let _ = mw.show();
        let _ = mw.set_focus();
        app.emit("open-path", path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Debug helper: returns a summary of what's actually in `files` and
/// `folder_stats` per drive root so we can diagnose why the UI shows 0
/// even after a successful scan.
#[tauri::command]
pub fn debug_folder_stats(
    state: State<AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.db_lock();
    let drives = ["C:", "D:", "E:", "G:"];
    let mut out = Vec::new();
    for drive in &drives {
        let prefix_like = format!("{}/%", drive);

        let root_row: Option<(i64, i32)> = conn
            .query_row(
                "SELECT id, is_directory FROM files WHERE path = ?1",
                [*drive],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        let files_under: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM files WHERE path = ?1 OR path LIKE ?2",
                [*drive, &prefix_like],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let stats_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM folder_stats fs
                 JOIN files f ON f.id = fs.folder_id
                 WHERE f.path = ?1 OR f.path LIKE ?2",
                [*drive, &prefix_like],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let root_stats: Option<(i64, i64)> = conn
            .query_row(
                "SELECT fs.file_count, fs.total_size FROM folder_stats fs
                 JOIN files f ON f.id = fs.folder_id
                 WHERE f.path = ?1",
                [*drive],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();

        out.push(serde_json::json!({
            "drive": drive,
            "root_files_row": root_row.map(|(id, isdir)| serde_json::json!({"id": id, "is_dir": isdir})),
            "files_table_count_under_prefix": files_under,
            "folder_stats_count_under_prefix": stats_rows,
            "root_folder_stats": root_stats.map(|(fc, sz)| serde_json::json!({"file_count": fc, "total_size": sz})),
        }));
    }
    Ok(out)
}

/// Snapshot of drives whose scans are in-flight (queued / scanning /
/// computing_stats). Terminal-phase drives are not included. Used by the
/// Settings UI on mount to display the current state without having to
/// catch the original `"index-progress"` events.
#[tauri::command]
pub fn get_indexing_state(
    state: State<AppState>,
) -> Result<Vec<crate::state::ActiveIndexProgress>, String> {
    let guard = state
        .active_index
        .lock()
        .map_err(|_| "active_index lock poisoned".to_string())?;
    Ok(guard.values().cloned().collect())
}

/// Get index status per drive.
#[tauri::command]
pub fn get_index_status(state: State<AppState>) -> Result<IndexStatus, String> {
    let conn = state.db_lock();
    let cfg = settings::load();

    let db_path = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("chimaera-files")
        .join("index.db");
    let db_size_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

    // Build drive list with index stats
    let all_drives = get_drives();
    let mut drives = Vec::new();

    for drv in &all_drives {
        let mount_fwd = drv.mount_point.replace('\\', "/");
        let enabled = cfg.indexed_drives.iter().any(|d| d.replace('\\', "/") == mount_fwd);
        // The walker canonicalizes drive roots and stores them WITHOUT a
        // trailing slash (e.g. `"C:"` not `"C:/"`), so we have to look up
        // by the trimmed form. This bit me — see git log.
        let prefix_trimmed = mount_fwd.trim_end_matches('/').to_string();

        // Pull the per-drive aggregate from folder_stats (one indexed lookup
        // per drive — was an O(N) SUM over the files table, which is
        // multi-second on a 700k-row index).
        let stats: (i64, i64, i64, i64, Option<i64>) = conn
            .query_row(
                "SELECT
                    fs.file_count,
                    fs.subfolder_count,
                    fs.total_size,
                    fs.file_count,
                    fs.computed_at
                 FROM folder_stats fs
                 JOIN files f ON f.id = fs.folder_id
                 WHERE f.path = ?1",
                [&prefix_trimmed],
                |row| Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                )),
            )
            .unwrap_or((0, 0, 0, 0, None));
        let (file_count, dir_count, total_size, baseline, last_indexed) = stats;
        let baseline_file_count = if baseline > 0 { Some(baseline) } else { None };

        let sync_mode = settings::sync_mode_for(&cfg, &mount_fwd);
        drives.push(DriveIndexInfo {
            drive: mount_fwd,
            label: drv.label.clone(),
            enabled,
            file_count,
            dir_count,
            total_size,
            last_indexed,
            drive_total_bytes: drv.total_space,
            drive_free_bytes: drv.free_space,
            baseline_file_count,
            sync_mode,
        });
    }

    // Roll up totals from per-drive numbers — much faster than COUNT(*)
    // over the whole files table, which is multi-second on a large index.
    let total_files: i64 = drives.iter().map(|d| d.file_count).sum();
    let total_dirs: i64 = drives.iter().map(|d| d.dir_count).sum();

    Ok(IndexStatus {
        total_files,
        total_dirs,
        db_size_bytes,
        drives,
    })
}

/// Toggle a drive's indexing on or off.
///
/// Enabling queues the drive on the serial indexer worker — the command
/// returns immediately and the worker emits `"index-progress"` events as
/// it picks up the job. Disabling flips the per-drive cancel flag (which
/// stops either a queued or an in-flight scan) and removes the drive's
/// existing rows from the DB.
#[tauri::command]
pub async fn toggle_drive_index(
    drive: String,
    enabled: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    use crate::indexer_worker::IndexCommand;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    // Update settings. Any toggle resets the fully-scanned flag for this
    // drive — either the scan is starting over (enable) or the drive is
    // leaving the index (disable).
    let mut cfg = settings::load();
    let drive_normalized = drive.replace('\\', "/");
    cfg.indexed_drives.retain(|d| d.replace('\\', "/") != drive_normalized);
    cfg.fully_scanned_drives.retain(|d| d.replace('\\', "/") != drive_normalized);
    if enabled {
        cfg.indexed_drives.push(drive_normalized.clone());
    }
    settings::save(&cfg)?;

    if enabled {
        // Build a fresh cancel flag and hand a clone to the worker. We
        // keep the original on `state` so a later disable can flip it.
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = state.index_cancel_flags.lock() {
            // If we're re-enabling a drive that was previously queued,
            // replace the old flag (the old job is either done or will
            // see its old flag and exit harmlessly).
            map.insert(drive_normalized.clone(), cancel.clone());
        }
        state
            .index_tx
            .lock()
            .map_err(|_| "index channel lock poisoned".to_string())?
            .send(IndexCommand::Enqueue {
                drive: drive_normalized.clone(),
                cancel,
            })
            .map_err(|_| "indexer worker has stopped".to_string())?;

        // Also start the realtime drive watcher so file changes made
        // during or after the scan patch the index immediately.
        let watcher_stop = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = state.journal_watchers.lock() {
            if let Some(prev) = map.insert(drive_normalized.clone(), watcher_stop.clone()) {
                prev.store(true, Ordering::Relaxed);
            }
        }
        // Shared pause flag with the worker — flipped during scans so the
        // watcher's upserts don't contend for the DB lock while the walker
        // is doing its big DELETE+INSERT sweep.
        let pause_flag = {
            let mut map = state
                .drive_pause_flags
                .lock()
                .map_err(|_| "drive_pause_flags poisoned".to_string())?;
            map.entry(drive_normalized.clone())
                .or_insert_with(|| Arc::new(AtomicBool::new(false)))
                .clone()
        };
        let db_path = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("chimaera-files")
            .join("index.db");
        crate::drive_watcher::spawn(
            db_path,
            drive_normalized.clone(),
            watcher_stop,
            pause_flag,
            app.clone(),
        );

        Ok(format!("Indexing queued for {}", drive))
    } else {
        // 1) Signal any running / queued job for this drive to stop.
        if let Ok(mut map) = state.index_cancel_flags.lock() {
            if let Some(flag) = map.remove(&drive_normalized) {
                flag.store(true, Ordering::Relaxed);
            }
        }
        // 2) Tell the worker to drop the entry if it's still queued
        //    (no-op if it's already running — the cancel flag handles that).
        if let Ok(tx) = state.index_tx.lock() {
            let _ = tx.send(IndexCommand::CancelQueued {
                drive: drive_normalized.clone(),
            });
        }

        // 3) Signal the journal watcher thread to exit before tearing down its data.
        if let Ok(mut map) = state.journal_watchers.lock() {
            if let Some(stop) = map.remove(&drive_normalized) {
                stop.store(true, Ordering::Relaxed);
            }
        }

        // Remove synchronously — it's fast
        let conn = state.db_lock();
        let _ = conn.execute_batch("COMMIT");
        conn.execute_batch("PRAGMA foreign_keys = OFF").map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM folder_stats WHERE folder_id IN (SELECT id FROM files WHERE path = ?1 OR path LIKE ?1 || '%')",
            [&drive_normalized],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM files WHERE path = ?1 OR path LIKE ?1 || '%'",
            [&drive_normalized],
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON").map_err(|e| e.to_string())?;
        let _ = chimaera_indexer::fts::populate(&conn);

        Ok(format!("Removed index for {}", drive))
    }
}

/// Index a directory path. Kept for backwards compat / manual use.
#[tauri::command]
pub async fn start_index(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let target = PathBuf::from(&path);
    match std::fs::metadata(&target) {
        Ok(meta) if meta.is_dir() => {}
        _ => return Err(format!("Not a directory: {}", path)),
    }

    let conn = state.db_lock();

    let stats = chimaera_indexer::walker::index_directory(&conn, &target)
        .map_err(|e| e.to_string())?;

    chimaera_indexer::stats::compute_all(&conn).map_err(|e| e.to_string())?;
    chimaera_indexer::fts::populate(&conn).map_err(|e| e.to_string())?;

    Ok(format!(
        "Indexed {} files, {} directories",
        stats.files_inserted, stats.dirs_inserted
    ))
}

/// Remove all indexed data for a root path.
#[tauri::command]
pub fn remove_index(path: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db_lock();
    let p = path.replace('\\', "/");

    conn.execute(
        "DELETE FROM folder_stats WHERE folder_id IN (SELECT id FROM files WHERE path = ?1 OR path LIKE ?1 || '%')",
        [&p],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM files WHERE path = ?1 OR path LIKE ?1 || '%'", [&p])
        .map_err(|e| e.to_string())?;

    chimaera_indexer::fts::populate(&conn).map_err(|e| e.to_string())?;

    Ok(())
}

// --- File operations ---

#[tauri::command]
pub fn copy_files(sources: Vec<String>, dest_dir: String, state: State<AppState>) -> file_ops::OpResult {
    let result = file_ops::copy_files(&sources, &dest_dir);
    if result.success {
        {
            let conn = state.db_lock();
            file_ops::log_operation(&conn, "copy", &serde_json::json!({ "sources": sources, "dest": dest_dir }));
        }
    }
    result
}

#[tauri::command]
pub fn move_files(sources: Vec<String>, dest_dir: String, state: State<AppState>) -> file_ops::OpResult {
    let result = file_ops::move_files(&sources, &dest_dir);
    if result.success {
        {
            let conn = state.db_lock();
            file_ops::log_operation(&conn, "move", &serde_json::json!({ "sources": sources, "dest": dest_dir }));
        }
    }
    result
}

#[tauri::command]
pub fn delete_files(paths: Vec<String>, state: State<AppState>) -> file_ops::OpResult {
    let result = file_ops::delete_files(&paths);
    if result.success {
        {
            let conn = state.db_lock();
            file_ops::log_operation(&conn, "delete", &serde_json::json!({ "paths": paths }));
        }
    }
    result
}

#[tauri::command]
pub fn rename_file(path: String, new_name: String, state: State<AppState>) -> file_ops::OpResult {
    let result = file_ops::rename_file(&path, &new_name);
    if result.success {
        {
            let conn = state.db_lock();
            file_ops::log_operation(&conn, "rename", &serde_json::json!({ "path": path, "new_name": new_name }));
        }
    }
    result
}

#[tauri::command]
pub fn create_folder(parent_dir: String, name: String) -> file_ops::OpResult {
    file_ops::create_folder(&parent_dir, &name)
}

#[tauri::command]
pub fn undo_last_operation(state: State<AppState>) -> Result<String, String> {
    let conn = state.db_lock();

    let row: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT id, operation, payload FROM undo_log WHERE reverted = 0 ORDER BY id DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    let Some((id, operation, payload_str)) = row else {
        return Ok("Nothing to undo".to_string());
    };

    let payload: serde_json::Value = serde_json::from_str(&payload_str).map_err(|e| e.to_string())?;

    let message = match operation.as_str() {
        "move" => {
            // Reverse: move files back from dest to original locations
            if let (Some(sources), Some(dest)) = (
                payload["sources"].as_array(),
                payload["dest"].as_str(),
            ) {
                for src in sources {
                    if let Some(original_path) = src.as_str() {
                        let file_name = std::path::Path::new(original_path)
                            .file_name()
                            .unwrap_or_default();
                        let current = PathBuf::from(dest).join(file_name);
                        if current.exists() {
                            let _ = std::fs::rename(&current, original_path);
                        }
                    }
                }
                format!("Undid move of {} items", sources.len())
            } else {
                "Could not undo move".to_string()
            }
        }
        "rename" => {
            if let (Some(original_path), Some(new_name)) = (
                payload["path"].as_str(),
                payload["new_name"].as_str(),
            ) {
                let parent = std::path::Path::new(original_path).parent().unwrap_or(std::path::Path::new(""));
                let current = parent.join(new_name);
                let original_name = std::path::Path::new(original_path)
                    .file_name()
                    .unwrap_or_default();
                if current.exists() {
                    let _ = std::fs::rename(&current, original_path);
                    format!("Undid rename: {} back to {:?}", new_name, original_name)
                } else {
                    "Renamed file no longer exists".to_string()
                }
            } else {
                "Could not undo rename".to_string()
            }
        }
        "delete" => {
            "Cannot undo delete — items are in the Recycle Bin".to_string()
        }
        _ => format!("Cannot undo operation: {}", operation),
    };

    let _ = conn.execute("UPDATE undo_log SET reverted = 1 WHERE id = ?1", [id]);

    Ok(message)
}

/// Read a file's content for preview (first N bytes as text).
#[tauri::command]
pub fn read_file_preview(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let max = max_bytes.unwrap_or(64 * 1024); // 64KB default
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let slice = &data[..data.len().min(max)];
    Ok(String::from_utf8_lossy(slice).to_string())
}

/// Read a file's full text content for editing. Caps at 5MB.
#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 5 * 1024 * 1024 {
        return Err("File too large to edit (>5MB)".to_string());
    }
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&data).to_string())
}

/// Write text content to a file.
#[tauri::command]
pub fn write_file_text(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// Get file metadata for preview panel.
#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let p = std::path::Path::new(&path);

    Ok(FileMetadata {
        name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
        path: path.replace('\\', "/"),
        size: meta.len(),
        is_directory: meta.is_dir(),
        created_at: meta.created().ok().and_then(|t| {
            t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
        }),
        modified_at: meta.modified().ok().and_then(|t| {
            t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
        }),
        extension: p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_directory: bool,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub extension: Option<String>,
}

// --- Workspace commands ---

#[tauri::command]
pub fn get_workspace() -> settings::WorkspaceState {
    settings::load_workspace()
}

#[tauri::command]
pub fn save_workspace(state: settings::WorkspaceState) -> Result<(), String> {
    settings::save_workspace(&state)
}

// --- Terminal commands ---

#[tauri::command]
pub fn terminal_spawn(
    cwd: String,
    shell: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<u32, String> {
    use tauri::Emitter;
    let mut mgr = state.terminals.lock().map_err(|e| e.to_string())?;
    let app_clone = app.clone();
    mgr.spawn(
        &cwd,
        shell.as_deref(),
        Box::new(move |id, data| {
            let _ = app_clone.emit(
                "terminal-output",
                serde_json::json!({ "id": id, "data": data }),
            );
        }),
    )
}

#[tauri::command]
pub fn terminal_write(id: u32, data: Vec<u8>, state: State<AppState>) -> Result<(), String> {
    let mut mgr = state.terminals.lock().map_err(|e| e.to_string())?;
    mgr.write(id, &data)
}

#[tauri::command]
pub fn terminal_resize(id: u32, cols: u16, rows: u16, state: State<AppState>) -> Result<(), String> {
    let mut mgr = state.terminals.lock().map_err(|e| e.to_string())?;
    mgr.resize(id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(id: u32, state: State<AppState>) -> Result<(), String> {
    let mut mgr = state.terminals.lock().map_err(|e| e.to_string())?;
    mgr.close(id);
    Ok(())
}
