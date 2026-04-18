import hljs from "highlight.js/lib/core";

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
};

self.onmessage = (e: MessageEvent<{ content: string; ext: string; id: number }>) => {
  const { content, ext, id } = e.data;

  const lang = extToLang[ext];
  let html: string | null = null;

  if (lang) {
    try {
      html = hljs.highlight(content, { language: lang }).value;
    } catch {}
  }

  self.postMessage({ html, id });
};
