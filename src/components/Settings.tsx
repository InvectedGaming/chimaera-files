import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getSettings,
  saveSettings,
  getIndexStatus,
  getIndexingState,
  toggleDriveIndex,
  setDriveSyncMode,
  rescanDrive,
  installShellIntegration,
  uninstallShellIntegration,
  isShellIntegrationInstalled,
  type Settings as SettingsType,
  type IndexStatus,
  type DriveSyncMode,
  type UpdateChannel,
} from "../api";
import { checkForUpdate, installUpdate, type UpdateCheckResult } from "../utils/updater";
import { formatSize } from "../utils/format";
import { HardDrive, ArrowLeft, Loader2, RotateCw, Download } from "lucide-react";

interface SettingsProps {
  onBack: () => void;
}

interface IndexProgress {
  drive: string;
  files: number;
  dirs: number;
  /** Cumulative bytes of files seen so far — used to compute a live % of
   *  drive-used-bytes without waiting for the full scan to finish. */
  bytes: number;
  phase: "queued" | "scanning" | "computing_stats" | "done" | "cancelled" | "error";
  /** Position in queue (1-based), only present for the "queued" phase. */
  position?: number;
  /** Present for "error" phase. */
  message?: string;
}

function formatPct(pct: number): string {
  if (pct < 0.1) return "<0.1%";
  if (pct >= 99.95) return "~100%";
  return `${pct.toFixed(1)}%`;
}

