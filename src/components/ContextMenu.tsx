import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  Pencil,
  FolderPlus,
  ExternalLink,
  AppWindow,
  Eye,
  Archive,
} from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  item: { path: string; name: string; is_directory: boolean } | null;
  hasClipboard: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onRename: () => void;
  onNewFolder: () => void;
  onOpenWith: () => void;
  onOpenWithDialog: () => void;
  onPreview: () => void;
  onExtractArchive?: () => void;
}

export function ContextMenu({
  x,
  y,
  item,
  hasClipboard,
  onClose,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onRename,
  onNewFolder,
  onOpenWith,
  onOpenWithDialog,
  onPreview,
  onExtractArchive,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"entering" | "visible" | "exiting">("entering");
  const [adjustedPos, setAdjustedPos] = useState({ x, y });
  const closingRef = useRef(false);

  const animateClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setPhase("exiting");
    setTimeout(() => onClose(), 100);
  };

  // Animate in on mount, adjust position to fit viewport
  useEffect(() => {
    requestAnimationFrame(() => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        setAdjustedPos({
          x: x + rect.width > vw ? vw - rect.width - 8 : x,
          y: y + rect.height > vh ? vh - rect.height - 8 : y,
        });
      }
      setPhase("visible");
    });
  }, [x, y]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        animateClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") animateClose();
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 200,
        minWidth: "220px",
        background: "rgba(44, 44, 44, 0.92)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "8px",
        padding: "4px",
        boxShadow: "0 12px 48px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
        opacity: phase === "visible" ? 1 : 0,
        transform: phase === "visible"
          ? "scale(1) translateY(0)"
          : phase === "exiting"
            ? "scale(0.97) translateY(2px)"
            : "scale(0.96) translateY(-4px)",
        transformOrigin: "top left",
        transition: phase === "exiting"
          ? "opacity 0.1s ease-in, transform 0.1s ease-in"
          : "opacity 0.12s ease-out, transform 0.12s ease-out",
        pointerEvents: phase === "exiting" ? "none" as const : "auto" as const,
      }}
    >
      {item && (
        <>
          {!item.is_directory && (
            <MenuItem icon={Eye} label="Preview" shortcut="Space" onClick={() => { onPreview(); animateClose(); }} delay={0} />
          )}
          <MenuItem icon={ExternalLink} label="Open" onClick={() => { onOpenWith(); animateClose(); }} delay={1} />
          <MenuItem icon={AppWindow} label="Open with..." shortcut="Ctrl+Shift+Space" onClick={() => { onOpenWithDialog(); animateClose(); }} delay={1} />
          {onExtractArchive && (
            <MenuItem icon={Archive} label="Extract All..." onClick={() => { onExtractArchive(); animateClose(); }} delay={1} />
          )}
          <Separator />
          <MenuItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => { onCopy(); animateClose(); }} delay={2} />
          <MenuItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => { onCut(); animateClose(); }} delay={3} />
          {hasClipboard && (
            <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" onClick={() => { onPaste(); animateClose(); }} delay={4} />
          )}
          <Separator />
          <MenuItem icon={Pencil} label="Rename" shortcut="F2" onClick={() => { onRename(); animateClose(); }} delay={5} />
          <MenuItem icon={Trash2} label="Delete" shortcut="Del" danger onClick={() => { onDelete(); animateClose(); }} delay={6} />
        </>
      )}
      {!item && (
        <>
          {hasClipboard && (
            <>
              <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" onClick={() => { onPaste(); animateClose(); }} delay={0} />
              <Separator />
            </>
          )}
          <MenuItem icon={FolderPlus} label="New folder" shortcut="Ctrl+Shift+N" onClick={() => { onNewFolder(); animateClose(); }} delay={1} />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  danger,
  onClick,
  delay = 0,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
  delay?: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        padding: "7px 12px",
        border: "none",
        background: hovered ? "rgba(255,255,255,0.08)" : "transparent",
        color: danger ? (hovered ? "#ff6b6b" : "#f87171") : "#fff",
        fontSize: "13px",
        cursor: "pointer",
        borderRadius: "4px",
        textAlign: "left",
        opacity: 0,
        transform: "translateX(-6px)",
        animation: `menuItemIn 0.15s ease-out ${delay * 0.03}s forwards`,
      }}
    >
      <Icon
        size={15}
        strokeWidth={1.5}
        style={{
          flexShrink: 0,
          opacity: hovered ? 0.9 : 0.5,
        }}
      />
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && (
        <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "11px" }}>{shortcut}</span>
      )}

      <style>{`
        @keyframes menuItemIn {
          from {
            opacity: 0;
            transform: translateX(-6px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </button>
  );
}

function Separator() {
  return (
    <div style={{
      height: "1px",
      background: "rgba(255,255,255,0.06)",
      margin: "4px 8px",
    }} />
  );
}
