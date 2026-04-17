import { useState, memo } from "react";
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

export const ListItem = memo(function ListItem({
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

  const bg = selected
    ? "rgba(255,255,255,0.1)"
    : active
      ? "rgba(255,255,255,0.08)"
      : dragOverState
        ? "rgba(255,255,255,0.12)"
        : undefined;

  return (
    <div
      className={clsx(
        "flex items-center cursor-default rounded-[4px] list-item-hover",
        animated && animDelay !== undefined && "anim-row-enter",
        className,
      )}
      style={{
        padding: "8px 14px",
        gap: "12px",
        fontSize: "13px",
        minHeight: "36px",
        background: bg,
        position: "relative",
        ...(animated && animDelay !== undefined
          ? { animationDelay: `${animDelay}ms` }
          : {}),
        ...(dragOverState ? { outline: "2px solid rgba(96,205,255,0.5)", outlineOffset: "-2px" } : {}),
        ...style,
      }}
      {...dataAttrs}
      data-selected={selected ? "true" : undefined}
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
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onAuxClick={onAuxClick}
    >
      {/* Selection accent bar */}
      {selected && (
        <div style={{
          position: "absolute",
          left: "2px",
          top: "25%",
          bottom: "25%",
          width: "3px",
          borderRadius: "2px",
          background: "#60cdff",
        }} />
      )}
      {children}
    </div>
  );
});
