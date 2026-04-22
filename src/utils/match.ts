import type { MatchMode } from "../api";

/**
 * Client-side filename matcher used for in-folder type-ahead. The SQL path
 * in `crates/indexer/src/search.rs` mirrors these semantics for the subtree
 * badge query.
 *
 *   substring  — case-insensitive `.includes()`
 *   fuzzy      — ordered character match (`frm` matches `from.md`)
 *   regex      — case-insensitive regex, returns false on invalid patterns
 */
export function nameMatches(
  name: string,
  query: string,
  mode: MatchMode,
): boolean {
  if (!query) return true;
  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();

  switch (mode) {
    case "substring":
      return haystack.includes(needle);
    case "fuzzy":
      return fuzzyMatch(haystack, needle);
    case "regex":
      return regexMatch(name, query);
  }
}

function fuzzyMatch(haystack: string, needle: string): boolean {
  let hi = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const c = needle[ni];
    const found = haystack.indexOf(c, hi);
    if (found === -1) return false;
    hi = found + 1;
  }
  return true;
}

function regexMatch(name: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(name);
  } catch {
    return false;
  }
}

export const MATCH_MODES: MatchMode[] = ["substring", "fuzzy", "regex"];

export function nextMode(current: MatchMode): MatchMode {
  const idx = MATCH_MODES.indexOf(current);
  return MATCH_MODES[(idx + 1) % MATCH_MODES.length];
}

export function modeLabel(mode: MatchMode): string {
  switch (mode) {
    case "substring":
      return "smart";
    case "fuzzy":
      return "fuzzy";
    case "regex":
      return "regex";
  }
}