export function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexingDrives, setIndexingDrives] = useState<Record<string, IndexProgress>>({});
  const [shellIntegrationOn, setShellIntegrationOn] = useState<boolean | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [updateBusy, setUpdateBusy] = useState<"checking" | "installing" | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    // Seed in-flight state from the backend so scans started before this
    // component mounted (e.g. auto-rescan at app launch) show up right away.
    const [s, idx, active, shell] = await Promise.all([
      getSettings(),
      getIndexStatus(),
      getIndexingState(),
      isShellIntegrationInstalled().catch(() => false),
    ]);
    setSettings(s);
    setIndexStatus(idx);
    setShellIntegrationOn(shell);
    setIndexingDrives((prev) => {
      const next = { ...prev };
      for (const a of active) {
        next[a.drive] = {
          drive: a.drive,
          files: a.files,
          dirs: a.dirs,
          bytes: a.bytes,
          phase: a.phase,
          position: a.position ?? undefined,
        };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for indexing progress events
  useEffect(() => {
    const unlisten = listen<IndexProgress>("index-progress", (event) => {
      const p = event.payload;
      // Terminal phases — drop the row from `indexingDrives` and refresh
      // the backend-reported status so the UI reflects the new state.
      if (p.phase === "done" || p.phase === "cancelled" || p.phase === "error") {
        setIndexingDrives((prev) => {
          const next = { ...prev };
          delete next[p.drive];
          return next;
        });
        getIndexStatus().then(setIndexStatus);
      } else {
        setIndexingDrives((prev) => ({ ...prev, [p.drive]: p }));
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSave = useCallback(
    async (patch: Partial<SettingsType>) => {
      if (!settings) return;
      const updated = { ...settings, ...patch };
      setSettings(updated);
      await saveSettings(updated);
    },
    [settings],
  );

  const handleCheckUpdate = useCallback(async () => {
    if (!settings) return;
    setUpdateBusy("checking");
    setUpdateError(null);
    try {
      const res = await checkForUpdate(settings.update_channel);
      setUpdateCheck(res);
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setUpdateBusy(null);
    }
  }, [settings]);

  const handleInstallUpdate = useCallback(async (result: UpdateCheckResult) => {
    setUpdateBusy("installing");
    setUpdateError(null);
    try {
      await installUpdate(result);
      // App exits inside the backend once the installer spawns — code past
      // this line is unreachable on the happy path.
    } catch (e) {
      setUpdateError(String(e));
      setUpdateBusy(null);
    }
  }, []);

  const handleToggleShellIntegration = useCallback(async (on: boolean) => {
    setShellIntegrationOn(on); // optimistic
    try {
      if (on) await installShellIntegration();
      else await uninstallShellIntegration();
    } catch (e) {
      console.error("shell integration toggle failed:", e);
      setShellIntegrationOn(!on); // revert
    }
  }, []);

  const handleChangeMode = useCallback(
    async (drive: string, mode: DriveSyncMode) => {
      // Optimistic local update; backend persists, restart picks up new
      // background-thread lifecycle (watcher / timer).
      setIndexStatus((prev) =>
        prev
          ? {
              ...prev,
              drives: prev.drives.map((d) =>
                d.drive === drive ? { ...d, sync_mode: mode } : d,
              ),
            }
          : prev,
      );
      try {
        await setDriveSyncMode(drive, mode);
      } catch (e) {
        console.error("setDriveSyncMode failed:", e);
        // Revert by reloading
        loadData();
      }
    },
    [loadData],
  );

  const handleRescan = useCallback(async (drive: string) => {
    // Optimistic queued state — worker will overwrite within a tick.
    setIndexingDrives((prev) => ({
      ...prev,
      [drive]: { drive, files: 0, dirs: 0, bytes: 0, phase: "queued" },
    }));
    try {
      await rescanDrive(drive);
    } catch (e) {
      console.error("rescanDrive failed:", e);
      setIndexingDrives((prev) => {
        const next = { ...prev };
        delete next[drive];
        return next;
      });
    }
  }, []);

  const handleToggleDrive = useCallback(
    async (drive: string, enabled: boolean) => {
      if (enabled) {
        // Optimistic "queued" state — worker emits real phase within a tick.
        setIndexingDrives((prev) => ({
          ...prev,
          [drive]: { drive, files: 0, dirs: 0, bytes: 0, phase: "queued" },
        }));
      }
      try {
        await toggleDriveIndex(drive, enabled);
        if (!enabled) {
          // Clear the row from the in-flight map right away — don't wait
          // for the cancelled event to bubble back. Then refresh counts.
          setIndexingDrives((prev) => {
            const next = { ...prev };
            delete next[drive];
            return next;
          });
          const idx = await getIndexStatus();
          setIndexStatus(idx);
        }
        // If enabling, progress events will drive the UI
      } catch (e) {
        console.error("Toggle drive index failed:", e);
        setIndexingDrives((prev) => {
          const next = { ...prev };
          delete next[drive];
          return next;
        });
      }
    },
    [],
  );

  if (!settings || !indexStatus) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.36)" }}>
        Loading settings...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
        <button
          onClick={onBack}
          style={navButtonStyle}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
        </button>
        <span style={{ fontSize: "20px", fontWeight: 600, color: "#fff" }}>Settings</span>
      </div>

      {/* General */}
      <SectionTitle>General</SectionTitle>
      <SettingsCard>
        <SettingsRow label="Default starting path">
          <input
            style={inputStyle}
            value={settings.default_path}
            onChange={(e) => handleSave({ default_path: e.target.value })}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow label="Show hidden files">
          <Toggle checked={settings.show_hidden_files} onChange={(v) => handleSave({ show_hidden_files: v })} />
        </SettingsRow>
        <Divider />
        <SettingsRow label="Confirm before delete">
          <Toggle checked={settings.confirm_delete} onChange={(v) => handleSave({ confirm_delete: v })} />
        </SettingsRow>
        <Divider />
        <SettingsRow label="Animations">
          <Toggle checked={settings.animations_enabled} onChange={(v) => handleSave({ animations_enabled: v })} />
        </SettingsRow>
      </SettingsCard>

      {/* Shell integration — Windows only */}
      <SectionTitle>Windows integration</SectionTitle>
      <SettingsCard>
        <SettingsRow label={"Right-click → \u201COpen in Chimaera\u201D"}>
          <Toggle
            checked={shellIntegrationOn === true}
            onChange={handleToggleShellIntegration}
          />
        </SettingsRow>
        <div style={{ padding: "0 16px 12px", fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
          Adds a context-menu entry on folders and drives. Per-user (no admin).
          On Windows 11 the entry appears under "Show more options."
        </div>
      </SettingsCard>

      {/* Updates */}
      <SectionTitle>Updates</SectionTitle>
      <SettingsCard>
        <SettingsRow label="Update channel">
          <div style={{ display: "flex", gap: "4px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "5px", padding: "2px" }}>
            {(["stable", "beta", "dev"] as UpdateChannel[]).map((ch) => (
              <button
                key={ch}
                onClick={() => handleSave({ update_channel: ch })}
                style={{
                  padding: "3px 10px",
                  fontSize: "11px",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  background: settings.update_channel === ch ? "#60cdff" : "transparent",
                  color: settings.update_channel === ch ? "#000" : "rgba(255,255,255,0.7)",
                  borderRadius: "3px",
                  textTransform: "capitalize",
                }}
              >
                {ch}
              </button>
            ))}
          </div>
        </SettingsRow>
        <Divider />
        <SettingsRow label="Check for updates on startup">
          <Toggle checked={settings.update_auto_check} onChange={(v) => handleSave({ update_auto_check: v })} />
        </SettingsRow>
        <Divider />
        <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={handleCheckUpdate}
            disabled={updateBusy !== null}
            style={{
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 500,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "5px",
              color: "#fff",
              cursor: updateBusy !== null ? "default" : "pointer",
              opacity: updateBusy !== null ? 0.5 : 1,
            }}
          >
            {updateBusy === "checking" ? "Checking..." : "Check for updates"}
          </button>
          {updateCheck && !updateCheck.available && (
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
              Up to date
            </span>
          )}
          {updateCheck?.available && (
            <>
              <span style={{ fontSize: "12px", color: "#60cdff" }}>
                Update available: {updateCheck.newVersion}
              </span>
              <button
                onClick={() => handleInstallUpdate(updateCheck)}
                disabled={updateBusy !== null}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 500,
                  background: "#60cdff",
                  border: "none",
                  borderRadius: "5px",
                  color: "#000",
                  cursor: updateBusy !== null ? "default" : "pointer",
                  opacity: updateBusy !== null ? 0.5 : 1,
                }}
              >
                <Download size={13} strokeWidth={1.6} />
                {updateBusy === "installing" ? "Downloading..." : "Download & install"}
              </button>
            </>
          )}
          {updateError && (
            <span style={{ fontSize: "11px", color: "#f87171" }}>
              {updateError}
            </span>
          )}
        </div>
      </SettingsCard>

      {/* Drives & Indexing */}
      <SectionTitle>Drives &amp; Indexing</SectionTitle>
      <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginBottom: "12px" }}>
        Enable indexing per drive for instant search and folder sizes. Enabled drives are automatically re-indexed on startup.
      </p>

      <SettingsCard>
        <div style={{ display: "flex", gap: "32px", padding: "14px 16px", fontSize: "13px" }}>
          <Stat label="Total files" value={indexStatus.total_files.toLocaleString()} />
          <Stat label="Total directories" value={indexStatus.total_dirs.toLocaleString()} />
          <Stat label="Database size" value={formatSize(indexStatus.db_size_bytes)} />
        </div>

        <Divider />

        {indexStatus.drives.map((drv) => {
          const progress = indexingDrives[drv.drive];
          const isIndexing = !!progress;
          const usedBytes = drv.drive_total_bytes - drv.drive_free_bytes;
          const usedPct = drv.drive_total_bytes > 0 ? (usedBytes / drv.drive_total_bytes) * 100 : 0;

          // "How much of the drive's content has been walked?" — bytes in
          // the index (live from progress events while scanning, otherwise
          // persisted `total_size`) vs used bytes on disk.
          const indexedBytes = isIndexing ? progress.bytes : drv.total_size;
          const indexedPct =
            drv.enabled && usedBytes > 0
              ? Math.min(100, (indexedBytes / usedBytes) * 100)
              : 0;
          return (
            <div key={drv.drive}>
              <div style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "13px" }}>
                  <HardDrive
                    size={20}
                    strokeWidth={1.5}
                    style={{ color: drv.enabled ? "#60cdff" : "rgba(255,255,255,0.3)", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#fff", marginBottom: "4px" }}>{drv.label}</div>

                    {/* Drive space bar */}
                    {drv.drive_total_bytes > 0 && (
                      <div style={{ marginBottom: "4px" }}>
                        <div style={{
                          height: "4px",
                          borderRadius: "2px",
                          background: "rgba(255,255,255,0.08)",
                          overflow: "hidden",
                          width: "100%",
                          maxWidth: "200px",
                        }}>
                          <div style={{
                            height: "100%",
                            borderRadius: "2px",
                            width: `${usedPct}%`,
                            background: usedPct > 90 ? "#e35050" : "#60cdff",
                          }} />
                        </div>
                        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>
                          {formatSize(drv.drive_free_bytes)} free of {formatSize(drv.drive_total_bytes)}
                        </div>
                      </div>
                    )}

                    {/* Index status text — when a baseline (last fully-scanned
                     *  count) is known we show "X of Y indexed" so the user
                     *  has a stable reference point during a re-scan. */}
                    {isIndexing ? (
                      <div style={{ color: "#60cdff", fontSize: "12px" }}>
                        {progress.phase === "queued"
                          ? progress.position && progress.position > 1
                            ? `Queued — ${progress.position - 1} drive${progress.position - 1 === 1 ? "" : "s"} ahead`
                            : "Queued"
                          : progress.phase === "computing_stats"
                            ? "Computing folder stats..."
                            : drv.baseline_file_count
                              ? `${progress.files.toLocaleString()} of ${drv.baseline_file_count.toLocaleString()} files indexed`
                              : `${progress.files.toLocaleString()} files indexed (${progress.dirs.toLocaleString()} folders)`}
                      </div>
                    ) : drv.enabled && drv.file_count > 0 ? (
                      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>
                        {drv.baseline_file_count && drv.file_count !== drv.baseline_file_count
                          ? `${drv.file_count.toLocaleString()} of ${drv.baseline_file_count.toLocaleString()} files indexed`
                          : `${drv.file_count.toLocaleString()} files indexed`}
                        {drv.last_indexed && ` · ${new Date(drv.last_indexed).toLocaleDateString()}`}
                      </div>
                    ) : drv.enabled ? (
                      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "12px" }}>
                        Enabled, pending first scan
                      </div>
                    ) : null}

                    {/* Indexed-bytes progress bar — always visible for enabled drives */}
                    {drv.enabled && (
                      <div style={{
                        height: "3px",
                        borderRadius: "2px",
                        background: "rgba(255,255,255,0.06)",
                        overflow: "hidden",
                        width: "100%",
                        maxWidth: "200px",
                        marginTop: "4px",
                      }}>
                        <div style={{
                          height: "100%",
                          borderRadius: "2px",
                          width: `${indexedPct}%`,
                          background: isIndexing ? "#60cdff" : "rgba(96,205,255,0.5)",
                          transition: "width 0.4s ease-out",
                        }} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    {drv.enabled && (
                      <ModeSelector
                        mode={drv.sync_mode}
                        onChange={(m) => handleChangeMode(drv.drive, m)}
                      />
                    )}
                    {drv.enabled && !isIndexing && (
                      <button
                        onClick={() => handleRescan(drv.drive)}
                        title="Rescan this drive now"
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: "28px", height: "28px", borderRadius: "5px",
                          border: "1px solid rgba(255,255,255,0.08)",
                          background: "transparent",
                          color: "rgba(255,255,255,0.7)", cursor: "pointer",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        <RotateCw size={14} strokeWidth={1.6} />
                      </button>
                    )}
                    {isIndexing ? (
                      <Loader2 size={18} strokeWidth={2} style={{ color: "#60cdff", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                    ) : (
                      <Toggle checked={drv.enabled} onChange={(v) => handleToggleDrive(drv.drive, v)} />
                    )}
                  </div>
                </div>

                {/* Indeterminate strip while actively scanning */}
                {isIndexing && (progress.phase === "scanning" || progress.phase === "computing_stats") && (
                  <div style={{ marginTop: "8px", marginLeft: "32px" }}>
                    <div style={{
                      height: "3px",
                      borderRadius: "2px",
                      background: "rgba(255,255,255,0.06)",
                      overflow: "hidden",
                    }}>
                      <div
                        style={{
                          height: "100%",
                          borderRadius: "2px",
                          background: "#60cdff",
                          animation: "indeterminate 1.5s ease-in-out infinite",
                          width: "30%",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <Divider />
            </div>
          );
        })}
      </SettingsCard>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}

function ModeSelector({
  mode,
  onChange,
}: {
  mode: DriveSyncMode;
  onChange: (m: DriveSyncMode) => void;
}) {
  const minutes = mode.kind === "timed" ? mode.interval_minutes : 30;

  const optionStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 8px",
    fontSize: "11px",
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    background: active ? "#60cdff" : "transparent",
    color: active ? "#000" : "rgba(255,255,255,0.7)",
    borderRadius: "3px",
  });

  return (
    <div
      title="How this drive's index is kept in sync. Restart the app to apply mode changes to background watchers/timers."
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "5px",
        padding: "2px",
      }}
    >
      <button style={optionStyle(mode.kind === "auto")} onClick={() => onChange({ kind: "auto" })}>
        Auto
      </button>
      <button style={optionStyle(mode.kind === "manual")} onClick={() => onChange({ kind: "manual" })}>
        Manual
      </button>
      <button
        style={optionStyle(mode.kind === "timed")}
        onClick={() => onChange({ kind: "timed", interval_minutes: minutes })}
      >
        Timed
      </button>
      {mode.kind === "timed" && (
        <input
          type="number"
          min={1}
          max={10080}
          value={minutes}
          onChange={(e) => {
            const next = Math.max(1, Math.min(10080, Number(e.target.value) || 1));
            onChange({ kind: "timed", interval_minutes: next });
          }}
          style={{
            width: "44px",
            padding: "2px 4px",
            fontSize: "11px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "3px",
            color: "#fff",
            outline: "none",
            textAlign: "right",
          }}
        />
      )}
      {mode.kind === "timed" && (
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginRight: "2px" }}>
          min
        </span>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "8px", marginTop: "24px" }}>
      {children}
    </div>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      borderRadius: "6px",
      border: "1px solid rgba(255,255,255,0.06)",
      overflow: "hidden",
    }}>
      {children}
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      fontSize: "13px",
      color: "#fff",
      gap: "16px",
    }}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "0 16px" }} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", marginBottom: "2px" }}>{label}</div>
      <div style={{ color: "#fff", fontSize: "14px", fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: "40px",
        height: "20px",
        borderRadius: "10px",
        border: checked ? "none" : "1px solid rgba(255,255,255,0.3)",
        background: checked ? "#60cdff" : "rgba(255,255,255,0.05)",
        position: "relative",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <div style={{
        width: "14px",
        height: "14px",
        borderRadius: "7px",
        background: checked ? "#000" : "rgba(255,255,255,0.7)",
        position: "absolute",
        top: "3px",
        left: checked ? "23px" : "3px",
      }} />
    </button>
  );
}

const navButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "32px",
  height: "32px",
  borderRadius: "4px",
  border: "none",
  background: "transparent",
  color: "rgba(255,255,255,0.8)",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "4px",
  padding: "6px 10px",
  color: "#fff",
  fontSize: "13px",
  outline: "none",
  minWidth: "200px",
};
