use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchMode {
    /// Case-insensitive substring: `foo` matches `myfoo.txt`.
    Substring,
    /// Loose ordered character match: `frm` matches `from.md` or `firearm`.
    Fuzzy,
    /// Client-side: regex is never run at SQL level here.
    Regex,
}

impl Default for MatchMode {
    fn default() -> Self {
        MatchMode::Substring
    }
}

/// Escape LIKE metacharacters so user input is treated as literal text.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// Build a LIKE pattern for the mode. Returns `None` for modes we don't
/// push down to SQL (Regex).
fn build_like_pattern(query: &str, mode: MatchMode) -> Option<String> {
    match mode {
        MatchMode::Substring => Some(format!("%{}%", escape_like(query))),
        MatchMode::Fuzzy => {
            let escaped = escape_like(query);
            let mut pattern = String::with_capacity(escaped.len() * 2 + 1);
            pattern.push('%');
            for c in escaped.chars() {
                pattern.push(c);
                pattern.push('%');
            }
            Some(pattern)
        }
        MatchMode::Regex => None,
    }
}

/// Count matches per direct-child folder of `parent_path`. Used to render
/// "+N" badges on folders during type-ahead.
///
/// For each row whose path starts with `parent_path/` and whose name matches
/// the query, bucket it by the first path segment after the prefix.
///
/// Caps the scan at 5000 rows — a folder with more deep matches will show
/// "5k+" rather than spending disk time on exact counts.
pub fn count_subtree_matches(
    conn: &Connection,
    query: &str,
    parent_path: &str,
    mode: MatchMode,
) -> rusqlite::Result<HashMap<String, u64>> {
    if query.is_empty() {
        return Ok(HashMap::new());
    }
    // Regex mode doesn't push to SQL; the UI skips badges for it.
    let Some(pattern) = build_like_pattern(query, mode) else {
        return Ok(HashMap::new());
    };

    let parent_normalized = parent_path.trim_end_matches('/').replace('\\', "/");
    let path_prefix = format!("{}/", parent_normalized);
    let path_prefix_like = format!("{}%", escape_like(&parent_normalized) + "/");

    let mut stmt = conn.prepare_cached(
        "SELECT path FROM files
         WHERE path LIKE ?1 ESCAPE '\\'
           AND name LIKE ?2 ESCAPE '\\'
         LIMIT 5000",
    )?;

    let rows = stmt.query_map(rusqlite::params![path_prefix_like, pattern], |row| {
        row.get::<_, String>(0)
    })?;

    let mut counts: HashMap<String, u64> = HashMap::new();
    for path_result in rows {
        let path = path_result?.replace('\\', "/");
        if let Some(rest) = path.strip_prefix(&path_prefix) {
            if let Some(child) = rest.split('/').next() {
                if !child.is_empty() {
                    *counts.entry(child.to_string()).or_insert(0) += 1;
                }
            }
        }
    }

    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substring_pattern() {
        assert_eq!(build_like_pattern("foo", MatchMode::Substring).unwrap(), "%foo%");
    }

    #[test]
    fn fuzzy_pattern() {
        assert_eq!(build_like_pattern("foo", MatchMode::Fuzzy).unwrap(), "%f%o%o%");
    }

    #[test]
    fn escapes_like_metachars() {
        assert_eq!(build_like_pattern("50%", MatchMode::Substring).unwrap(), "%50\\%%");
    }

    #[test]
    fn regex_returns_none() {
        assert!(build_like_pattern("foo", MatchMode::Regex).is_none());
    }
}
