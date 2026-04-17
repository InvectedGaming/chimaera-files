import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <>
      <style>{markdownStyles}</style>
      <div className="md-preview" style={{ padding: "20px 24px" }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </>
  );
}

const markdownStyles = `
.md-preview {
  color: rgba(255,255,255,0.85);
  font-size: 14px;
  line-height: 1.7;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
.md-preview h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  color: #fff;
}
.md-preview h2 {
  font-size: 20px;
  font-weight: 600;
  margin: 24px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  color: #fff;
}
.md-preview h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 20px 0 8px;
  color: #fff;
}
.md-preview h4, .md-preview h5, .md-preview h6 {
  font-size: 14px;
  font-weight: 600;
  margin: 16px 0 8px;
  color: rgba(255,255,255,0.9);
}
.md-preview p {
  margin: 0 0 12px;
}
.md-preview a {
  color: #60cdff;
  text-decoration: none;
}
.md-preview a:hover {
  text-decoration: underline;
}
.md-preview code {
  font-family: Cascadia Code, Cascadia Mono, Consolas, monospace;
  background: rgba(255,255,255,0.06);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: #ce9178;
}
.md-preview pre {
  background: rgba(0,0,0,0.25);
  border-radius: 6px;
  padding: 14px 16px;
  margin: 0 0 16px;
  overflow-x: auto;
}
.md-preview pre code {
  background: none;
  padding: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d4;
}
.md-preview ul, .md-preview ol {
  margin: 0 0 12px;
  padding-left: 24px;
}
.md-preview li {
  margin: 4px 0;
}
.md-preview li::marker {
  color: rgba(255,255,255,0.3);
}
.md-preview blockquote {
  border-left: 3px solid rgba(96,205,255,0.4);
  margin: 0 0 12px;
  padding: 4px 16px;
  color: rgba(255,255,255,0.6);
}
.md-preview hr {
  border: none;
  border-top: 1px solid rgba(255,255,255,0.08);
  margin: 20px 0;
}
.md-preview img {
  max-width: 100%;
  border-radius: 4px;
}
.md-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 16px;
  font-size: 13px;
}
.md-preview th {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 2px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.7);
  font-weight: 600;
}
.md-preview td {
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.md-preview input[type="checkbox"] {
  margin-right: 8px;
}
.md-preview strong {
  color: #fff;
  font-weight: 600;
}
.md-preview em {
  color: rgba(255,255,255,0.7);
}
`;
