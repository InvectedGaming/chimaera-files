import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  cwd: string;
  visible: boolean;
}

export function TerminalPanel({ cwd, visible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<number | null>(null);
  const [, setReady] = useState(false);

  // Spawn terminal
  useEffect(() => {
    if (!visible || !containerRef.current) return;

    const term = new XTerm({
      fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: "bar",
      theme: {
        background: "transparent",
        foreground: "#cccccc",
        cursor: "#60cdff",
        selectionBackground: "rgba(96, 205, 255, 0.3)",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#6a9955",
        yellow: "#dcdcaa",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4ec9b0",
        white: "#d4d4d4",
      },
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Spawn PTY
    invoke("terminal_spawn", { cwd, shell: null }).then((id) => {
      idRef.current = id as number;
      setReady(true);

      // Send keystrokes to PTY
      term.onData((data) => {
        const encoder = new TextEncoder();
        invoke("terminal_write", { id, data: Array.from(encoder.encode(data)) });
      });
    });

    // Listen for output
    const unlisten = listen<{ id: number; data: number[] }>("terminal-output", (event) => {
      if (event.payload.id === idRef.current) {
        const decoder = new TextDecoder();
        term.write(decoder.decode(new Uint8Array(event.payload.data)));
      }
    });

    // Resize handler
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unlisten.then((fn) => fn());
      resizeObserver.disconnect();
      if (idRef.current !== null) {
        invoke("terminal_close", { id: idRef.current });
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      idRef.current = null;
      setReady(false);
    };
  }, [visible]); // Don't respawn PTY on cwd change — just cd into it

  if (!visible) return null;

  return (
    <div
      style={{
        height: "100%",
        padding: "8px",
        background: "rgba(20, 20, 20, 0.5)",
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}
