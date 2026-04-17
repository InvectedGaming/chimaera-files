import { useEffect, useState } from "react";
import {
  readFilePreview,
  getFileMetadata,
  type FileMetadataInfo,
  type FileItem,
} from "../api";
import { formatSize } from "../utils/format";
import { useFileUrl } from "../hooks/useFileUrl";
import {
  File,
  FileText,
  Image,
  Film,
  Music,
  Folder,
  Info,
  Calendar,
  HardDrive,
  Hash,
  Type,
} from "lucide-react";

interface DetailsPanelProps {
  item: FileItem | null;
  width: number;
}

const imageExts = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const textExts = new Set(["txt", "md", "log", "json", "toml", "yaml", "yml", "xml", "csv", "ts", "tsx", "js", "jsx", "rs", "py", "css", "html", "sh", "bat", "ps1", "cfg", "ini", "env"]);
const videoExts = new Set(["mp4", "mkv", "avi", "mov", "webm"]);
const audioExts = new Set(["mp3", "wav", "flac", "ogg", "m4a"]);

export function DetailsPanel({ item, width }: DetailsPanelProps) {
  const [meta, setMeta] = useState<FileMetadataInfo | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  const ext = item?.extension?.toLowerCase() ?? "";
  const isImage = imageExts.has(ext);
  const isText = textExts.has(ext);
  const isAudio = audioExts.has(ext);

  // ALL hooks must be called before any early return
  const { url: mediaUrl } = useFileUrl(item && (isImage || isAudio) ? item.path : null);

  useEffect(() => {
    setMeta(null);
    setTextContent(null);
    if (!item) return;

    getFileMetadata(item.path).then(setMeta).catch(() => {});

    if (textExts.has(item.extension?.toLowerCase() ?? "")) {
      readFilePreview(item.path, 8 * 1024).then(setTextContent).catch(() => {});
    }
  }, [item?.path]);

  if (!item) {
    return (
      <div
        style={{
          width,
          flexShrink: 0,
          borderLeft: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(32,32,32,0.5)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 20px",
          color: "rgba(255,255,255,0.25)",
          fontSize: "13px",
          textAlign: "center",
          gap: "8px",
        }}
      >
        <Info size={32} strokeWidth={1} />
        <span>Select a file to see details</span>
      </div>
    );
  }

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(32,32,32,0.5)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Preview area */}
      <div
        style={{
          padding: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "180px",
          maxHeight: "280px",
          overflow: "hidden",
          background: "rgba(0,0,0,0.15)",
        }}
      >
        {isImage && mediaUrl ? (
          <img
            src={mediaUrl}
            alt={item.name}
            style={{ maxWidth: "100%", maxHeight: "240px", objectFit: "contain", borderRadius: "4px" }}
          />
        ) : isAudio && mediaUrl ? (
          <div style={{ textAlign: "center", width: "100%", padding: "20px" }}>
            <Music size={48} strokeWidth={0.8} style={{ color: "rgba(255,255,255,0.2)", margin: "0 auto 16px" }} />
            <audio src={mediaUrl} controls style={{ width: "100%" }} />
          </div>
        ) : isText && textContent ? (
          <pre
            style={{
              fontFamily: "Cascadia Code, Consolas, monospace",
              fontSize: "10px",
              color: "rgba(255,255,255,0.5)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              lineHeight: 1.4,
              maxHeight: "240px",
              overflow: "hidden",
              width: "100%",
              padding: "8px",
            }}
          >
            {textContent.slice(0, 2000)}
          </pre>
        ) : (
          <PreviewIcon item={item} />
        )}
      </div>

      {/* File name */}
      <div
        style={{
          padding: "16px 20px 8px",
          fontSize: "14px",
          fontWeight: 600,
          color: "#fff",
          wordBreak: "break-word",
          lineHeight: 1.3,
        }}
      >
        {item.name}
      </div>

      {/* Metadata */}
      <div style={{ padding: "0 20px 20px", overflow: "auto", flex: 1 }}>
        {meta && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <MetaRow icon={Type} label="Type" value={
              item.is_directory ? "File folder" : ext ? `${ext.toUpperCase()} File` : "File"
            } />
            {!item.is_directory && (
              <MetaRow icon={HardDrive} label="Size" value={formatSize(meta.size)} />
            )}
            {meta.modified_at && (
              <MetaRow icon={Calendar} label="Modified" value={
                new Date(meta.modified_at).toLocaleString(undefined, {
                  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })
              } />
            )}
            {meta.created_at && (
              <MetaRow icon={Calendar} label="Created" value={
                new Date(meta.created_at).toLocaleString(undefined, {
                  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })
              } />
            )}
            <MetaRow icon={Hash} label="Path" value={meta.path} mono />
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({ icon: Icon, label, value, mono = false }: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <Icon size={14} strokeWidth={1.5} style={{ color: "rgba(255,255,255,0.3)", marginTop: "2px", flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginBottom: "2px" }}>{label}</div>
        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", wordBreak: "break-all", fontFamily: mono ? "Cascadia Code, Consolas, monospace" : "inherit" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function PreviewIcon({ item }: { item: FileItem }) {
  const style: React.CSSProperties = {
    color: item.is_directory ? "rgba(242, 197, 92, 0.4)" : "rgba(255,255,255,0.15)",
  };
  const size = 56;
  const sw = 0.8;
  if (item.is_directory) return <Folder size={size} strokeWidth={sw} style={style} />;
  const ext = item.extension?.toLowerCase() ?? "";
  if (textExts.has(ext)) return <FileText size={size} strokeWidth={sw} style={style} />;
  if (imageExts.has(ext)) return <Image size={size} strokeWidth={sw} style={style} />;
  if (videoExts.has(ext)) return <Film size={size} strokeWidth={sw} style={style} />;
  if (audioExts.has(ext)) return <Music size={size} strokeWidth={sw} style={style} />;
  return <File size={size} strokeWidth={sw} style={style} />;
}
