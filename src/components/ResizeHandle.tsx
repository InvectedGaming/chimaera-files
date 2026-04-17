import { useCallback, useRef } from "react";

interface ResizeHandleProps {
  onResize: (delta: number) => void;
  direction?: "horizontal" | "vertical";
}

export function ResizeHandle({
  onResize,
  direction = "horizontal",
}: ResizeHandleProps) {
  const dragRef = useRef<{ startPos: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startPos = direction === "horizontal" ? e.clientX : e.clientY;
      dragRef.current = { startPos };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const pos = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = pos - dragRef.current.startPos;
        dragRef.current.startPos = pos;
        onResize(delta);
      };

      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onResize, direction],
  );

  const isHorizontal = direction === "horizontal";

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: isHorizontal ? "5px" : "100%",
        height: isHorizontal ? "100%" : "5px",
        cursor: isHorizontal ? "col-resize" : "row-resize",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        marginLeft: isHorizontal ? "-2px" : undefined,
        marginRight: isHorizontal ? "-3px" : undefined,
        marginTop: !isHorizontal ? "-2px" : undefined,
        marginBottom: !isHorizontal ? "-3px" : undefined,
      }}
    >
      {/* Visible indicator on hover */}
      <div
        style={{
          position: "absolute",
          [isHorizontal ? "left" : "top"]: "2px",
          [isHorizontal ? "width" : "height"]: "1px",
          [isHorizontal ? "top" : "left"]: "0",
          [isHorizontal ? "bottom" : "right"]: "0",
          borderRadius: "1px",
        }}
        className="hover:bg-win-accent/40 active:bg-win-accent"
      />
    </div>
  );
}
