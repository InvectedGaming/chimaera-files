import { useEffect, useState, useCallback, useRef } from "react";
import { readFileText, writeFileText, getFileMetadata, type FileMetadataInfo } from "../api";
import { useFileUrl } from "../hooks/useFileUrl";
import { CodePreview } from "./CodePreview";
import { MarkdownPreview } from "./MarkdownPreview";
import { formatSize, formatDate } from "../utils/format";
import { X, FileText, Image, Film, Music, File, Save, Pencil, Eye, ExternalLink } from "lucide-react";

interface PreviewPanelProps {
  path: string;
  onClose: () => void;
}

const imageExts = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "tiff", "tif"]);
const videoExts = new Set(["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv"]);
const audioExts = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma"]);
const pdfExts = new Set(["pdf"]);

const binaryExts = new Set([
  "exe", "dll", "sys", "bin", "iso", "img", "dmg",
  "zip", "tar", "gz", "7z", "rar", "bz2", "xz",
  "db", "sqlite", "mdb",
  "psd", "ai", "sketch", "fig",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "ttf", "otf", "woff", "woff2",
]);

function isKnownBinary(ext: string): boolean {
  return binaryExts.has(ext) || imageExts.has(ext) || videoExts.has(ext) || audioExts.has(ext) || pdfExts.has(ext);
}

