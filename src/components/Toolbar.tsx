import { useState } from "react";
import {
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  Pencil,
  FolderPlus,
  LayoutList,
  PanelRight,
  RotateCcw,
  Keyboard,
} from "lucide-react";

interface ToolbarProps {
  hasSelection: boolean;
  hasClipboard: boolean;
  detailsVisible: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onRename: () => void;
  onNewFolder: () => void;
  onUndo: () => void;
  onToggleDetails: () => void;
  onShowShortcuts: () => void;
}

export function Toolbar({
  hasSelection,
  hasClipboard,
  detailsVisible,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onRename,
  onNewFolder,
  onUndo,
  onToggleDetails,
  onShowShortcuts,
}: ToolbarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "40px",
        padding: "0 16px",
        gap: "2px",
        background: "rgba(24, 24, 24, 0.92)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0,
      }}
    >
      {/* New */}
      <ToolbarButton icon={FolderPlus} label="New" onClick={onNewFolder} />

      <Separator />

      {/* Clipboard group */}
      <ToolbarButton icon={Copy} label="Copy" onClick={onCopy} disabled={!hasSelection} />
      <ToolbarButton icon={Scissors} label="Cut" onClick={onCut} disabled={!hasSelection} />
      <ToolbarButton icon={Clipboard} label="Paste" onClick={onPaste} disabled={!hasClipboard} />

      <Separator />

      {/* Actions */}
      <ToolbarButton icon={Pencil} label="Rename" onClick={onRename} disabled={!hasSelection} />
      <ToolbarButton icon={Trash2} label="Delete" onClick={onDelete} disabled={!hasSelection} />

      <Separator />

      <ToolbarButton icon={RotateCcw} label="Undo" onClick={onUndo} />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* View options */}
      <ToolbarButton icon={Keyboard} label="?" onClick={onShowShortcuts} />
      <Separator />
      <ToolbarButton icon={LayoutList} label="Details" active />
      <ToolbarButton icon={PanelRight} label="Preview" active={detailsVisible} onClick={onToggleDetails} />
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "5px 10px",
        border: "none",
        borderRadius: "4px",
        background: active
          ? "rgba(255,255,255,0.08)"
          : hovered && !disabled
            ? "rgba(255,255,255,0.06)"
            : "transparent",
        color: disabled
          ? "rgba(255,255,255,0.2)"
          : "#fff",
        fontSize: "12px",
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      <Icon
        size={15}
        strokeWidth={1.5}
        style={{ opacity: disabled ? 0.3 : 0.7 }}
      />
      <span>{label}</span>
    </button>
  );
}

function Separator() {
  return (
    <div
      style={{
        width: "1px",
        height: "20px",
        background: "rgba(255,255,255,0.06)",
        margin: "0 6px",
        flexShrink: 0,
      }}
    />
  );
}
