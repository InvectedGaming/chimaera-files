import {
  Folder,
  File,
  FileCode,
  FileJson,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  Package,
  Palette,
  Globe,
} from "lucide-react";
import { useCallback, useRef, useEffect, useState, useMemo } from "react";
import { type FileItem, getFolderSizes } from "../api";
import { formatSize, formatDate, getFileIcon } from "../utils/format";
import { ListItem } from "./ListItem";
import clsx from "clsx";

const iconMap: Record<
  string,
  React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>
> = {
  folder: Folder,
  file: File,
  "file-code": FileCode,
  "file-json": FileJson,
  "file-text": FileText,
  image: Image,
  film: Film,
  music: Music,
  archive: Archive,
  package: Package,
  palette: Palette,
  globe: Globe,
};

interface FileListProps {
  items: FileItem[];
  loading: boolean;
  error: string | null;
  onOpen: (item: FileItem) => void;
  onSelect: (item: FileItem) => void;
  selectedPath: string | null;
  renamingPath?: string | null;
  onRename?: (path: string, newName: string) => void;
  onCancelRename?: () => void;
  className?: string;
}

type SortKey = "name" | "size" | "modified" | "type";
type SortDir = "asc" | "desc";

export function FileList({
  items,
  loading,
  error,
  onOpen,
  onSelect,
  selectedPath,
  renamingPath,
  onRename,
  onCancelRename,
  className: listClassName,
}: FileListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [folderSizes, setFolderSizes] = useState<Record<string, number>>({});
  const [colWidths, setColWidths] = useState({ name: 250, size: 100, modified: 150, type: 100 });
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  // Fetch folder sizes
  useEffect(() => {
    const folders = items.filter((i) => i.is_directory);
    if (folders.length === 0) {
      setFolderSizes({});
      return;
    }
    let cancelled = false;
    getFolderSizes(folders.map((f) => f.path))
      .then((sizes) => {
        if (!cancelled) setFolderSizes(sizes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [items]);

  // Auto-size name column to longest name, capped at 20vw
  // Uses canvas.measureText (no layout reflow, ~10x faster than DOM)
  useEffect(() => {
    if (items.length === 0) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = "13px Segoe UI Variable Text, Segoe UI, system-ui, sans-serif";
    let maxW = 0;
    for (const item of items) {
      maxW = Math.max(maxW, ctx.measureText(item.name).width);
    }
    const fullWidth = maxW + 58;
    const maxAllowed = window.innerWidth * 0.2;
    const minAllowed = 120;
    setColWidths((prev) => ({ ...prev, name: Math.max(minAllowed, Math.min(fullWidth, maxAllowed)) }));
  }, [items]);

  const getItemSize = useCallback(
    (item: FileItem): number => {
      if (!item.is_directory) return item.size;
      return folderSizes[item.path] ?? 0;
    },
    [folderSizes],
  );

  const sorted = useMemo(() => [...items].sort((a, b) => {
    if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":
        return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "size":
        return dir * (getItemSize(a) - getItemSize(b));
      case "modified":
        return dir * ((a.modified_at ?? 0) - (b.modified_at ?? 0));
      case "type":
        return dir * (a.extension ?? "").localeCompare(b.extension ?? "");
      default:
        return 0;
    }
  }), [items, sortKey, sortDir, getItemSize]);

  useEffect(() => {
    listRef.current?.scrollTo(0, 0);
  }, [items]);

  const onResizeStart = useCallback(
    (col: keyof typeof colWidths, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { col, startX: e.clientX, startWidth: colWidths[col] };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = ev.clientX - dragRef.current.startX;
        const newWidth = Math.max(60, dragRef.current.startWidth + delta);
        setColWidths((prev) => ({ ...prev, [dragRef.current!.col]: newWidth }));
      };

      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths],
  );

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.36)" }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", padding: "0 32px", textAlign: "center" }}>
        {error}
      </div>
    );
  }

  const colStyle = (col: keyof typeof colWidths): React.CSSProperties => ({
    width: colWidths[col],
    flexShrink: 0,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  });

  const dividerStyle: React.CSSProperties = {
    width: "8px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "col-resize",
    alignSelf: "stretch",
  };

  return (
    <div className={listClassName} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden", background: "rgba(32,32,32,0.65)" }}>
      {/* Column headers */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "36px",
          padding: "0 14px",
          margin: "0 8px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          fontSize: "12px",
          color: "rgba(255,255,255,0.6)",
          flexShrink: 0,
        }}
      >
        <div style={colStyle("name")}>
          <SortButton label="Name" sortKey="name" currentSort={sortKey} sortDir={sortDir} onSort={handleSort} />
        </div>
        <ColumnDivider style={dividerStyle} onMouseDown={(e) => onResizeStart("name", e)} />
        <div style={colStyle("size")}>
          <SortButton label="Size" sortKey="size" currentSort={sortKey} sortDir={sortDir} onSort={handleSort} />
        </div>
        <ColumnDivider style={dividerStyle} onMouseDown={(e) => onResizeStart("size", e)} />
        <div style={colStyle("modified")}>
          <SortButton label="Date modified" sortKey="modified" currentSort={sortKey} sortDir={sortDir} onSort={handleSort} />
        </div>
        <ColumnDivider style={dividerStyle} onMouseDown={(e) => onResizeStart("modified", e)} />
        <div style={colStyle("type")}>
          <SortButton label="Type" sortKey="type" currentSort={sortKey} sortDir={sortDir} onSort={handleSort} />
        </div>
      </div>

      {/* File rows */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto" }}>
        {sorted.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "128px", color: "rgba(255,255,255,0.36)", fontSize: "13px" }}>
            This folder is empty
          </div>
        ) : (
          sorted.map((item, i) => (
            <FileRow
              key={item.path}
              item={item}
              selected={item.path === selectedPath}
              renaming={item.path === renamingPath}
              onSelect={() => onSelect(item)}
              onOpen={() => onOpen(item)}
              onRename={onRename}
              onCancelRename={onCancelRename}
              folderSize={folderSizes[item.path]}
              colWidths={colWidths}
              animDelay={i < 30 ? i * 12 : undefined}
            />
          ))
        )}
      </div>

      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "32px",
          padding: "0 14px",
          margin: "0 8px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(32,32,32,0.7)",
          fontSize: "12px",
          color: "rgba(255,255,255,0.6)",
          flexShrink: 0,
        }}
      >
        <span>{items.length} items</span>
        {selectedPath && (
          <span style={{ marginLeft: "16px", color: "rgba(255,255,255,0.36)" }}>
            {items.find((i) => i.path === selectedPath)?.name}
          </span>
        )}
      </div>
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  currentSort,
  sortDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  return (
    <button
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        cursor: "pointer",
        fontSize: "12px",
        background: "none",
        border: "none",
        color: "inherit",
        padding: 0,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = ""; }}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && (
        <span style={{ fontSize: "9px" }}>{sortDir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
  );
}

