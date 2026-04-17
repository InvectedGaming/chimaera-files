import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { TitleBar } from "./components/TitleBar";
import { PathBar } from "./components/PathBar";
import { Sidebar } from "./components/Sidebar";
import { ResizeHandle } from "./components/ResizeHandle";
import { FileList } from "./components/FileList";
import { Settings } from "./components/Settings";
import { PreviewPanel } from "./components/PreviewPanel";
import { ContextMenu } from "./components/ContextMenu";
import { TerminalPanel } from "./components/Terminal";
import { Toolbar } from "./components/Toolbar";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { useFileNavigation } from "./hooks/useFileNavigation";
import { AnimationsContext } from "./hooks/useAnimations";
import {
  searchFiles,
  getHomeDir,
  getSettings,
  deleteFiles,
  renameFile,
  undoLastOperation,
  createFolder,
  type FileItem,
} from "./api";

let tabIdCounter = 1;

interface Tab {
  id: string;
  label: string;
  path: string;
}

function App() {
  const nav = useFileNavigation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<FileItem[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [view, setView] = useState<"browser" | "settings">("browser");
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ paths: string[]; cut: boolean } | null>(null);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(250);
  const [detailsVisible, setDetailsVisible] = useState(true);
  const [detailsWidth, setDetailsWidth] = useState(280);
  const [shortcutsVisible, setShortcutsVisible] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: { path: string; name: string; is_directory: boolean } | null;
  } | null>(null); // increments on navigation to trigger enter animations
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "tab-0", label: "Home", path: "" },
  ]);
  const [activeTabId, setActiveTabId] = useState("tab-0");
  const initRef = useRef(false);

  // Sync tab label with current path
  useEffect(() => {
    if (!nav.currentPath) return;
    const segments = nav.currentPath.split("/").filter(Boolean);
    const label = segments[segments.length - 1] || nav.currentPath;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId ? { ...t, label, path: nav.currentPath } : t,
      ),
    );
  }, [nav.currentPath, activeTabId]);

  // Init first tab path
  useEffect(() => {
    if (initRef.current) return;
    if (nav.currentPath) {
      initRef.current = true;
    }
  }, [nav.currentPath]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearchQuery("");
      return;
    }
    setSearchQuery(query);
    try {
      const results = await searchFiles(query, 100);
      setSearchResults(results);
    } catch (e) {
      console.error("Search failed:", e);
      setSearchResults([]);
    }
  }, []);

  const handleSelect = useCallback((item: FileItem) => {
    setSelectedPath(item.path);
  }, []);

  const handleOpen = useCallback(
    (item: FileItem) => {
      if (searchResults && item.is_directory) {
        setSearchResults(null);
        setSearchQuery("");
      }
      nav.openItem(item);
    },
    [nav, searchResults],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      setSearchResults(null);
      setSearchQuery("");
      nav.navigateToPath(path);
    },
    [nav],
  );

  const handleNewTab = useCallback(async () => {
    const home = await getHomeDir();
    const id = `tab-${tabIdCounter++}`;
    const segments = home.split("/").filter(Boolean);
    setTabs((prev) => [
      ...prev,
      { id, label: segments[segments.length - 1] || "Home", path: home },
    ]);
    setActiveTabId(id);
    nav.navigateToPath(home);
  }, [nav]);

  const handleSelectTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab && tab.path && id !== activeTabId) {
        setActiveTabId(id);
        setSearchResults(null);
        setSearchQuery("");
        nav.navigateToPath(tab.path);
      }
    },
    [tabs, activeTabId, nav],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      if (tabs.length <= 1) return;
      const idx = tabs.findIndex((t) => t.id === id);
      const newTabs = tabs.filter((t) => t.id !== id);
      setTabs(newTabs);
      if (id === activeTabId) {
        const newActive = newTabs[Math.min(idx, newTabs.length - 1)];
        setActiveTabId(newActive.id);
        if (newActive.path) nav.navigateToPath(newActive.path);
      }
    },
    [tabs, activeTabId, nav],
  );

  useEffect(() => {
    setSelectedPath(null);
    typeAheadRef.current = "";
    setTypeAheadDisplay(null);
  }, [nav.currentPath]);

  // Keyboard mode: just hide cursor, no overlay
  const typeAheadRef = useRef("");
  const typeAheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [typeAheadDisplay, setTypeAheadDisplay] = useState<string | null>(null);

  // Throttle for arrow key repeat
  const arrowThrottleRef = useRef(0);
  const ARROW_THROTTLE_MS = 50; // ~20 items/sec max

  // Refs for values used in keyboard handler to avoid effect thrashing
  const displayItemsRef = useRef<typeof displayItems>([]);
  const selectedPathRef = useRef(selectedPath);
  const clipboardRef = useRef(clipboard);
  const previewPathRef = useRef(previewPath);
  const renamingPathRef = useRef(renamingPath);
  const shortcutsVisibleRef = useRef(shortcutsVisible);

  useEffect(() => {
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      lastKeyTime = Date.now();
      document.documentElement.style.cursor = "none";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (Math.abs(e.movementX) < 2 && Math.abs(e.movementY) < 2) return;
      if (Date.now() - lastKeyTime < 50) return;
      document.documentElement.style.cursor = "";
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      document.documentElement.style.cursor = "";
    };
  }, []);

  // Scroll a file row into view by index — uses math instead of DOM querySelector
  const scrollToIndex = useCallback((idx: number) => {
    const container = document.querySelector("[data-file-list-scroll]");
    if (!container) return;
    const rowHeight = 36; // matches ListItem minHeight
    const targetTop = idx * rowHeight;
    const containerHeight = container.clientHeight;
    const scrollTop = container.scrollTop;

    if (targetTop < scrollTop) {
      container.scrollTop = targetTop;
    } else if (targetTop + rowHeight > scrollTop + containerHeight) {
      container.scrollTop = targetTop + rowHeight - containerHeight;
    }
  }, []);

  const rawItems = searchResults ?? nav.items;
  const isSearching = searchResults !== null;
  const displayItems = useMemo(() => {
    return [...rawItems].sort((a, b) => {
      if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [rawItems]);

  // Sync refs for keyboard handler
  displayItemsRef.current = displayItems;
  selectedPathRef.current = selectedPath;
  clipboardRef.current = clipboard;
  previewPathRef.current = previewPath;
  renamingPathRef.current = renamingPath;
  shortcutsVisibleRef.current = shortcutsVisible;

  // Load animations setting
  useEffect(() => {
    getSettings().then((s) => setAnimationsEnabled(s.animations_enabled));
  }, [view]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // Read current values from refs (avoids stale closures)
      const selectedPath = selectedPathRef.current;
      const displayItems = displayItemsRef.current;
      const clipboard = clipboardRef.current;
      const previewPath = previewPathRef.current;
      const renamingPath = renamingPathRef.current;
      const shortcutsVisible = shortcutsVisibleRef.current;

      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;


      if (e.key === "Escape") {
        if (previewPath) return; // Let PreviewPanel handle its own close animation
        setRenamingPath(null);
        setContextMenu(null);
        return;
      }

      // When preview is open, handle arrow keys to cycle files
      if (previewPath) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const currentIdx = displayItems.findIndex((i) => i.path === previewPath);
          if (currentIdx === -1) return;
          const nextIdx = e.key === "ArrowDown"
            ? Math.min(currentIdx + 1, displayItems.length - 1)
            : Math.max(currentIdx - 1, 0);
          const nextItem = displayItems[nextIdx];
          if (nextItem) {
            setSelectedPath(nextItem.path);
            if (!nextItem.is_directory) {
              setPreviewPath(nextItem.path);
            }
          }
        }
        // E to edit in preview
        if (e.key === "e" && !e.ctrlKey) {
          // Let PreviewPanel handle this — we'll add it there
        }
        // All other keys handled by PreviewPanel
        return;
      }

      // Shortcuts panel (?)
      if (e.key === "?" && !inInput) {
        e.preventDefault();
        setShortcutsVisible((v) => !v);
        return;
      }

      // Don't capture anything if shortcuts panel is open
      if (shortcutsVisible) return;

      // Terminal toggle (backtick)
      if (e.key === "`" && !inInput) {
        e.preventDefault();
        setTerminalVisible((v) => !v);
        return;
      }

      if (inInput) return;

      // === Arrow key navigation (throttled for held keys) ===
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const now = Date.now();
        if (e.repeat && now - arrowThrottleRef.current < ARROW_THROTTLE_MS) return;
        arrowThrottleRef.current = now;

        if (displayItems.length === 0) return;
        const currentIdx = selectedPath
          ? displayItems.findIndex((i) => i.path === selectedPath)
          : -1;
        let nextIdx: number;
        if (currentIdx === -1) {
          nextIdx = 0;
        } else if (e.key === "ArrowDown") {
          nextIdx = Math.min(currentIdx + 1, displayItems.length - 1);
        } else {
          nextIdx = Math.max(currentIdx - 1, 0);
        }
        setSelectedPath(displayItems[nextIdx].path);
        scrollToIndex(nextIdx);
      }

      // Right arrow or Enter: open selected item
      if ((e.key === "ArrowRight" || e.key === "Enter") && selectedPath && !renamingPath) {
        e.preventDefault();
        const item = displayItems.find((i) => i.path === selectedPath);
        if (item) nav.openItem(item);
      }

      // Left arrow: go up (but not during type-ahead)
      if (e.key === "ArrowLeft" && !e.altKey && typeAheadRef.current.length === 0) {
        e.preventDefault();
        nav.goUp();
      }

      // Home: select first item
      if (e.key === "Home") {
        e.preventDefault();
        if (displayItems.length > 0) {
          setSelectedPath(displayItems[0].path);
          scrollToIndex(0);
        }
      }

      // End: select last item
      if (e.key === "End") {
        e.preventDefault();
        if (displayItems.length > 0) {
          const last = displayItems[displayItems.length - 1];
          setSelectedPath(last.path);
          scrollToIndex(displayItems.length - 1);
        }
      }

      // Page Down / Page Up: jump 10 items
      if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        const currentIdx = selectedPath
          ? displayItems.findIndex((i) => i.path === selectedPath)
          : -1;
        const jump = 10;
        let nextIdx: number;
        if (e.key === "PageDown") {
          nextIdx = Math.min((currentIdx === -1 ? 0 : currentIdx) + jump, displayItems.length - 1);
        } else {
          nextIdx = Math.max((currentIdx === -1 ? 0 : currentIdx) - jump, 0);
        }
        setSelectedPath(displayItems[nextIdx].path);
        scrollToIndex(nextIdx);
      }

      // Type-ahead: accumulate keystrokes to search filenames
      // First key jumps to that letter, continued typing refines the match
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== " " && e.key !== "`" && e.key !== "?") {
        // Clear previous timer
        if (typeAheadTimerRef.current) clearTimeout(typeAheadTimerRef.current);

        const prevBuffer = typeAheadRef.current;
        const newChar = e.key.toLowerCase();

        // If same single character repeated, cycle through matches instead of appending
        if (prevBuffer.length === 1 && prevBuffer === newChar) {
          const currentIdx = selectedPath
            ? displayItems.findIndex((i) => i.path === selectedPath)
            : -1;
          const search = [...displayItems.slice(currentIdx + 1), ...displayItems.slice(0, currentIdx + 1)];
          const match = search.find((i) => i.name.toLowerCase().startsWith(newChar));
          if (match) {
            const matchIdx = displayItems.indexOf(match);
            setSelectedPath(match.path);
            scrollToIndex(matchIdx);
          }
        } else {
          // Append to buffer
          typeAheadRef.current = prevBuffer + newChar;
          const query = typeAheadRef.current;

          // Find best match
          const match = displayItems.find((i) =>
            i.name.toLowerCase().startsWith(query)
          );
          if (match) {
            const matchIdx = displayItems.indexOf(match);
            setSelectedPath(match.path);
            scrollToIndex(matchIdx);
          }
        }

        // Show the search buffer
        setTypeAheadDisplay(typeAheadRef.current);

        // Clear buffer after 1.5s of inactivity
        typeAheadTimerRef.current = setTimeout(() => {
          typeAheadRef.current = "";
          setTypeAheadDisplay(null);
        }, 1500);

        return;
      }

      // Alt+Navigation
      if (e.key === "Backspace") {
        e.preventDefault();
        // If type-ahead is active, delete last character
        if (typeAheadRef.current.length > 0) {
          if (typeAheadTimerRef.current) clearTimeout(typeAheadTimerRef.current);
          typeAheadRef.current = typeAheadRef.current.slice(0, -1);
          if (typeAheadRef.current.length === 0) {
            setTypeAheadDisplay(null);
          } else {
            setTypeAheadDisplay(typeAheadRef.current);
            // Re-match with shortened query
            const match = displayItems.find((i) =>
              i.name.toLowerCase().startsWith(typeAheadRef.current)
            );
            if (match) {
              const matchIdx = displayItems.indexOf(match);
              setSelectedPath(match.path);
              scrollToIndex(matchIdx);
            }
          }
          typeAheadTimerRef.current = setTimeout(() => {
            typeAheadRef.current = "";
            setTypeAheadDisplay(null);
          }, 1500);
        } else {
          nav.goUp();
        }
      }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); nav.goBack(); }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); nav.goForward(); }

      // Tabs
      if (e.ctrlKey && e.key === "t") { e.preventDefault(); handleNewTab(); }
      if (e.ctrlKey && e.key === "w") { e.preventDefault(); handleCloseTab(activeTabId); }

      // Ctrl+Shift+Space: "Open with..." dialog
      if (e.ctrlKey && e.shiftKey && e.key === " " && selectedPath) {
        e.preventDefault();
        import("./api").then(({ openFileWith }) => openFileWith(selectedPath));
        return;
      }

      // Ctrl+Space: open with default app
      if (e.ctrlKey && e.key === " " && selectedPath) {
        e.preventDefault();
        import("./api").then(({ openFile }) => openFile(selectedPath));
        return;
      }

      // Space: preview
      if (e.key === " " && selectedPath) {
        e.preventDefault();
        const item = displayItems.find((i) => i.path === selectedPath);
        if (item && !item.is_directory) {
          setPreviewPath(selectedPath);
        }
      }

      // Delete
      if (e.key === "Delete" && selectedPath) {
        e.preventDefault();
        const result = await deleteFiles([selectedPath]);
        if (result.success) nav.refreshCurrentDir();
      }

      // Rename (F2)
      if (e.key === "F2" && selectedPath) {
        e.preventDefault();
        setRenamingPath(selectedPath);
      }

      // Copy (Ctrl+C)
      if (e.ctrlKey && e.key === "c" && selectedPath) {
        e.preventDefault();
        setClipboard({ paths: [selectedPath], cut: false });
      }

      // Cut (Ctrl+X)
      if (e.ctrlKey && e.key === "x" && selectedPath) {
        e.preventDefault();
        setClipboard({ paths: [selectedPath], cut: true });
      }

      // Paste (Ctrl+V)
      if (e.ctrlKey && e.key === "v" && clipboard) {
        e.preventDefault();
        const { copyFiles, moveFiles } = await import("./api");
        if (clipboard.cut) {
          await moveFiles(clipboard.paths, nav.currentPath);
          setClipboard(null);
        } else {
          await copyFiles(clipboard.paths, nav.currentPath);
        }
        nav.refreshCurrentDir();
      }

      // Undo (Ctrl+Z)
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        await undoLastOperation();
        nav.refreshCurrentDir();
      }

      // New folder (Ctrl+Shift+N)
      if (e.ctrlKey && e.shiftKey && e.key === "N") {
        e.preventDefault();
        await createFolder(nav.currentPath, "New Folder");
        nav.refreshCurrentDir();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [nav, handleNewTab, handleCloseTab, activeTabId]);

  return (
    <AnimationsContext.Provider value={animationsEnabled}>
    <div className={`flex flex-col h-screen rounded-lg overflow-hidden border border-white/[0.08] ${!animationsEnabled ? "no-animations" : ""}`}>
      <TitleBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
      />
      <PathBar
        currentPath={
          isSearching ? `Search: "${searchQuery}"` : nav.currentPath
        }
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        canGoUp={nav.canGoUp}
        onGoBack={() => {
          if (view === "settings") setView("browser");
          else nav.goBack();
        }}
        onGoForward={nav.goForward}
        onGoUp={nav.goUp}
        onNavigate={(path) => {
          setView("browser");
          handleNavigate(path);
        }}
        onSearch={handleSearch}
        onOpenSettings={() => setView(view === "settings" ? "browser" : "settings")}
      />
      {view === "settings" ? (
        <div className="anim-settings-enter flex flex-1 min-h-0">
          <Settings onBack={() => setView("browser")} />
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0" style={{ position: "relative" }}>
          <Toolbar
            hasSelection={!!selectedPath}
            hasClipboard={!!clipboard}
            detailsVisible={detailsVisible}
            onToggleDetails={() => setDetailsVisible((v) => !v)}
            onShowShortcuts={() => setShortcutsVisible(true)}
            onCopy={() => {
              if (selectedPath) setClipboard({ paths: [selectedPath], cut: false });
            }}
            onCut={() => {
              if (selectedPath) setClipboard({ paths: [selectedPath], cut: true });
            }}
            onPaste={async () => {
              if (!clipboard) return;
              const { copyFiles, moveFiles } = await import("./api");
              if (clipboard.cut) {
                await moveFiles(clipboard.paths, nav.currentPath);
                setClipboard(null);
              } else {
                await copyFiles(clipboard.paths, nav.currentPath);
              }
              nav.refreshCurrentDir();
            }}
            onDelete={async () => {
              if (selectedPath) {
                await deleteFiles([selectedPath]);
                nav.refreshCurrentDir();
              }
            }}
            onRename={() => {
              if (selectedPath) setRenamingPath(selectedPath);
            }}
            onNewFolder={async () => {
              await createFolder(nav.currentPath, "New Folder");
              nav.refreshCurrentDir();
            }}
            onUndo={async () => {
              await undoLastOperation();
              nav.refreshCurrentDir();
            }}
          />
          {/* File browser area */}
          <div
            className="flex flex-1 min-h-0"
            onContextMenu={(e) => {
              e.preventDefault();
              const target = e.target as HTMLElement;
              const row = target.closest("[data-file-path]");
              if (row) {
                const path = row.getAttribute("data-file-path") ?? "";
                const name = row.getAttribute("data-file-name") ?? "";
                const isDir = row.getAttribute("data-is-dir") === "true";
                setContextMenu({ x: e.clientX, y: e.clientY, item: { path, name, is_directory: isDir } });
              } else {
                setContextMenu({ x: e.clientX, y: e.clientY, item: null });
              }
            }}
          >
            <Sidebar currentPath={nav.currentPath} onNavigate={handleNavigate} width={sidebarWidth} />
            <ResizeHandle
              onResize={(delta) =>
                setSidebarWidth((w) => Math.max(160, Math.min(500, w + delta)))
              }
            />
            <FileList
              className={nav.navDirection === "forward" ? "nav-forward" : nav.navDirection === "back" ? "nav-back" : ""}
              items={displayItems}
              loading={nav.loading && !isSearching}
              error={nav.error}
              onOpen={handleOpen}
              onSelect={handleSelect}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              onRename={async (path, newName) => {
                const result = await renameFile(path, newName);
                setRenamingPath(null);
                if (result.success) nav.refreshCurrentDir();
              }}
              onCancelRename={() => setRenamingPath(null)}
            />
            {/* Details panel */}
            {detailsVisible && (
              <>
                <ResizeHandle
                  onResize={(delta) =>
                    setDetailsWidth((w) => Math.max(200, Math.min(500, w - delta)))
                  }
                />
                <DetailsPanel
                  item={selectedPath ? displayItems.find((i) => i.path === selectedPath) ?? null : null}
                  width={detailsWidth}
                />
              </>
            )}

          </div>

          {/* Terminal pane */}
          {terminalVisible && (
            <>
              <ResizeHandle
                direction="vertical"
                onResize={(delta) =>
                  setTerminalHeight((h) => Math.max(100, Math.min(600, h - delta)))
                }
              />
              <div style={{ height: terminalHeight, flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <TerminalPanel cwd={nav.currentPath} visible={terminalVisible} />
              </div>
            </>
          )}

          {/* Quick-look preview — covers toolbar + file browser, fades into breadcrumbs */}
          {previewPath && (
            <PreviewPanel path={previewPath} onClose={() => setPreviewPath(null)} />
          )}
        </div>
      )}

      {/* Shortcuts panel */}
      {shortcutsVisible && (
        <ShortcutsPanel visible={shortcutsVisible} onClose={() => setShortcutsVisible(false)} />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          hasClipboard={!!clipboard}
          onClose={() => setContextMenu(null)}
          onCopy={() => {
            if (contextMenu.item) setClipboard({ paths: [contextMenu.item.path], cut: false });
          }}
          onCut={() => {
            if (contextMenu.item) setClipboard({ paths: [contextMenu.item.path], cut: true });
          }}
          onPaste={async () => {
            if (!clipboard) return;
            const { copyFiles, moveFiles } = await import("./api");
            if (clipboard.cut) {
              await moveFiles(clipboard.paths, nav.currentPath);
              setClipboard(null);
            } else {
              await copyFiles(clipboard.paths, nav.currentPath);
            }
            nav.refreshCurrentDir();
          }}
          onDelete={async () => {
            if (contextMenu.item) {
              await deleteFiles([contextMenu.item.path]);
              nav.refreshCurrentDir();
            }
          }}
          onRename={() => {
            if (contextMenu.item) setRenamingPath(contextMenu.item.path);
          }}
          onNewFolder={async () => {
            await createFolder(nav.currentPath, "New Folder");
            nav.refreshCurrentDir();
          }}
          onOpenWith={() => {
            if (contextMenu.item) nav.openItem(contextMenu.item as FileItem);
          }}
          onOpenWithDialog={async () => {
            if (contextMenu.item) {
              const { openFileWith } = await import("./api");
              openFileWith(contextMenu.item.path);
            }
          }}
          onPreview={() => {
            if (contextMenu.item && !contextMenu.item.is_directory) {
              setPreviewPath(contextMenu.item.path);
            }
          }}
          onExtractArchive={
            contextMenu.item && !contextMenu.item.is_directory &&
            /\.(zip|jar|war|ear|epub)$/i.test(contextMenu.item.name)
              ? async () => {
                  const { extractArchive } = await import("./api");
                  const dest = nav.currentPath;
                  await extractArchive(contextMenu.item!.path, dest);
                  nav.refreshCurrentDir();
                }
              : undefined
          }
        />
      )}

      {/* Type-ahead search indicator */}
      {typeAheadDisplay && (
        <div
          style={{
            position: "fixed",
            bottom: "48px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(36,36,36,0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "8px 16px",
            fontSize: "14px",
            color: "#fff",
            fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backdropFilter: "blur(12px)",
            animation: "previewModalIn 0.12s ease-out",
          }}
        >
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Jump to:</span>
          <span style={{ fontWeight: 500 }}>{typeAheadDisplay}</span>
          <span style={{
            width: "2px",
            height: "16px",
            background: "#60cdff",
            animation: "blink 1s step-end infinite",
          }} />
        </div>
      )}

      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>

    </div>
    </AnimationsContext.Provider>
  );
}

export default App;
