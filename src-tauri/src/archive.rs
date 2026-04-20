use crate::commands::FileItem;
use std::io::Read;
use std::path::{Path, PathBuf};

const ARCHIVE_EXTS: &[&str] = &["zip", "jar", "war", "ear", "xpi", "crx", "epub", "docx", "xlsx", "pptx"];

/// Check if a path is a browsable archive.
pub fn is_archive(path: &str) -> bool {
    let lower = path.to_lowercase();
    ARCHIVE_EXTS.iter().any(|ext| lower.ends_with(ext))
}

/// Parse an archive path like "C:/path/to/file.zip" or "C:/path/to/file.zip/inner/folder"
/// Returns (archive_path, inner_path) where inner_path is "" for root.
pub fn parse_archive_path(path: &str) -> Option<(String, String)> {
    let normalized = path.replace('\\', "/");
    for ext in ARCHIVE_EXTS {
        let pattern = format!(".{}", ext);
        if let Some(pos) = normalized.to_lowercase().find(&pattern) {
            let archive_end = pos + pattern.len();
            let archive_path = &normalized[..archive_end];
            let inner = if archive_end < normalized.len() {
                normalized[archive_end..].trim_start_matches('/').to_string()
            } else {
                String::new()
            };
            if Path::new(archive_path).exists() {
                return Some((archive_path.to_string(), inner));
            }
        }
    }
    None
}

/// List the contents of an archive at a given inner path.
pub fn list_archive(archive_path: &str, inner_path: &str) -> Result<Vec<FileItem>, String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let prefix = if inner_path.is_empty() {
        String::new()
    } else {
        format!("{}/", inner_path.trim_end_matches('/'))
    };

    let mut seen_dirs = std::collections::HashSet::new();
    let mut items = Vec::new();

    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");

        // Skip entries not under our prefix
        if !prefix.is_empty() && !name.starts_with(&prefix) {
            continue;
        }

        // Get the relative path after the prefix
        let relative = if prefix.is_empty() {
            &name
        } else {
            &name[prefix.len()..]
        };

        if relative.is_empty() {
            continue;
        }

        // Only show direct children (no deeper nesting)
        let parts: Vec<&str> = relative.trim_end_matches('/').split('/').collect();
        if parts.is_empty() {
            continue;
        }

        let child_name = parts[0];
        let is_dir = parts.len() > 1 || name.ends_with('/');

        if is_dir {
            if seen_dirs.contains(child_name) {
                continue;
            }
            seen_dirs.insert(child_name.to_string());
        } else if parts.len() > 1 {
            // This is a file in a subdirectory — show the directory instead
            if seen_dirs.contains(child_name) {
                continue;
            }
            seen_dirs.insert(child_name.to_string());
            items.push(FileItem {
                name: child_name.to_string(),
                path: format!("{}/{}{}", archive_path, prefix, child_name),
                is_directory: true,
                size: 0,
                extension: None,
                modified_at: None,
            });
            continue;
        }

        let ext = if is_dir {
            None
        } else {
            Path::new(child_name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
        };

        items.push(FileItem {
            name: child_name.to_string(),
            path: format!("{}/{}{}", archive_path, prefix, child_name),
            is_directory: is_dir,
            size: if is_dir { 0 } else { entry.size() },
            extension: ext,
            modified_at: entry.last_modified().and_then(|dt| {
                let year = dt.year() as i64;
                let month = dt.month() as i64;
                let day = dt.day() as i64;
                let hour = dt.hour() as i64;
                let minute = dt.minute() as i64;
                let second = dt.second() as i64;
                if month < 1 || month > 12 { return None; }
                let days = (year - 1970) * 365 + (year - 1969) / 4 - (year - 1901) / 100 + (year - 1601) / 400
                    + [0i64, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][(month - 1) as usize]
                    + day - 1;
                Some((days * 86400 + hour * 3600 + minute * 60 + second) * 1000)
            }),
        });
    }

    items.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

/// Extract a single file from an archive. Returns the bytes.
pub fn extract_file(archive_path: &str, inner_path: &str) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut entry = archive.by_name(inner_path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Extract entire archive to a destination directory.
pub fn extract_all(archive_path: &str, dest_dir: &str) -> Result<String, String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let dest = PathBuf::from(dest_dir);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut count = 0;
    let mut skipped = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;

        // Reject entries whose path escapes the destination (zip slip).
        // `enclosed_name` returns None for absolute paths or ones containing `..`.
        let Some(rel) = entry.enclosed_name() else {
            skipped += 1;
            continue;
        };
        let out_path = dest.join(rel);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    if skipped > 0 {
        Ok(format!("Extracted {} files to {} ({} unsafe entries skipped)", count, dest_dir, skipped))
    } else {
        Ok(format!("Extracted {} files to {}", count, dest_dir))
    }
}
