import {
  Home,
  HardDrive,
  Download,
  FileText,
  Image,
  Music,
  Film,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getDrives, getKnownFolders, type DriveInfo } from "../api";
import { ListItem } from "./ListItem";

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  width: number;
}

interface PinnedItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export function Sidebar({ currentPath, onNavigate, width }: SidebarProps) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [pinned, setPinned] = useState<PinnedItem[]>([]);

  useEffect(() => {
    getDrives().then(setDrives).catch(console.error);
    getKnownFolders().then((folders) => {
      const items: PinnedItem[] = [];
      if (folders.Home) items.push({ label: "Home", path: folders.Home, icon: Home });
      if (folders.Desktop) items.push({ label: "Desktop", path: folders.Desktop, icon: Monitor });
      if (folders.Documents) items.push({ label: "Documents", path: folders.Documents, icon: FileText });
      if (folders.Downloads) items.push({ label: "Downloads", path: folders.Downloads, icon: Download });
      if (folders.Pictures) items.push({ label: "Pictures", path: folders.Pictures, icon: Image });
      if (folders.Music) items.push({ label: "Music", path: folders.Music, icon: Music });
      if (folders.Videos) items.push({ label: "Videos", path: folders.Videos, icon: Film });
      setPinned(items);
    });
  }, []);

  return (
    <div
      className="shrink-0 bg-win-surface border-r border-win-border overflow-y-auto scroll-container"
      style={{ width: `${width}px`, padding: "12px" }}
    >
      <SidebarSection title="Quick access">
        {pinned.map((item) => (
          <SidebarItem
            key={item.path}
            label={item.label}
            icon={item.icon}
            active={currentPath === item.path}
            onClick={() => onNavigate(item.path)}
          />
        ))}
      </SidebarSection>

      <div style={{ margin: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.07)" }} />

      <SidebarSection title="Drives">
        {drives.map((drive) => (
          <SidebarItem
            key={drive.mount_point}
            label={drive.label}
            icon={HardDrive}
            active={currentPath.startsWith(
              drive.mount_point.replace(/\\/g, "/"),
            )}
            onClick={() => onNavigate(drive.mount_point.replace(/\\/g, "/"))}
          />
        ))}
      </SidebarSection>
    </div>
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="text-[12px] font-semibold text-win-text-secondary"
        style={{ padding: "8px 14px 4px" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SidebarItem({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <ListItem active={active} onClick={onClick}>
      <Icon
        size={20}
        className={active ? "text-win-accent" : "text-win-text-secondary"}
        strokeWidth={1.5}
      />
      <span className="truncate text-win-text">{label}</span>
    </ListItem>
  );
}
