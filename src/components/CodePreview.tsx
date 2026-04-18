import { useEffect, useState, useRef } from "react";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (html: string | null) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("../workers/highlight.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent<{ html: string | null; id: number }>) => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data.html);
      }
    };
  }
  return worker;
}

function highlightAsync(content: string, ext: string): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    getWorker().postMessage({ content, ext, id });
  });
}

interface CodePreviewProps {
  content: string;
  ext: string;
}

export function CodePreview({ content, ext }: CodePreviewProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const versionRef = useRef(0);

  useEffect(() => {
    const version = ++versionRef.current;
    setHighlighted(null); // Show plain text immediately

    highlightAsync(content, ext).then((html) => {
      // Only apply if this is still the current content
      if (version === versionRef.current) {
        setHighlighted(html);
      }
    });
  }, [content, ext]);

  return (
    <>
      {highlighted && <style>{hljsTheme}</style>}
      <pre
        style={{
          fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace",
          fontSize: "12px",
          lineHeight: 1.6,
          padding: "16px 20px",
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          color: highlighted ? undefined : "rgba(255,255,255,0.75)",
        }}
      >
        {highlighted ? (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          content
        )}
      </pre>
    </>
  );
}

const hljsTheme = `
.hljs {
  color: #d4d4d4;
  background: transparent;
}
.hljs-keyword,
.hljs-selector-tag,
.hljs-built_in { color: #569cd6; }
.hljs-type,
.hljs-class .hljs-title { color: #4ec9b0; }
.hljs-string,
.hljs-template-variable,
.hljs-addition { color: #ce9178; }
.hljs-comment,
.hljs-quote { color: #6a9955; font-style: italic; }
.hljs-number,
.hljs-literal { color: #b5cea8; }
.hljs-regexp { color: #d16969; }
.hljs-variable,
.hljs-template-variable { color: #9cdcfe; }
.hljs-attr,
.hljs-attribute { color: #9cdcfe; }
.hljs-tag { color: #569cd6; }
.hljs-name { color: #569cd6; }
.hljs-selector-id,
.hljs-selector-class { color: #d7ba7d; }
.hljs-function .hljs-title,
.hljs-title.function_ { color: #dcdcaa; }
.hljs-params { color: #d4d4d4; }
.hljs-punctuation { color: #d4d4d4; }
.hljs-property { color: #9cdcfe; }
.hljs-meta { color: #569cd6; }
.hljs-operator { color: #d4d4d4; }
.hljs-section { color: #dcdcaa; }
.hljs-bullet { color: #569cd6; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
.hljs-link { color: #569cd6; text-decoration: underline; }
`;
