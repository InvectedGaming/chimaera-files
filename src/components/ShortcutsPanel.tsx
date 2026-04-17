import { useState, useEffect, useCallback } from "react";
import { X, Keyboard } from "lucide-react";

interface ShortcutsPanelProps {
  visible: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "↑ / ↓", description: "Move selection up / down" },
      { keys: "→ / Enter", description: "Open selected item" },
      { keys: "←", description: "Go to parent folder" },
      { keys: "Backspace", description: "Go to parent folder" },
      { keys: "Alt + ←", description: "Go back" },
      { keys: "Alt + →", description: "Go forward" },
      { keys: "Home / End", description: "Jump to first / last item" },
      { keys: "Page Up / Down", description: "Jump 10 items" },
      { keys: "Type a letter", description: "Jump to matching file" },
    ],
  },
  {
    title: "Preview",
    shortcuts: [
      { keys: "Space", description: "Open / close preview" },
      { keys: "↑ / ↓ in preview", description: "Scroll preview content" },
      { keys: "Shift + ↑ / ↓ in preview", description: "Cycle through files" },
      { keys: "E", description: "Edit file (text files)" },
      { keys: "Ctrl + Space", description: "Open with default app" },
      { keys: "Ctrl + Shift + Space", description: "Open with... dialog" },
    ],
  },
  {
    title: "Editing (in preview)",
    shortcuts: [
      { keys: "Ctrl + S", description: "Save changes" },
      { keys: "Ctrl + Space", description: "Save and close" },
      { keys: "Esc", description: "Cancel editing" },
    ],
  },
  {
    title: "File operations",
    shortcuts: [
      { keys: "Ctrl + C", description: "Copy" },
      { keys: "Ctrl + X", description: "Cut" },
      { keys: "Ctrl + V", description: "Paste" },
      { keys: "Delete", description: "Move to Recycle Bin" },
      { keys: "F2", description: "Rename" },
      { keys: "Ctrl + Z", description: "Undo last operation" },
      { keys: "Ctrl + Shift + N", description: "New folder" },
    ],
  },
  {
    title: "Tabs & Window",
    shortcuts: [
      { keys: "Ctrl + T", description: "New tab" },
      { keys: "Ctrl + W", description: "Close tab" },
      { keys: "Win + E", description: "Focus / launch app" },
      { keys: "`  (backtick)", description: "Toggle terminal" },
    ],
  },
  {
    title: "Search",
    shortcuts: [
      { keys: "/  or  Ctrl + F", description: "Focus search" },
      { keys: "Ctrl + L", description: "Focus path bar" },
      { keys: "Esc", description: "Close search / preview / menu" },
    ],
  },
];

export function ShortcutsPanel({ visible, onClose }: ShortcutsPanelProps) {
  const [phase, setPhase] = useState<"entering" | "visible" | "exiting">("entering");

  const animateClose = useCallback(() => {
    if (phase === "exiting") return;
    setPhase("exiting");
    setTimeout(() => onClose(), 150);
  }, [onClose, phase]);

  useEffect(() => {
    requestAnimationFrame(() => setPhase("visible"));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        animateClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [animateClose]);

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes shortcutsBackdropIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shortcutsBackdropOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes shortcutsIn { from { opacity: 0; transform: scale(0.95) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes shortcutsOut { from { opacity: 1; transform: scale(1) translateY(0); } to { opacity: 0; transform: scale(0.97) translateY(8px); } }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
          animation: phase === "exiting"
            ? "shortcutsBackdropOut 0.12s ease-in forwards"
            : "shortcutsBackdropIn 0.15s ease-out forwards",
          pointerEvents: phase === "exiting" ? "none" : "auto",
        }}
        onClick={animateClose}
      >
        <div
          style={{
            background: "rgba(36, 36, 36, 0.96)",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.08)",
            width: "680px",
            maxWidth: "90vw",
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 16px 64px rgba(0,0,0,0.5)",
            animation: phase === "exiting"
              ? "shortcutsOut 0.12s ease-in forwards"
              : "shortcutsIn 0.18s ease-out forwards",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            gap: "12px",
          }}>
            <Keyboard size={20} strokeWidth={1.5} style={{ color: "rgba(255,255,255,0.4)" }} />
            <span style={{ flex: 1, fontSize: "15px", fontWeight: 600, color: "#fff" }}>
              Keyboard Shortcuts
            </span>
            <button
              onClick={animateClose}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "28px", height: "28px", borderRadius: "6px",
                border: "none", background: "transparent",
                color: "rgba(255,255,255,0.5)", cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          {/* Content — two column grid */}
          <div style={{
            flex: 1,
            overflow: "auto",
            padding: "16px 20px 20px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "20px",
          }}>
            {shortcutGroups.map((group) => (
              <div key={group.title}>
                <div style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#60cdff",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: "8px",
                }}>
                  {group.title}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  {group.shortcuts.map((s) => (
                    <div
                      key={s.keys}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 8px",
                        borderRadius: "4px",
                        gap: "12px",
                      }}
                    >
                      <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
                        {s.description}
                      </span>
                      <kbd style={{
                        fontSize: "11px",
                        color: "rgba(255,255,255,0.8)",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "4px",
                        padding: "2px 6px",
                        fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}>
                        {s.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            padding: "8px 20px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            fontSize: "11px",
            color: "rgba(255,255,255,0.2)",
            textAlign: "center",
          }}>
            Press <kbd style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "3px",
              padding: "1px 4px",
              fontSize: "10px",
              color: "rgba(255,255,255,0.4)",
            }}>?</kbd> or <kbd style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "3px",
              padding: "1px 4px",
              fontSize: "10px",
              color: "rgba(255,255,255,0.4)",
            }}>Esc</kbd> to close
          </div>
        </div>
      </div>
    </>
  );
}
