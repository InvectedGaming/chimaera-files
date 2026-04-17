import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy, Plus } from "lucide-react";
import { useState, useEffect } from "react";

interface Tab {
  id: string;
  label: string;
  path: string;
}

interface TitleBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export function TitleBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  return (
    <div
      data-tauri-drag-region
      className="flex items-end shrink-0 select-none bg-transparent"
      style={{ height: "46px", paddingTop: "6px" }}
    >
      {/* Tabs */}
      <div
        data-tauri-drag-region
        className="flex items-end h-full flex-1 min-w-0"
        style={{ paddingLeft: "24px", gap: "2px" }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center cursor-default ${
                active
                  ? "text-win-text"
                  : "text-win-text-secondary hover:text-win-text"
              }`}
              style={{
                height: "38px",
                padding: "0 16px",
                maxWidth: "240px",
                minWidth: "140px",
                fontSize: "13px",
                borderRadius: "8px 8px 0 0",
                background: active
                  ? "rgba(32, 32, 32, 0.7)"
                  : "transparent",
                marginTop: "auto",
              }}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onCloseTab(tab.id);
              }}
              onMouseEnter={(e) => {
                if (!active)
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                if (!active)
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
              }}
            >
              <span className="truncate flex-1">{tab.label}</span>
              {tabs.length > 1 && (
                <button
                  className="flex items-center justify-center rounded-[3px] hover:bg-white/10"
                  style={{
                    width: "24px",
                    height: "24px",
                    marginLeft: "8px",
                    opacity: active ? 0.6 : 0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.opacity = active
                      ? "0.6"
                      : "0";
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={11} strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}

        {/* New tab button */}
        <button
          className="flex items-center justify-center text-win-text-disabled hover:bg-white/[0.06]"
          style={{
            width: "36px",
            height: "36px",
            marginTop: "auto",
            marginBottom: "1px",
            borderRadius: "6px",
          }}
          onClick={onNewTab}
          title="New tab (Ctrl+T)"
        >
          <Plus size={16} strokeWidth={1.5} />
        </button>

        {/* Drag region fills the rest */}
        <div data-tauri-drag-region className="flex-1 h-full" />
      </div>

      {/* Window controls — aligned to top of window */}
      <div className="flex items-start h-full">
        <WindowButton onClick={handleMinimize} label="Minimize">
          <Minus size={10} strokeWidth={1.5} />
        </WindowButton>
        <WindowButton
          onClick={handleMaximize}
          label={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            <Copy size={10} strokeWidth={1.5} className="scale-x-[-1]" />
          ) : (
            <Square size={10} strokeWidth={1.5} />
          )}
        </WindowButton>
        <WindowButton onClick={handleClose} label="Close" isClose>
          <X size={12} strokeWidth={1.5} />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  children,
  onClick,
  label,
  isClose = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  isClose?: boolean;
}) {
  return (
    <button
      className={`flex items-center justify-center text-white/80 ${
        isClose
          ? "hover:bg-[#c42b1c] hover:text-white"
          : "hover:bg-white/10"
      }`}
      style={{ width: "46px", height: "40px" }}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}
