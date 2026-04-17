import { useEffect, useState } from "react";
import { readFileBytes } from "../api";

const mimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tiff: "image/tiff",
  tif: "image/tiff",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  pdf: "application/pdf",
};

// Video files are too large to send over IPC — show "open externally" instead
const tooLargeExts = new Set(["mp4", "mkv", "avi", "mov", "webm", "wmv"]);

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function useFileUrl(path: string | null): { url: string | null; tooLarge: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      setTooLarge(false);
      return;
    }

    const ext = path.split(".").pop()?.toLowerCase() ?? "";

    if (tooLargeExts.has(ext)) {
      setTooLarge(true);
      setUrl(null);
      return;
    }

    let cancelled = false;
    let revoke: string | null = null;

    readFileBytes(path)
      .then((b64) => {
        if (cancelled) return;
        const mime = mimeTypes[ext] ?? "application/octet-stream";
        const blob = base64ToBlob(b64, mime);
        const objectUrl = URL.createObjectURL(blob);
        revoke = objectUrl;
        setUrl(objectUrl);
        setTooLarge(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTooLarge(true);
          setUrl(null);
        }
      });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
      setUrl(null);
      setTooLarge(false);
    };
  }, [path]);

  return { url, tooLarge };
}
