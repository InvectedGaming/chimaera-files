import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getSettings,
  saveSettings,
  getIndexStatus,
  toggleDriveIndex,
  type Settings as SettingsType,
  type IndexStatus,
} from "../api";
import { formatSize } from "../utils/format";
import { HardDrive, ArrowLeft, Loader2 } from "lucide-react";

interface SettingsProps {
  onBack: () => void;
}

interface IndexProgress {
  drive: string;
  files: number;
  dirs: number;
  phase: "scanning" | "computing_stats" | "done";
}

export function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexingDrives, setIndexingDrives] = useState<Record<string, IndexProgress>>({});

  const loadData = useCallback(async () => {
    const [s, idx] = await Promise.all([getSettings(), getIndexStatus()]);
    setSettings(s);
    setIndexStatus(idx);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for indexing progress events
  useEffect(() => {
    const unlisten = listen<IndexProgress>("index-progress", (event) => {
      const p = event.payload;
      if (p.phase === "done") {
        setIndexingDrives((prev) => {
          const next = { ...prev };
          delete next[p.drive];
          return next;
        });
        // Refresh status
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

  const handleToggleDrive = useCallback(
    async (drive: string, enabled: boolean) => {
      if (enabled) {
        setIndexingDrives((prev) => ({
          ...prev,
          [drive]: { drive, files: 0, dirs: 0, phase: "scanning" },
        }));
      }
      try {
        await toggleDriveIndex(drive, enabled);
        if (!enabled) {
          // Removal is synchronous, refresh immediately
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

                    {/* Index status */}
                    {isIndexing ? (
                      <div style={{ color: "#60cdff", fontSize: "12px" }}>
                        {progress.phase === "computing_stats"
                          ? "Computing folder stats..."
                          : `Scanning... ${progress.files.toLocaleString()} files, ${progress.dirs.toLocaleString()} folders`}
                      </div>
                    ) : drv.enabled && drv.file_count > 0 ? (
                      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>
                        {drv.file_count.toLocaleString()} files indexed
                        {drv.last_indexed && ` — ${new Date(drv.last_indexed).toLocaleDateString()}`}
                      </div>
                    ) : drv.enabled ? (
                      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "12px" }}>
                        Enabled, pending index
                      </div>
                    ) : null}
                  </div>
                  {isIndexing ? (
                    <Loader2 size={18} strokeWidth={2} style={{ color: "#60cdff", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                  ) : (
                    <Toggle checked={drv.enabled} onChange={(v) => handleToggleDrive(drv.drive, v)} />
                  )}
                </div>

                {/* Progress bar */}
                {isIndexing && (
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
