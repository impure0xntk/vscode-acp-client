import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizeHandleOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Persist width on change (debounced) */
  onResizeEnd?: (width: number) => void;
  /** Position of the panel relative to the handle. "right" = panel is to the right of the handle (default). "left" = panel is to the left. */
  position?: "left" | "right";
}

export function useResizeHandle({
  initialWidth,
  minWidth,
  maxWidth,
  onResizeEnd,
  position = "right",
}: UseResizeHandleOptions) {
  const [width, setWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsResizing(true);
    },
    [width]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging left (negative delta) → shrink, dragging right (positive delta) → grow
      // Panel is right-anchored: resize handle is on the LEFT edge of the panel
      // so dragging left means the handle moves further left → panel grows
      const deltaX = e.clientX - startXRef.current;
      const newWidth = Math.min(
        maxWidth,
        Math.max(minWidth, startWidthRef.current - deltaX)
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = setTimeout(() => {
        onResizeEnd?.(width);
      }, 200);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, minWidth, maxWidth, onResizeEnd, width]);

  return { width, isResizing, handleMouseDown };
}