function FileRow({
  item,
  selected,
  renaming,
  onSelect,
  onOpen,
  onRename,
  onCancelRename,
  folderSize,
  colWidths,
  animDelay,
}: {
  item: FileItem;
  selected: boolean;
  renaming: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRename?: (path: string, newName: string) => void;
  onCancelRename?: () => void;
  folderSize?: number;
  colWidths: { name: number; size: number; modified: number; type: number };
  animDelay?: number;
}) {
  const iconName = getFileIcon(item);
  const Icon = iconMap[iconName] ?? File;

  const displaySize = item.is_directory
    ? folderSize !== undefined
      ? formatSize(folderSize)
      : ""
    : formatSize(item.size);

  return (
    <ListItem
      selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={{ margin: "0 8px" }}
      animDelay={animDelay}
      dataAttrs={{
        "data-file-path": item.path,
        "data-file-name": item.name,
        "data-is-dir": String(item.is_directory),
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.path);
        e.dataTransfer.setData("application/x-chimaera-path", item.path);
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      onDragOver={
        item.is_directory
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          : undefined
      }
      onDrop={
        item.is_directory
          ? (e) => {
              e.preventDefault();
              const sourcePath = e.dataTransfer.getData("application/x-chimaera-path");
              if (sourcePath && sourcePath !== item.path) {
                import("../api").then(({ moveFiles }) => {
                  moveFiles([sourcePath], item.path);
                });
              }
            }
          : undefined
      }
    >
      <div style={{ width: colWidths.name, flexShrink: 0, minWidth: 0, overflow: "hidden", display: "flex", alignItems: "center", gap: "12px" }}>
        <Icon
          size={18}
          strokeWidth={1.5}
          className={clsx(
            "shrink-0",
            item.is_directory ? "text-[#f2c55c]" : "text-win-text-secondary",
          )}
        />
        {renaming ? (
          <input
            autoFocus
            defaultValue={item.name}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(96,205,255,0.5)",
              borderRadius: "3px",
              padding: "1px 6px",
              color: "#fff",
              fontSize: "13px",
              outline: "none",
              width: "100%",
              minWidth: 0,
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const newName = (e.target as HTMLInputElement).value.trim();
                if (newName && newName !== item.name) {
                  onRename?.(item.path, newName);
                } else {
                  onCancelRename?.();
                }
              }
              if (e.key === "Escape") onCancelRename?.();
            }}
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (newName && newName !== item.name) {
                onRename?.(item.path, newName);
              } else {
                onCancelRename?.();
              }
            }}
          />
        ) : (
          <span className="truncate">{item.name}</span>
        )}
      </div>
      <div style={{ width: "8px", flexShrink: 0 }} />
      <div style={{ width: colWidths.size, flexShrink: 0, whiteSpace: "nowrap", color: "rgba(255,255,255,0.6)", fontSize: "12px" }}>
        {displaySize}
      </div>
      <div style={{ width: "8px", flexShrink: 0 }} />
      <div style={{ width: colWidths.modified, flexShrink: 0, whiteSpace: "nowrap", color: "rgba(255,255,255,0.6)", fontSize: "12px" }}>
        {formatDate(item.modified_at)}
      </div>
      <div style={{ width: "8px", flexShrink: 0 }} />
      <div style={{ width: colWidths.type, flexShrink: 0, whiteSpace: "nowrap", color: "rgba(255,255,255,0.36)", fontSize: "12px" }}>
        {item.is_directory
          ? "File folder"
          : item.extension
            ? `${item.extension.toUpperCase()} File`
            : ""}
      </div>
    </ListItem>
  );
}

function ColumnDivider({
  style,
  onMouseDown,
}: {
  style: React.CSSProperties;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      style={style}
      onMouseDown={onMouseDown}
    >
      <div
        style={{
          width: "1px",
          height: "60%",
          background: "rgba(255,255,255,0.07)",
          borderRadius: "1px",
        }}
        onMouseEnter={(e) => {
          if (onMouseDown) (e.currentTarget as HTMLElement).style.background = "rgba(96,205,255,0.5)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)";
        }}
      />
    </div>
  );
}
