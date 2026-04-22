import { invoke } from "@tauri-apps/api/core";

export interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  extension: string | null;
  modified_at: number | null;
}

export interface DriveInfo {
  mount_point: string;
  label: string;
  total_space: number;
  free_space: number;
}

export interface FolderStats {
  total_size: number;
  file_count: number;
  direct_file_count: number;
  subfolder_count: number;
}

export async function listDirectory(path: string): Promise<FileItem[]> {
  return invoke("list_directory", { path });
}

export async function navigateTo(path: string): Promise<FileItem[]> {
  return invoke("navigate_to", { path });
}

export async function getDrives(): Promise<DriveInfo[]> {
  return invoke("get_drives");
}

export async function searchFiles(
  query: string,
  limit?: number,
): Promise<FileItem[]> {
  return invoke("search_files", { query, limit });
}

export type MatchMode = "substring" | "fuzzy" | "regex";

/// Count matches per direct-child folder of `parentPath`. Drives the "+N"
/// badges on folder rows during type-ahead. Returns an empty record when
/// the drive isn't indexed or the query is empty.
export async function searchSubtreeCounts(
  query: string,
  parentPath: string,
  mode?: MatchMode,
): Promise<Record<string, number>> {
  return invoke("search_subtree_counts", { query, parentPath, mode });
}

export async function getFolderStats(
  path: string,
): Promise<FolderStats | null> {
  return invoke("get_folder_stats", { path });
}

export async function getFolderSizes(
  paths: string[],
): Promise<Record<string, number>> {
  return invoke("get_folder_sizes", { paths });
}

export async function openFile(path: string): Promise<void> {
  return invoke("open_file", { path });
}

export async function openFileWith(path: string): Promise<void> {
  return invoke("open_file_with", { path });
}

export async function getHomeDir(): Promise<string> {
  return invoke("get_home_dir");
}

export async function getKnownFolders(): Promise<Record<string, string>> {
  return invoke("get_known_folders");
}

export async function watchDirectory(path: string): Promise<void> {
  return invoke("watch_directory", { path });
}

export async function unwatchDirectory(): Promise<void> {
  return invoke("unwatch_directory");
}

// --- Settings ---

export type UpdateChannel = "stable" | "beta" | "dev";

export interface Settings {
  default_path: string;
  show_hidden_files: boolean;
  confirm_delete: boolean;
  animations_enabled: boolean;
  update_channel: UpdateChannel;
  update_auto_check: boolean;
}

export async function getSettings(): Promise<Settings> {
  return invoke("get_settings");
}

export async function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { settings });
}

// --- Index management ---

export interface DriveIndexInfo {
  drive: string;
  label: string;
  enabled: boolean;
  file_count: number;
  dir_count: number;
  total_size: number;
  last_indexed: number | null;
  drive_total_bytes: number;
  drive_free_bytes: number;
  /** File count from the most recent fully-completed scan, or null if the
   *  drive has never finished one. Used as the denominator in "X of Y". */
  baseline_file_count: number | null;
  sync_mode: DriveSyncMode;
}

export interface IndexStatus {
  total_files: number;
  total_dirs: number;
  db_size_bytes: number;
  drives: DriveIndexInfo[];
}

export async function getIndexStatus(): Promise<IndexStatus> {
  return invoke("get_index_status");
}

export interface ActiveIndexProgress {
  drive: string;
  phase: "queued" | "scanning" | "computing_stats";
  files: number;
  dirs: number;
  bytes: number;
  position: number | null;
}

/** Snapshot of drives currently being indexed. Used by Settings on mount to
 *  catch up to in-flight work that started before the page was opened. */
export async function getIndexingState(): Promise<ActiveIndexProgress[]> {
  return invoke("get_indexing_state");
}

export async function toggleDriveIndex(
  drive: string,
  enabled: boolean,
): Promise<string> {
  return invoke("toggle_drive_index", { drive, enabled });
}

export type DriveSyncMode =
  | { kind: "auto" }
  | { kind: "manual" }
  | { kind: "timed"; interval_minutes: number };

export async function setDriveSyncMode(
  drive: string,
  mode: DriveSyncMode,
): Promise<void> {
  return invoke("set_drive_sync_mode", { drive, mode });
}

/** Trigger a fresh full scan immediately. Goes through the worker queue. */
export async function rescanDrive(drive: string): Promise<string> {
  return invoke("rescan_drive", { drive });
}

// --- Shell integration ---

export async function installShellIntegration(): Promise<void> {
  return invoke("install_shell_integration");
}

export async function uninstallShellIntegration(): Promise<void> {
  return invoke("uninstall_shell_integration");
}

export async function isShellIntegrationInstalled(): Promise<boolean> {
  return invoke("is_shell_integration_installed");
}

/** Returns the path the app was launched to open (from a double-click /
 *  right-click verb). One-shot: subsequent calls return null. */
export async function takePendingOpenPath(): Promise<string | null> {
  return invoke("take_pending_open_path");
}

export async function startIndex(path: string): Promise<string> {
  return invoke("start_index", { path });
}

export async function removeIndex(path: string): Promise<void> {
  return invoke("remove_index", { path });
}

// --- File operations ---

export interface OpResult {
  success: boolean;
  message: string;
}

export async function copyFiles(
  sources: string[],
  destDir: string,
): Promise<OpResult> {
  return invoke("copy_files", { sources, destDir });
}

export async function moveFiles(
  sources: string[],
  destDir: string,
): Promise<OpResult> {
  return invoke("move_files", { sources, destDir });
}

export async function deleteFiles(paths: string[]): Promise<OpResult> {
  return invoke("delete_files", { paths });
}

export async function renameFile(
  path: string,
  newName: string,
): Promise<OpResult> {
  return invoke("rename_file", { path, newName });
}

export async function createFolder(
  parentDir: string,
  name: string,
): Promise<OpResult> {
  return invoke("create_folder", { parentDir, name });
}

export async function undoLastOperation(): Promise<string> {
  return invoke("undo_last_operation");
}

export async function readFilePreview(
  path: string,
  maxBytes?: number,
): Promise<string> {
  return invoke("read_file_preview", { path, maxBytes });
}

export interface FileMetadataInfo {
  name: string;
  path: string;
  size: number;
  is_directory: boolean;
  created_at: number | null;
  modified_at: number | null;
  extension: string | null;
}

// --- Workspace ---

export interface WorkspaceTab {
  path: string;
  label: string;
}

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  active_tab_index: number;
  sidebar_width: number;
  terminal_visible: boolean;
  terminal_height: number;
}

export async function getWorkspace(): Promise<WorkspaceState> {
  return invoke("get_workspace");
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  return invoke("save_workspace", { state });
}

export async function isArchivePath(path: string): Promise<boolean> {
  return invoke("is_archive_path", { path });
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
): Promise<string> {
  return invoke("extract_archive", { archivePath, destDir });
}

export async function readFileBytes(path: string): Promise<string> {
  return invoke("read_file_bytes", { path });
}

export async function prepareMediaFile(path: string): Promise<string> {
  return invoke("prepare_media_file", { path });
}

export async function readFileText(path: string): Promise<string> {
  return invoke("read_file_text", { path });
}

export async function writeFileText(
  path: string,
  content: string,
): Promise<void> {
  return invoke("write_file_text", { path, content });
}

export async function getFileMetadata(
  path: string,
): Promise<FileMetadataInfo> {
  return invoke("get_file_metadata", { path });
}
