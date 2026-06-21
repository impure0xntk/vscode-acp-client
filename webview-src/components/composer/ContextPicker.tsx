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

function PickerContextBar({ item }: { item: SuggestionItem }): React.ReactElement | null {
  const { sessionColor } = item;

  if (!sessionColor) return null;

  return (
    <span
      className="inline-flex flex-col-reverse w-0.75 h-3.5 rounded-[1.5px] overflow-hidden shrink-0 ml-1"
      title="Session"
    >
      <span
        className="w-full rounded-[1.5px]"
        style={{ height: "100%", backgroundColor: sessionColor }}
      />
    </span>
  );
}

export type { FileCandidate };

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
  registerKeyHandler: (
    handler: ((e: ReactKeyboardEvent<HTMLTextAreaElement>) => void) | null
  ) => void;
  onItemsFetched?: (items: SuggestionItem[], setItems: (items: SuggestionItem[]) => void) => void;
}

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

  const fetchItemsRef = useRef(fetchItems);
  fetchItemsRef.current = fetchItems;
  const onItemsFetchedRef = useRef(onItemsFetched);
  onItemsFetchedRef.current = onItemsFetched;

  useEffect(() => {
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

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
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

  const firstActionIdx = items.findIndex((it) => it.kind === "action");
  const hasSeparator = firstActionIdx > 0;

  return (
    <div className="bg-bg-secondary border border-border rounded-md shadow-popup overflow-hidden mb-1 max-h-[220px] flex flex-col">
      <div className="overflow-y-auto flex-1 min-h-0" ref={listRef}>
        {items.length === 0 && (
          <div className="p-3 text-center text-fg-muted text-xs">
            {placeholder}
          </div>
        )}
        {items.map((item, i) => (
          <React.Fragment key={item.id}>
            {hasSeparator && i === firstActionIdx && (
              <div className="h-px mx-2 my-1 bg-border" />
            )}
            <div
              className={`flex items-center gap-1.5 px-[10px] py-[5px] cursor-pointer text-xs transition-colors duration-100 min-w-0 ${
                i === selectedIndex
                  ? "bg-accent-hover"
                  : "hover:bg-accent-hover"
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item)}
              onMouseEnter={() => onSelectedIndexChange(i)}
            >
              {item.kind === "session" ? (
                <PickerContextBar item={item} />
              ) : null}
              {item.icon && item.kind !== "session" ? (
                <Icon name={item.icon} className="shrink-0 text-[13px] w-[18px] text-center" size="sm" />
              ) : null}
              {item.kind === "session" && item.status ? (
                <StatusIcon status={item.status} />
              ) : null}
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg-primary">
                {item.label}
              </span>
              {item.detail && (
                <span className="shrink-0 text-[10px] text-fg-muted max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap">
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
