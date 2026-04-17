import { useState } from "react";
import clsx from "clsx";
import { useAnimations } from "../hooks/useAnimations";

interface ListItemProps {
  children: React.ReactNode;
  active?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onAuxClick?: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
  animDelay?: number;
  dataAttrs?: Record<string, string>;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
}

export function ListItem({
  children,
  active = false,
  selected = false,
  onClick,
  onDoubleClick,
  onAuxClick,
  className,
  style,
  animDelay,
  dataAttrs,
  draggable,
  onDragStart,
  onDrop,
  onDragOver,
}: ListItemProps) {
  const animated = useAnimations();
  const [dragOverState, setDragOverState] = useState(false);
  const [hovered, setHovered] = useState(false);

  const bg = selected
    ? "rgba(255,255,255,0.1)"
    : active
      ? "rgba(255,255,255,0.08)"
      : dragOverState
        ? "rgba(255,255,255,0.12)"
        : hovered
          ? "rgba(255,255,255,0.05)"
          : undefined;

  return (
    <div
      className={clsx(
        "flex items-center cursor-default rounded-[4px]",
        animated && animDelay !== undefined && "anim-row-enter",
        className,
      )}
      style={{
        padding: "8px 14px",
        gap: "12px",
        fontSize: "13px",
        minHeight: "36px",
        background: bg,
        ...(animated && animDelay !== undefined
          ? { animationDelay: `${animDelay}ms` }
          : {}),
        ...(dragOverState ? { outline: "2px solid rgba(96,205,255,0.5)", outlineOffset: "-2px" } : {}),
        ...style,
      }}
      {...dataAttrs}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (onDragOver) {
          onDragOver(e);
          setDragOverState(true);
        }
      }}
      onDragLeave={() => setDragOverState(false)}
      onDrop={(e) => {
        setDragOverState(false);
        onDrop?.(e);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onAuxClick={onAuxClick}
    >
      {children}
    </div>
  );
}
