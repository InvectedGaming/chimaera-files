import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Search,
  Settings,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";

interface PathBarProps {
  currentPath: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onNavigate: (path: string) => void;
  onSearch: (query: string) => void;
  onOpenSettings: () => void;
}

export function PathBar({
  currentPath,
  canGoBack,
  canGoForward,
  canGoUp,
  onGoBack,
  onGoForward,
  onGoUp,
  onNavigate,
  onSearch,
  onOpenSettings,
}: PathBarProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const segments = currentPath.split("/").filter(Boolean);

  const startEditing = useCallback(() => {
    setEditValue(currentPath);
    setEditing(true);
    setTimeout(() => pathInputRef.current?.select(), 0);
  }, [currentPath]);

  const commitPath = useCallback(() => {
    setEditing(false);
    if (editValue.trim() && editValue !== currentPath) {
      onNavigate(editValue.trim());
    }
  }, [editValue, currentPath, onNavigate]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", height: "52px", padding: "4px 16px 8px", background: "rgba(24,24,24,0.92)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
      <NavButton onClick={onGoBack} disabled={!canGoBack} title="Back (Alt+Left)">
        <ArrowLeft size={18} strokeWidth={1.5} />
      </NavButton>
      <NavButton onClick={onGoForward} disabled={!canGoForward} title="Forward (Alt+Right)">
        <ArrowRight size={18} strokeWidth={1.5} />
      </NavButton>
      <NavButton onClick={onGoUp} disabled={!canGoUp} title="Up (Backspace)">
        <ArrowUp size={18} strokeWidth={1.5} />
      </NavButton>

      {/* Breadcrumb bar */}
      <div
        className={`flex-1 flex items-center min-w-0 rounded-[4px] bg-win-card border cursor-text ${
          editing ? "border-win-accent" : "border-win-border-subtle hover:border-white/10"
        }`}
        style={{ height: "36px", padding: "0 14px" }}
        onClick={() => !editing && startEditing()}
      >
        {editing ? (
          <input
            ref={pathInputRef}
            className="w-full bg-transparent outline-none text-win-text text-[13px]"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPath();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <div className="flex items-center gap-0 overflow-hidden text-[13px]">
            {segments.map((seg, i) => {
              const segPath = segments.slice(0, i + 1).join("/");
              const fullPath = segPath.length <= 2 ? segPath + "/" : segPath;
              return (
                <span key={i} className="flex items-center shrink-0">
                  {i > 0 && (
                    <ChevronRight size={12} style={{ margin: "0 2px", color: "rgba(255,255,255,0.36)" }} />
                  )}
                  <button
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      color: "#fff",
                      fontSize: "13px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(fullPath);
                    }}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Search */}
      <div
        className={`flex items-center h-9 w-60 px-3 rounded-[4px] bg-win-card border ${
          searchFocused ? "border-win-accent" : "border-win-border-subtle hover:border-white/10"
        }`}
      >
        <Search size={14} className="text-win-text-disabled shrink-0 mr-2" strokeWidth={1.5} />
        <input
          ref={searchInputRef}
          className="w-full bg-transparent outline-none text-win-text text-[13px] placeholder:text-win-text-disabled"
          placeholder="Search"
          value={searchValue}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searchValue.trim()) {
              onSearch(searchValue.trim());
            }
            if (e.key === "Escape") {
              setSearchValue("");
              searchInputRef.current?.blur();
            }
          }}
        />
      </div>

      {/* Settings */}
      <NavButton onClick={onOpenSettings} disabled={false} title="Settings">
        <Settings size={18} strokeWidth={1.5} />
      </NavButton>
    </div>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title: string;
}) {
  return (
    <button
      className="flex items-center justify-center w-9 h-9 rounded-[4px] hover:bg-win-hover active:bg-win-active disabled:opacity-30 disabled:hover:bg-transparent text-win-text-secondary"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
