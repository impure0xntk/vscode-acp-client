import React, { useState, useEffect, useCallback, useRef } from "react";
import type { SuggestionItem, TriggerType, FileCandidate } from "../types";

// Re-export for backward compatibility
export type { FileCandidate };

// ── Trigger config ─────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, string> = {
  "/": "Commands",
  "#": "Files & Context",
};

// ── Public API ──────────────────────────────────────────────────────

export interface ContextPickerProps {
  trigger: TriggerType;
  query: string;
  onSelect: (item: SuggestionItem) => void;
  onClose: () => void;
  fetchItems: (trigger: TriggerType, query: string) => Promise<SuggestionItem[]>;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  /**
   * Register a keydown handler that the textarea will forward to.
   * Composer calls this so ArrowUp/Down/Enter/Escape land here.
   */
  registerKeyHandler: (handler: ((e: KeyboardEvent) => void) | null) => void;
}

// ── Component ───────────────────────────────────────────────────────

export function ContextPicker({
  trigger,
  query,
  onSelect,
  onClose,
  fetchItems,
  selectedIndex,
  onSelectedIndexChange,
  registerKeyHandler,
}: ContextPickerProps): React.ReactElement {
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Register / unregister the keydown handler with Composer ───────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          onSelectedIndexChange(Math.min(selectedIndex + 1, items.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (items[selectedIndex]) onSelect(items[selectedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [items, selectedIndex, onSelect, onClose, onSelectedIndexChange]
  );

  useEffect(() => {
    registerKeyHandler(handleKeyDown);
    return () => registerKeyHandler(null);
  }, [handleKeyDown, registerKeyHandler]);

  // ── Fetch items ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    fetchItems(trigger, query).then((results) => {
      if (!cancelled) {
        setItems(results);
        onSelectedIndexChange(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trigger, query, fetchItems, onSelectedIndexChange]);

  // ── Scroll selected item into view ───────────────────────────────

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const placeholder =
    trigger === "/"
      ? "No commands found"
      : "No files found";

  return (
    <div className="context-picker">
      <div className="context-picker-list" ref={listRef}>
        {items.length === 0 && (
          <div className="context-picker-empty">{placeholder}</div>
        )}
        {items.map((item, i) => (
          <div
            key={item.id}
            className={`context-picker-item ${i === selectedIndex ? "selected" : ""}`}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onSelectedIndexChange(i)}
          >
            {item.icon && (
              <span className="context-picker-icon">{item.icon}</span>
            )}
            <span className="context-picker-label">{item.label}</span>
            {item.detail && (
              <span className="context-picker-detail">{item.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
