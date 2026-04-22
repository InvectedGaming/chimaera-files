import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { searchFiles, type FileItem, type MatchMode } from "../api";
import { nameMatches, nextMode, modeLabel } from "../utils/match";
import { Search, FolderOpen, File as FileIcon } from "lucide-react";

/**
 * Spotlight-style popup. Opened by Ctrl+Shift+K global shortcut (wired in
 * Rust). Type → debounced FTS search against the whole index. Enter on a
 * folder navigates the main window there; Enter on a file opens with the
 * OS default handler.
 *
 * Keyboard-first:
 *   ↑/↓    — move selection
 *   Enter  — open
 *   Tab    — cycle match mode (smart / fuzzy / regex)
 *   Esc    — hide the launcher
 */
export function Launcher() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode] = useState<MatchMode>(() => {
    const saved = localStorage.getItem("chimaera-match-mode");
    return saved === "substring" || saved === "fuzzy" || saved === "regex"
      ? saved
      : "substring";
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  // Focus the input when the window becomes visible. The window is created
  // once; showing re-focuses but React doesn't re-mount.
  useEffect(() => {
    const win = getCurrentWindow();
    const focusInput = () => inputRef.current?.focus();
    focusInput();
    const unlistenP = win.onFocusChanged(({ payload: focused }) => {
      if (focused) focusInput();
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  // Hide on blur — click-away dismiss.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) invoke("hide_launcher");
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  // Debounced search. 75ms keeps it snappy but not spam-calling FTS.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSelectedIdx(0);
      return;
    }
    const reqId = ++reqIdRef.current;
    const handle = setTimeout(async () => {
      try {
        const raw = await searchFiles(q, 50);
        if (reqId !== reqIdRef.current) return;
        // Apply mode filter client-side for regex/fuzzy; FTS gives broad
        // word-prefix matches which we then tighten via `nameMatches`.
        const filtered = mode === "regex"
          ? raw.filter((f) => nameMatches(f.name, q, mode))
          : raw;
        setResults(filtered);
        setSelectedIdx(0);
      } catch {
        // Silent — a bad regex or empty index shouldn't blank the UI.
      }
    }, 75);
    return () => clearTimeout(handle);
  }, [query, mode]);

  const openItem = useCallback(async (item: FileItem) => {
    if (item.is_directory) {
      await invoke("launcher_navigate", { path: item.path });
    } else {
      await invoke("open_file", { path: item.path });
      await invoke("hide_launcher");
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        invoke("hide_launcher");
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const next = nextMode(mode);
        setMode(next);
        localStorage.setItem("chimaera-match-mode", next);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = results[selectedIdx];
        if (item) openItem(item);
        return;
      }
    },
    [mode, results, selectedIdx, openItem],
  );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "rgba(28,28,30,0.94)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif",
        color: "#fff",
      }}
    >
      {/* Input row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 16px",
          borderBottom: results.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
        }}
      >
        <Search size={18} strokeWidth={1.6} style={{ color: "rgba(255,255,255,0.5)", flexShrink: 0 }} />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search files and folders..."
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#fff",
            fontSize: "16px",
          }}
        />
        <span
          title="Tab to cycle mode"
          style={{
            fontSize: "10px",
            fontWeight: 600,
            color: mode === "regex" ? "#f0a4ff" : "#60cdff",
            background:
              mode === "regex" ? "rgba(240,164,255,0.12)" : "rgba(96,205,255,0.12)",
            border:
              mode === "regex"
                ? "1px solid rgba(240,164,255,0.25)"
                : "1px solid rgba(96,205,255,0.25)",
            borderRadius: "9px",
            padding: "2px 8px",
            letterSpacing: "0.4px",
            textTransform: "uppercase",
          }}
        >
          {modeLabel(mode)}
        </span>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {results.map((item, i) => {
          const selected = i === selectedIdx;
          const Icon = item.is_directory ? FolderOpen : FileIcon;
          return (
            <div
              key={item.path}
              onMouseEnter={() => setSelectedIdx(i)}
              onClick={() => openItem(item)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "8px 16px",
                cursor: "pointer",
                background: selected ? "rgba(96,205,255,0.14)" : "transparent",
                borderLeft: selected
                  ? "3px solid #60cdff"
                  : "3px solid transparent",
              }}
            >
              <Icon
                size={16}
                strokeWidth={1.6}
                style={{
                  color: item.is_directory ? "#f2c55c" : "rgba(255,255,255,0.65)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.name}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "rgba(255,255,255,0.35)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.path}
                </div>
              </div>
            </div>
          );
        })}
        {query && results.length === 0 && (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              fontSize: "13px",
              color: "rgba(255,255,255,0.35)",
            }}
          >
            No matches
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "6px 16px",
          fontSize: "10px",
          color: "rgba(255,255,255,0.35)",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          gap: "16px",
          justifyContent: "center",
        }}
      >
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>⇥ mode</span>
        <span>Esc dismiss</span>
      </div>
    </div>
  );
}
