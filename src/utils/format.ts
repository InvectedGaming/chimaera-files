export function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function formatDate(timestampMs: number | null): string {
  if (!timestampMs) return "";
  const date = new Date(timestampMs);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 365) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getFileIcon(item: {
  is_directory: boolean;
  extension: string | null;
  name: string;
}): string {
  if (item.is_directory) return "folder";
  const ext = item.extension?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
      return "file-code";
    case "json":
    case "toml":
    case "yaml":
    case "yml":
    case "xml":
      return "file-json";
    case "md":
    case "txt":
    case "log":
      return "file-text";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return "image";
    case "mp4":
    case "mkv":
    case "avi":
    case "mov":
    case "webm":
      return "film";
    case "mp3":
    case "wav":
    case "flac":
    case "ogg":
      return "music";
    case "zip":
    case "tar":
    case "gz":
    case "7z":
    case "rar":
      return "archive";
    case "pdf":
      return "file-text";
    case "exe":
    case "msi":
      return "package";
    case "rs":
      return "file-code";
    case "css":
    case "scss":
      return "palette";
    case "html":
      return "globe";
    default:
      return "file";
  }
}
