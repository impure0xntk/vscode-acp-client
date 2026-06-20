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

// ── Context chip helper ────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function PickerContextBar({ item }: { item: SuggestionItem }): React.ReactElement | null {
  const { tokenUsage, contextWindowMax } = item;
  if (!tokenUsage) return null;

  const pct =
    contextWindowMax && contextWindowMax > 0
      ? Math.round((tokenUsage.totalTokens / contextWindowMax) * 100)
      : null;

  const color =
    pct !== null
      ? pct >= 90
        ? "ctx-critical"
        : pct >= 70
          ? "ctx-warning"
          : "ctx-normal"
      : "ctx-normal";

  const fillHeight = pct !== null ? Math.max(10, Math.min(100, pct)) : 0;
  const title = pct !== null
    ? `${pct}% (${formatTokens(tokenUsage.totalTokens)} / ${formatTokens(contextWindowMax ?? 0)})`
    : `${formatTokens(tokenUsage.totalTokens)} tokens used`;

  return (
    <span
      className={`inline-flex flex-col-reverse w-[3px] h-[14px] rounded-[1.5px] overflow-hidden shrink-0 ml-1`}
      style={{ background: `color-mix(in srgb, var(--fg-muted) 15%, transparent)` }}
      title={title}
    >
      <span
        className="w-full rounded-[1.5px] transition-[height] duration-300"
        style={{ height: `${fillHeight}%` }}
      />
    </span>
  );
}

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
  team: "Teams",
};

// ── Public API ──────────────────────────────────────────────────────

export interface ContextPickerProps {
  trigger: TriggerType;
  subTrigger?: "symbol" | "file" | "switch" | "team";
  query: string;
  onSelect: (item: SuggestionItem) => void;
  onClose: () => void;
  fetchItems: (
    trigger: TriggerType,
    query: string,
    subTrigger?: "symbol" | "file" | "switch" | "team"
  ) => Promise<SuggestionItem[]>;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  /**
   * Register a keydown handler that the textarea will forward to.
   * Composer calls this so ArrowUp/Down/Enter/Escape land here.
   */
  registerKeyHandler: (
    handler: ((e: ReactKeyboardEvent<HTMLTextAreaElement>) => void) | null
  ) => void;
  /** Called when items are fetched; used to asynchronously enrich session previews */
  onItemsFetched?: (items: SuggestionItem[], setItems: (items: SuggestionItem[]) => void) => void;
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
  onItemsFetched,
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

  // Keep latest callbacks in refs so the effect deps stay stable
  const fetchItemsRef = useRef(fetchItems);
  fetchItemsRef.current = fetchItems;
  const onItemsFetchedRef = useRef(onItemsFetched);
  onItemsFetchedRef.current = onItemsFetched;

  useEffect(() => {
    // Empty query on file/symbol/switch triggers → skip debounce, fetch immediately
    const delay =
      query.length === 0 && (subTrigger !== undefined || trigger === "@")
        ? 0
        : 150;
    const timer = setTimeout(() => {
      fetchItemsRef.current(trigger, query, subTrigger).then((results) => {
        setItems(results);
        onSelectedIndexChange(0);
        onItemsFetchedRef.current?.(results, setItems);
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
        ? subTrigger === "team"
          ? "No teams found"
          : "No sessions found"
        : subTrigger === "symbol"
          ? "No symbols found"
          : subTrigger === "switch"
            ? "No sessions found"
            : subTrigger === "team"
              ? "No teams found"
              : "No files found";

  // Check if we need a separator between main items and action items
  const firstActionIdx = items.findIndex((it) => it.kind === "action");
  const hasSeparator = firstActionIdx > 0;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.35)] overflow-hidden mb-1 max-h-[220px] flex flex-col">
      <div className="overflow-y-auto flex-1 min-h-0" ref={listRef}>
        {items.length === 0 && (
          <div className="p-3 text-center text-[var(--fg-muted)] text-xs">
            {placeholder}
          </div>
        )}
        {items.map((item, i) => (
          <React.Fragment key={item.id}>
            {hasSeparator && i === firstActionIdx && (
              <div className="h-px mx-2 my-1 bg-[var(--border)]" />
            )}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-[5px] cursor-pointer text-xs transition-colors duration-100 min-w-0 ${
                i === selectedIndex
                  ? "bg-[var(--accent-hover)]"
                  : "hover:bg-[var(--accent-hover)]"
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item)}
              onMouseEnter={() => onSelectedIndexChange(i)}
            >
              {item.icon && item.kind !== "session" ? (
                <Icon
                  name={item.icon}
                  className="shrink-0 text-[13px] w-[18px] text-center"
                  size="sm"
                />
              ) : null}
              {item.kind === "session" && item.status ? (
                <StatusIcon status={item.status} />
              ) : null}
              {item.kind === "session" ? (
                <PickerContextBar item={item} />
              ) : null}
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--fg-primary)]">
                {item.label}
              </span>
              {item.detail && (
                <span className="shrink-0 text-[10px] text-[var(--fg-muted)] max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.detail}
                </span>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
