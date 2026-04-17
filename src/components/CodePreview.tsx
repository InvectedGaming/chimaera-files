import { useMemo } from "react";
import hljs from "highlight.js/lib/core";

// Register only common languages to keep bundle size down
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import ini from "highlight.js/lib/languages/ini";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import powershell from "highlight.js/lib/languages/powershell";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("powershell", powershell);

const extToLang: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript",
  ts: "typescript", tsx: "typescript",
  json: "json", jsonc: "json",
  html: "html", htm: "html", svg: "xml", xml: "xml",
  css: "css", scss: "css",
  py: "python",
  rs: "rust",
  sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml",
  md: "markdown",
  sql: "sql",
  ini: "ini", cfg: "ini", conf: "ini", env: "ini", toml: "ini",
  diff: "diff", patch: "diff",
  go: "go",
  java: "java",
  cs: "csharp",
  c: "cpp", cpp: "cpp", h: "cpp", hpp: "cpp",
  ps1: "powershell", psm1: "powershell",
};

interface CodePreviewProps {
  content: string;
  ext: string;
}

export function CodePreview({ content, ext }: CodePreviewProps) {
  const highlighted = useMemo(() => {
    const lang = extToLang[ext];
    if (lang) {
      try {
        return hljs.highlight(content, { language: lang }).value;
      } catch {
        return null;
      }
    }
    // Auto-detect
    try {
      const result = hljs.highlightAuto(content);
      if (result.relevance > 5) return result.value;
    } catch {}
    return null;
  }, [content, ext]);

  if (highlighted) {
    return (
      <>
        <style>{hljsTheme}</style>
        <pre
          style={{
            fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace",
            fontSize: "12px",
            lineHeight: 1.6,
            padding: "16px 20px",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </>
    );
  }

  // Fallback: plain text
  return (
    <pre
      style={{
        fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace",
        fontSize: "12px",
        color: "rgba(255,255,255,0.75)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        lineHeight: 1.6,
        padding: "16px 20px",
        margin: 0,
      }}
    >
      {content}
    </pre>
  );
}

// Dark theme matching Windows Terminal / VS Code dark
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
.hljs-deletion { color: #ce9178; background: rgba(255,0,0,0.1); }
.hljs-addition { background: rgba(0,255,0,0.1); }
.hljs-section { color: #dcdcaa; }
.hljs-bullet { color: #569cd6; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
.hljs-link { color: #569cd6; text-decoration: underline; }
`;
