use rusqlite::params;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize)]
pub struct OpResult {
    pub success: bool,
    pub message: String,
}

/// Copy files to a destination directory.
pub fn copy_files(sources: &[String], dest_dir: &str) -> OpResult {
    let dest = PathBuf::from(dest_dir);
    if !dest.is_dir() {
        return OpResult {
            success: false,
            message: format!("Destination is not a directory: {}", dest_dir),
        };
    }

    let mut copied = 0;
    let mut errors = Vec::new();

    for src in sources {
        let src_path = PathBuf::from(src);
        let file_name = src_path.file_name().unwrap_or_default();
        let dest_path = dest.join(file_name);

        if src_path.is_dir() {
            match copy_dir_recursive(&src_path, &dest_path) {
                Ok(_) => copied += 1,
                Err(e) => errors.push(format!("{}: {}", src, e)),
            }
        } else {
            match std::fs::copy(&src_path, &dest_path) {
                Ok(_) => copied += 1,
                Err(e) => errors.push(format!("{}: {}", src, e)),
            }
        }
    }

    if errors.is_empty() {
        OpResult {
            success: true,
            message: format!("Copied {} items", copied),
        }
    } else {
        OpResult {
            success: false,
            message: format!("Copied {} items, {} errors: {}", copied, errors.len(), errors.join("; ")),
        }
    }
}

/// Move files to a destination directory.
pub fn move_files(sources: &[String], dest_dir: &str) -> OpResult {
    let dest = PathBuf::from(dest_dir);
    if !dest.is_dir() {
        return OpResult {
            success: false,
            message: format!("Destination is not a directory: {}", dest_dir),
        };
    }

    let mut moved = 0;
    let mut errors = Vec::new();

    for src in sources {
        let src_path = PathBuf::from(src);
        let file_name = src_path.file_name().unwrap_or_default();
        let dest_path = dest.join(file_name);

        match std::fs::rename(&src_path, &dest_path) {
            Ok(_) => moved += 1,
            Err(_) => {
                // rename fails across volumes — fall back to copy + delete
                if src_path.is_dir() {
                    match copy_dir_recursive(&src_path, &dest_path) {
                        Ok(_) => {
                            let _ = std::fs::remove_dir_all(&src_path);
                            moved += 1;
                        }
                        Err(e) => errors.push(format!("{}: {}", src, e)),
                    }
                } else {
                    match std::fs::copy(&src_path, &dest_path) {
                        Ok(_) => {
                            let _ = std::fs::remove_file(&src_path);
                            moved += 1;
                        }
                        Err(e) => errors.push(format!("{}: {}", src, e)),
                    }
                }
            }
        }
    }

    if errors.is_empty() {
        OpResult {
            success: true,
            message: format!("Moved {} items", moved),
        }
    } else {
        OpResult {
            success: false,
            message: format!("Moved {}, {} errors: {}", moved, errors.len(), errors.join("; ")),
        }
    }
}

/// Delete files to Recycle Bin (Windows) or permanent delete (other OS).
pub fn delete_files(paths: &[String]) -> OpResult {
    let mut deleted = 0;
    let mut errors = Vec::new();

    for path in paths {
        match trash::delete(path) {
            Ok(_) => deleted += 1,
            Err(e) => errors.push(format!("{}: {}", path, e)),
        }
    }

    if errors.is_empty() {
        OpResult {
            success: true,
            message: format!("Deleted {} items to Recycle Bin", deleted),
        }
    } else {
        OpResult {
            success: false,
            message: format!("Deleted {}, {} errors: {}", deleted, errors.len(), errors.join("; ")),
        }
    }
}

/// Rename a file or directory.
pub fn rename_file(path: &str, new_name: &str) -> OpResult {
    let src = PathBuf::from(path);
    let parent = src.parent().unwrap_or(Path::new(""));
    let dest = parent.join(new_name);

    if dest.exists() {
        return OpResult {
            success: false,
            message: format!("A file named '{}' already exists", new_name),
        };
    }

    match std::fs::rename(&src, &dest) {
        Ok(_) => OpResult {
            success: true,
            message: format!("Renamed to {}", new_name),
        },
        Err(e) => OpResult {
            success: false,
            message: format!("Rename failed: {}", e),
        },
    }
}

/// Create a new folder.
pub fn create_folder(parent_dir: &str, name: &str) -> OpResult {
    let path = PathBuf::from(parent_dir).join(name);
    match std::fs::create_dir(&path) {
        Ok(_) => OpResult {
            success: true,
            message: format!("Created folder: {}", name),
        },
        Err(e) => OpResult {
            success: false,
            message: format!("Failed to create folder: {}", e),
        },
    }
}

/// Log an operation for undo.
pub fn log_operation(
    conn: &rusqlite::Connection,
    operation: &str,
    payload: &serde_json::Value,
) {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let _ = conn.execute(
        "INSERT INTO undo_log (timestamp, operation, payload, reverted) VALUES (?1, ?2, ?3, 0)",
        params![now, operation, payload.to_string()],
    );
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}
