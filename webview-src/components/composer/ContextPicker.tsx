import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SuggestionItem, TriggerType, FileCandidate } from "../../types";
import { Icon } from "../../lib/icons";
import { StatusIcon } from "../primitives/StatusIcon";

// Re-export for backward compatibility
export type { FileCandidate };

// ── Trigger config ─────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, string> = {
  "/": "Commands",
  "#": "Files & Context",
  "@": "Sessions",
};

const SUB_TRIGGER_LABELS: Record<string, string> = {
  file: "Files",
  symbol: "Symbols",
  switch: "Switch to session",
};

// ── Public API ──────────────────────────────────────────────────────

export interface ContextPickerProps {
  trigger: TriggerType;
  subTrigger?: "symbol" | "file" | "switch";
  query: string;
  onSelect: (item: SuggestionItem) => void;
  onClose: () => void;
  fetchItems: (
    trigger: TriggerType,
    query: string,
    subTrigger?: "symbol" | "file" | "switch"
  ) => Promise<SuggestionItem[]>;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  /**
   * Register a keydown handler that the textarea will forward to.
   * Composer calls this so ArrowUp/Down/Enter/Escape land here.
   */
  registerKeyHandler: (
    handler: ((e: React.KeyboardEvent<HTMLTextAreaElement>) => void) | null
  ) => void;
}

// ── Component ───────────────────────────────────────────────────────

export function ContextPicker({
  trigger,
  subTrigger,
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
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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

  // ── Fetch items (debounced) ─────────────────────────────────────

  // Keep latest fetchItems in a ref so the effect deps stay stable
  const fetchItemsRef = useRef(fetchItems);
  fetchItemsRef.current = fetchItems;

  useEffect(() => {
    // Empty query on file/symbol triggers → skip debounce, fetch immediately
    const delay = query.length === 0 && subTrigger !== undefined ? 0 : 150;
    const timer = setTimeout(() => {
      fetchItemsRef.current(trigger, query, subTrigger).then((results) => {
        setItems(results);
        onSelectedIndexChange(0);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [trigger, query, subTrigger, onSelectedIndexChange]);

  // ── Scroll selected item into view ───────────────────────────────

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const placeholder =
    trigger === "/"
      ? "No commands found"
      : trigger === "@"
        ? "No sessions found"
        : subTrigger === "symbol"
          ? "No symbols found"
          : subTrigger === "switch"
            ? "No sessions found"
            : "No files found";

  // Check if we need a separator between main items and action items
  const firstActionIdx = items.findIndex((it) => it.kind === "action");
  const hasSeparator = firstActionIdx > 0;

  return (
    <div className="context-picker">
      <div className="context-picker-list" ref={listRef}>
        {items.length === 0 && (
          <div className="context-picker-empty">{placeholder}</div>
        )}
        {items.map((item, i) => (
          <React.Fragment key={item.id}>
            {hasSeparator && i === firstActionIdx && (
              <div className="context-picker-separator" />
            )}
            <div
              className={`context-picker-item ${i === selectedIndex ? "selected" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item)}
              onMouseEnter={() => onSelectedIndexChange(i)}
            >
              {item.kind === "session" && item.status ? (
                <StatusIcon status={item.status} />
              ) : (
                item.icon && (
                  <Icon
                    name={item.icon}
                    className="context-picker-icon"
                    size="sm"
                  />
                )
              )}
              <span className="context-picker-label">{item.label}</span>
              {item.detail && (
                <span className="context-picker-detail">{item.detail}</span>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
