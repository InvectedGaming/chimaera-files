# Chimaera Files

A fast Windows file explorer with full-text search, code/markdown preview, an integrated terminal, and an incremental NTFS USN journal indexer. Built with [Tauri 2](https://tauri.app/), React 19, and Rust.

> **Status:** early / experimental. Windows-first. Expect rough edges.

## Features

- Browse local drives and directories
- Incremental indexing via the NTFS USN change journal (Windows)
- Full-text search over indexed files (SQLite FTS5)
- Preview for code, markdown, images, and media; zip / jar / xlsx / docx / etc. browsing
- Integrated PTY terminal
- Folder size rollups
- Global hotkey: `Win+E`

## Requirements

- **Windows 10/11** (the indexer uses the NTFS USN journal, which is Windows-only)
- [Rust](https://rustup.rs/) (stable, edition 2024 — needs 1.85+)
- [Bun](https://bun.sh/) or Node 20+
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2, MSVC build tools)

## Build

```bash
bun install
bun run tauri dev     # dev build
bun run tauri build   # release build
```

## Data location

The index database lives at `%LOCALAPPDATA%\chimaera-files\index.db`. Delete the folder to fully reset the index.

## Project layout

```
src/            React frontend
src-tauri/      Tauri shell + commands
crates/
  common/       Shared schema
  indexer/      SQLite + FTS + NTFS USN journal watcher
  mcp-server/   MCP stub (not yet implemented)
```

## License

MIT — see [LICENSE](LICENSE).
