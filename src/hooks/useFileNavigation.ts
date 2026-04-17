import { useState, useCallback, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  listDirectory,
  openFile,
  getHomeDir,
  watchDirectory,
  unwatchDirectory,
  isArchivePath,
  type FileItem,
} from "../api";

export type NavDirection = "forward" | "back" | "none";

export interface NavigationState {
  currentPath: string;
  items: FileItem[];
  loading: boolean;
  error: string | null;
  history: string[];
  historyIndex: number;
}

export function useFileNavigation() {
  const [state, setState] = useState<NavigationState>({
    currentPath: "",
    items: [],
    loading: true,
    error: null,
    history: [],
    historyIndex: -1,
  });
  const [navDirection, setNavDirection] = useState<NavDirection>("none");

  const isNavigating = useRef(false);
  const currentPathRef = useRef("");

  const refreshCurrentDir = useCallback(async () => {
    const path = currentPathRef.current;
    if (!path) return;
    try {
      const items = await listDirectory(path);
      setState((prev) => {
        if (prev.currentPath !== path) return prev;
        return { ...prev, items };
      });
    } catch {
      // Silently fail on refresh — directory may have been deleted
    }
  }, []);

  const navigateToPath = useCallback(
    async (path: string, addToHistory = true) => {
      if (isNavigating.current) return;
      isNavigating.current = true;

      // Determine direction for animation
      const oldPath = currentPathRef.current;
      if (oldPath && path !== oldPath) {
        const oldDepth = oldPath.split("/").filter(Boolean).length;
        const newDepth = path.split("/").filter(Boolean).length;
        setNavDirection(newDepth > oldDepth ? "forward" : newDepth < oldDepth ? "back" : "forward");
      }

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const items = await listDirectory(path);
        currentPathRef.current = path;

        // Start watching the new directory
        watchDirectory(path).catch(() => {});

        setState((prev) => {
          const newHistory = addToHistory
            ? [...prev.history.slice(0, prev.historyIndex + 1), path]
            : prev.history;
          const newIndex = addToHistory
            ? newHistory.length - 1
            : prev.historyIndex;
          return {
            currentPath: path,
            items,
            loading: false,
            error: null,
            history: newHistory,
            historyIndex: newIndex,
          };
        });
      } catch (e) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: String(e),
        }));
      } finally {
        isNavigating.current = false;
      }
    },
    [],
  );

  // Listen for filesystem change events (per-directory watcher + journal watcher)
  useEffect(() => {
    const unlistenFs = listen<{ path: string }>("fs-changed", () => {
      refreshCurrentDir();
    });

    const unlistenIndex = listen<{ volume: string; changes: number }>(
      "index-updated",
      () => {
        refreshCurrentDir();
      },
    );

    return () => {
      unlistenFs.then((fn) => fn());
      unlistenIndex.then((fn) => fn());
      unwatchDirectory().catch(() => {});
    };
  }, [refreshCurrentDir]);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.historyIndex <= 0) return prev;
      const newIndex = prev.historyIndex - 1;
      const path = prev.history[newIndex];
      navigateToPath(path, false);
      return { ...prev, historyIndex: newIndex };
    });
  }, [navigateToPath]);

  const goForward = useCallback(() => {
    setState((prev) => {
      if (prev.historyIndex >= prev.history.length - 1) return prev;
      const newIndex = prev.historyIndex + 1;
      const path = prev.history[newIndex];
      navigateToPath(path, false);
      return { ...prev, historyIndex: newIndex };
    });
  }, [navigateToPath]);

  const goUp = useCallback(() => {
    if (state.currentPath === "drives://") return; // Already at top
    const parts = state.currentPath.split("/").filter(Boolean);
    if (parts.length <= 1) {
      // At drive root — go to drives overview
      navigateToPath("drives://");
      return;
    }
    const parent = parts.slice(0, -1).join("/");
    const parentPath = parent.length <= 2 ? parent + "/" : parent;
    navigateToPath(parentPath);
  }, [state.currentPath, navigateToPath]);

  const openItem = useCallback(
    async (item: FileItem) => {
      if (item.is_directory) {
        navigateToPath(item.path);
      } else {
        // Check if it's an archive — navigate into it like a folder
        try {
          const isArchive = await isArchivePath(item.path);
          if (isArchive) {
            navigateToPath(item.path);
            return;
          }
        } catch {}

        try {
          await openFile(item.path);
        } catch (e) {
          console.error("Failed to open file:", e);
        }
      }
    },
    [navigateToPath],
  );

  // Initial navigation
  useEffect(() => {
    getHomeDir().then((home) => {
      navigateToPath(home);
    });
  }, [navigateToPath]);

  return {
    ...state,
    navigateToPath,
    goBack,
    goForward,
    goUp,
    openItem,
    refreshCurrentDir,
    navDirection,
    canGoBack: state.historyIndex > 0,
    canGoForward: state.historyIndex < state.history.length - 1,
    canGoUp: state.currentPath !== "drives://",
  };
}