export function PreviewPanel({ path, onClose }: PreviewPanelProps) {
  const [meta, setMeta] = useState<FileMetadataInfo | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [rawView, setRawView] = useState(false);
  const [escWarning, setEscWarning] = useState(false);
  const editingRef = useRef(false);
  const escWarningRef = useRef(false);
  const dirtyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleStartEditingRef = useRef<() => void>(() => {});
  const animateCloseRef = useRef<() => void>(() => {});
  const isTextRef = useRef(false);
  const textContentRef = useRef<string | null>(null);

  // Keep refs in sync
  editingRef.current = editing;
  escWarningRef.current = escWarning;
  dirtyRef.current = dirty;
  // Phases: backdrop-in → modal-in → (visible) → modal-out → backdrop-out → unmount
  const [phase, setPhase] = useState<"backdrop-in" | "modal-in" | "visible" | "modal-out" | "backdrop-out">("backdrop-in");

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const isImage = imageExts.has(ext);
  const isVideo = videoExts.has(ext);
  const isAudio = audioExts.has(ext);
  const isPdf = pdfExts.has(ext);
  const isText = !isImage && !isVideo && !isAudio && !isPdf;
  const needsMediaUrl = isImage || isAudio;
  const { url: mediaUrl, tooLarge } = useFileUrl(needsMediaUrl ? path : null);

  const animateClose = useCallback(() => {
    if (phase === "modal-out" || phase === "backdrop-out") return;
    setPhase("modal-out");
    setTimeout(() => setPhase("backdrop-out"), 120);
    setTimeout(() => onClose(), 250);
  }, [onClose, phase]);

  // Open sequence: backdrop first, then modal
  useEffect(() => {
    requestAnimationFrame(() => {
      setPhase("modal-in");
      contentRef.current?.focus();
      setTimeout(() => setPhase("visible"), 150);
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // When editing, handle Escape here (window level catches it before textarea)
      if (editingRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (dirtyRef.current && !escWarningRef.current) {
            setEscWarning(true);
            return;
          }
          // Exit edit mode back to preview
          setEditing(false);
          setEditedContent(textContent ?? "");
          setDirty(false);
          setEscWarning(false);
          setTimeout(() => contentRef.current?.focus(), 50);
          return;
        }
        // Clear warning on any other key
        if (escWarningRef.current && e.key !== "Escape") {
          setEscWarning(false);
        }
        // Let textarea handle all other keys
        return;
      }

      // Not editing — normal preview shortcuts
      // Ctrl+Shift+Space: "Open with" dialog
      if (e.ctrlKey && e.shiftKey && e.key === " ") {
        e.preventDefault();
        import("../api").then(({ openFileWith }) => openFileWith(path));
        return;
      }
      // Ctrl+Space: open with default app
      if (e.ctrlKey && e.key === " ") {
        e.preventDefault();
        import("../api").then(({ openFile }) => openFile(path));
        return;
      }
      // E: start editing (text files only)
      if (e.key === "e" && isTextRef.current && textContentRef.current !== null) {
        e.preventDefault();
        handleStartEditingRef.current();
        return;
      }
      // Shift+Arrow: cycle files
      if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("preview-cycle", {
          detail: { direction: e.key === "ArrowDown" ? "down" : "up" },
        }));
        return;
      }

      // Arrow keys, Page, Home, End: let browser scroll the focused content div naturally
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(e.key)) {
        e.stopPropagation(); // Stop App.tsx from handling
        // Don't preventDefault — let the browser scroll the focused contentRef
        return;
      }

      // Space or Escape: close
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        animateCloseRef.current();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []); // Empty deps — all values read from refs

  useEffect(() => {
    getFileMetadata(path).then(setMeta).catch(() => {});
    if (!isKnownBinary(ext)) {
      readFileText(path)
        .then((text) => {
          setTextContent(text);
          setEditedContent(text);
        })
        .catch(() => {
          setTextContent("[Unable to read file]");
        });
    }
  }, [path, ext]);

  const handleSave = useCallback(async () => {
    try {
      await writeFileText(path, editedContent);
      setTextContent(editedContent);
      setDirty(false);
      setSaveStatus("Saved");
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (e) {
      setSaveStatus(`Error: ${e}`);
    }
  }, [path, editedContent]);

  const handleStartEditing = useCallback(() => {
    // Capture scroll position before switching to editor
    const scrollTop = contentRef.current?.scrollTop ?? 0;
    setEditing(true);
    setEditedContent(textContent ?? "");
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        // Restore scroll position
        textareaRef.current.scrollTop = scrollTop;
        // Place cursor at approximate position based on scroll
        const lineHeight = 19.2; // 12px font * 1.6 line-height
        const approxLine = Math.floor(scrollTop / lineHeight);
        const lines = (textContent ?? "").split("\n");
        let charPos = 0;
        for (let i = 0; i < Math.min(approxLine, lines.length); i++) {
          charPos += lines[i].length + 1;
        }
        textareaRef.current.setSelectionRange(charPos, charPos);
      }
    }, 50);
  }, [textContent]);
  handleStartEditingRef.current = handleStartEditing;
  animateCloseRef.current = animateClose;
  isTextRef.current = isText;
  textContentRef.current = textContent;

  const backdropVisible = phase !== "backdrop-in" && phase !== "backdrop-out";
  const modalVisible = phase === "visible" || phase === "modal-in";
  const closing = phase === "modal-out" || phase === "backdrop-out";

  return (
    <>
      <style>{`
        @keyframes previewBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes previewBackdropOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes previewModalIn {
          from { opacity: 0; transform: scale(0.94) translateY(16px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes previewModalOut {
          from { opacity: 1; transform: scale(1) translateY(0); }
          to { opacity: 0; transform: scale(0.97) translateY(10px); }
        }
      `}</style>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          top: "-12px",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: "12px",
          background: "linear-gradient(to bottom, transparent 0px, rgba(0,0,0,0.55) 12px)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          animation: phase === "backdrop-out"
            ? "previewBackdropOut 0.12s ease-in forwards"
            : backdropVisible
              ? "previewBackdropIn 0.15s ease-out forwards"
              : undefined,
          opacity: phase === "backdrop-in" ? 0 : undefined,
          pointerEvents: closing ? "none" : "auto",
        }}
        onClick={animateClose}
      >
        <div
          style={{
            background: "rgba(36, 36, 36, 0.96)",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.08)",
            width: "75%",
            maxWidth: "900px",
            height: "80vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 16px 64px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
            animation: phase === "modal-out"
              ? "previewModalOut 0.12s ease-in forwards"
              : modalVisible
                ? "previewModalIn 0.18s ease-out forwards"
                : undefined,
            opacity: phase === "backdrop-in" || phase === "backdrop-out" ? 0 : undefined,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            gap: "12px",
            flexShrink: 0,
          }}>
            <PreviewIcon ext={ext} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: "#fff",
                fontSize: "14px",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {meta?.name ?? path.split("/").pop()}
              </div>
              {meta && (
                <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "12px", marginTop: "3px" }}>
                  {formatSize(meta.size)} — Modified {formatDate(meta.modified_at)}
                  {ext && ` — .${ext}`}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                import("../api").then(({ openFile }) => openFile(path));
              }}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "5px 12px", borderRadius: "5px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)", fontSize: "12px", cursor: "pointer",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
            >
              <ExternalLink size={13} strokeWidth={1.5} /> Open
            </button>
            <button
              onClick={animateClose}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "30px", height: "30px", borderRadius: "6px",
                border: "none", background: "transparent",
                color: "rgba(255,255,255,0.5)", cursor: "pointer",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          {/* Content */}
          <div
            ref={contentRef}
            tabIndex={0}
            style={{
              flex: 1,
              overflow: editing ? "hidden" : "auto",
              outline: "none",
              position: "relative",
              minHeight: 0,
            }}
          >
            {needsMediaUrl && !mediaUrl && !tooLarge && (
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>Loading...</div>
            )}
            {tooLarge && (
              <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)" }}>
                <Film size={48} strokeWidth={0.8} style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: "13px", marginBottom: "12px" }}>File too large for in-app preview</div>
                <button
                  onClick={() => { import("../api").then(({ openFile }) => openFile(path)); }}
                  style={{
                    padding: "8px 16px", borderRadius: "4px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff", fontSize: "13px", cursor: "pointer",
                  }}
                >
                  Open with default app
                </button>
              </div>
            )}
            {isImage && mediaUrl && (
              <div style={{ padding: "20px", display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
                <img src={mediaUrl} alt={meta?.name} style={{ maxWidth: "100%", maxHeight: "65vh", objectFit: "contain", borderRadius: "4px" }} />
              </div>
            )}
            {isVideo && (
              <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)" }}>
                <Film size={48} strokeWidth={0.8} style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: "13px", marginBottom: "12px" }}>Video preview not available</div>
                <button
                  onClick={() => { import("../api").then(({ openFile }) => openFile(path)); }}
                  style={{
                    padding: "8px 16px", borderRadius: "4px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff", fontSize: "13px", cursor: "pointer",
                  }}
                >
                  Open with default app
                </button>
              </div>
            )}
            {isAudio && mediaUrl && (
              <div style={{ padding: "40px 20px", textAlign: "center", width: "100%" }}>
                <Music size={56} strokeWidth={0.8} style={{ color: "rgba(255,255,255,0.15)", margin: "0 auto 20px" }} />
                <audio src={mediaUrl} controls autoPlay style={{ width: "100%", maxWidth: "500px" }} />
              </div>
            )}
            {isPdf && (
              <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)" }}>
                <FileText size={48} strokeWidth={0.8} style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: "13px", marginBottom: "12px" }}>PDF preview</div>
                <button
                  onClick={() => { import("../api").then(({ openFile }) => openFile(path)); }}
                  style={{
                    padding: "8px 16px", borderRadius: "4px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff", fontSize: "13px", cursor: "pointer",
                  }}
                >
                  Open with default app
                </button>
              </div>
            )}
            {/* Unsaved changes warning */}
            {escWarning && (
              <div style={{
                position: "absolute",
                top: "8px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 10,
                background: "rgba(248, 113, 113, 0.15)",
                border: "1px solid rgba(248, 113, 113, 0.3)",
                borderRadius: "6px",
                padding: "8px 16px",
                fontSize: "12px",
                color: "#f87171",
                backdropFilter: "blur(8px)",
                animation: "previewModalIn 0.1s ease-out",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}>
                Unsaved changes will be lost. Press <kbd style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "3px",
                  padding: "1px 5px",
                  fontSize: "11px",
                  color: "#fff",
                }}>Esc</kbd> again to discard.
              </div>
            )}
            {isText && textContent !== null && (
                  editing ? (
                    <textarea
                      ref={textareaRef}
                      value={editedContent}
                      onChange={(e) => {
                        setEditedContent(e.target.value);
                        setDirty(true);
                      }}
                      onKeyDown={(e) => {
                        // Ctrl+S to save
                        if (e.ctrlKey && e.key === "s") {
                          e.preventDefault();
                          handleSave();
                          return;
                        }
                        // Ctrl+Space: save and close
                        if (e.ctrlKey && e.key === " ") {
                          e.preventDefault();
                          handleSave().then(() => animateClose());
                          return;
                        }
                        // Ctrl+Shift+Space: open with
                        if (e.ctrlKey && e.shiftKey && e.key === " ") {
                          e.preventDefault();
                          import("../api").then(({ openFileWith }) => openFileWith(path));
                          return;
                        }
                        // Stop other keys from bubbling (so Space doesn't close)
                        e.stopPropagation();
                      }}
                      style={{
                        position: "absolute",
                        inset: 0,
                        fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace",
                        fontSize: "12px",
                        color: "rgba(255,255,255,0.85)",
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        resize: "none",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        lineHeight: 1.6,
                        padding: "16px 20px",
                        margin: 0,
                        tabSize: 4,
                      }}
                      spellCheck={false}
                    />
                  ) : (
                    <div style={{ width: "100%" }}>
                      {ext === "md" && !rawView ? (
                        <MarkdownPreview content={textContent} />
                      ) : (
                        <CodePreview content={textContent} ext={ext} />
                      )}
                    </div>
                  )
            )}
            {isText && textContent === null && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>
                Loading...
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: "8px 20px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            fontSize: "11px",
            color: "rgba(255,255,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>↑↓</span> scroll · <span style={{ color: "rgba(255,255,255,0.4)" }}>Shift+↑↓</span> cycle files · <span style={{ color: "rgba(255,255,255,0.4)" }}>Space</span> close · {isText && <><span style={{ color: "rgba(255,255,255,0.4)" }}>E</span> edit · </>}<span style={{ color: "rgba(255,255,255,0.4)" }}>Ctrl+Space</span> open · <span style={{ color: "rgba(255,255,255,0.4)" }}>Ctrl+Shift+Space</span> open with
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {saveStatus && (
                <span style={{ color: saveStatus.startsWith("Error") ? "#f87171" : "#60cdff", fontSize: "11px" }}>
                  {saveStatus}
                </span>
              )}
              {isText && textContent !== null && !editing && ext === "md" && (
                <FooterButton
                  icon={rawView ? Eye : FileText}
                  label={rawView ? "Preview" : "Raw"}
                  onClick={() => setRawView((v) => !v)}
                />
              )}
              {isText && textContent !== null && !editing && (
                <FooterButton icon={Pencil} label="Edit" onClick={handleStartEditing} />
              )}
              {editing && dirty && (
                <button
                  onClick={handleSave}
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "4px 12px", borderRadius: "4px",
                    border: "none",
                    background: "#60cdff",
                    color: "#000", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <Save size={11} strokeWidth={2} /> Save
                </button>
              )}
              {editing && (
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px" }}>
                  Ctrl+S save · Ctrl+Space save &amp; close · Esc exit edit
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FooterButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "5px",
        padding: "4px 10px", borderRadius: "4px",
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.04)",
        color: "rgba(255,255,255,0.6)", fontSize: "11px", cursor: "pointer",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
    >
      <Icon size={11} strokeWidth={1.5} /> {label}
    </button>
  );
}

function PreviewIcon({ ext }: { ext: string }) {
  const style: React.CSSProperties = { color: "rgba(255,255,255,0.4)", flexShrink: 0 };
  if (imageExts.has(ext)) return <Image size={20} strokeWidth={1.5} style={style} />;
  if (videoExts.has(ext)) return <Film size={20} strokeWidth={1.5} style={style} />;
  if (audioExts.has(ext)) return <Music size={20} strokeWidth={1.5} style={style} />;
  if (pdfExts.has(ext)) return <FileText size={20} strokeWidth={1.5} style={style} />;
  return <File size={20} strokeWidth={1.5} style={style} />;
}
