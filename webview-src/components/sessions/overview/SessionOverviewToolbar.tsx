import React, { useState, useRef, useEffect } from "react";
import type { SessionOverviewFilter } from "../../../types";
import { FILTERABLE_STATUSES } from "../../../types";

interface Props {
  filter: SessionOverviewFilter;
  sessionCount: number;
  onFilterChange: (filter: SessionOverviewFilter) => void;
  onNewSession?: () => void;
}

const FILTER_LABELS: Record<SessionOverviewFilter, string> = {
  all: "All",
  running: "Running",
  completed: "Completed",
  error: "Error",
  cancelled: "Cancelled",
};

const STATUS_DOT_COLORS: Record<string, string> = {
  running: "#4fc3f7",
  completed: "var(--success)",
  error: "var(--error)",
  cancelled: "var(--fg-muted)",
};

export function SessionOverviewToolbar({
  filter,
  sessionCount,
  onFilterChange,
  onNewSession,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Toggle: pressing the same filter again returns to "all"
  const handleSelect = (f: SessionOverviewFilter) => {
    onFilterChange(filter === f ? "all" : f);
    setOpen(false);
  };

  const isActive = filter !== "all";

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border shrink-0 min-h-[32px]">
      <span className="flex-1 truncate text-[11px] font-semibold text-fg-secondary whitespace-nowrap overflow-hidden text-ellipsis">
        Sessions
      </span>
      <span className="text-[10px] text-fg-muted bg-bg-input px-1.25 py-px rounded-[8px] shrink-0 font-[var(--font-mono)]">
        {sessionCount}
      </span>

      <div className="flex items-center gap-1 ml-auto">
        <div className="relative" ref={ref}>
          <button
            className={`inline-flex items-center gap-[3px] text-[10px] px-1.25 py-px border rounded-[3px] bg-transparent cursor-pointer transition-colors duration-150 ${
              isActive
                ? "border-accent text-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                : "border-transparent text-fg-muted hover:bg-accent-hover hover:text-fg-secondary"
            }`}
            onClick={() => setOpen(!open)}
            aria-haspopup="listbox"
            aria-expanded={open}
            title="Filter sessions by status"
          >
            {isActive ? FILTER_LABELS[filter] : "Filter"}
            <span
              className={`text-[8px] transition-transform duration-150 ${
                open ? "rotate-180" : ""
              }`}
            >
              ▾
            </span>
          </button>

          {open && (
            <div
              className="absolute top-full right-0 mt-[3px] min-w-[130px] bg-bg-secondary border border-border rounded shadow-[0_4px_16px_rgba(0,0,0,0.35)] z-50"
              role="listbox"
              aria-label="Session status filter"
            >
              <button
                className={`flex items-center gap-[5px] w-full px-2.5 py-1 border-none bg-transparent text-fg-primary text-xs cursor-pointer hover:bg-accent-hover ${
                  filter === "all" ? "bg-accent-hover" : ""
                }`}
                role="option"
                aria-selected={filter === "all"}
                onClick={() => onFilterChange("all")}
              >
                <span className="shrink-0 w-3 text-[10px] text-center text-accent">
                  {filter === "all" ? "✓" : ""}
                </span>
                {FILTER_LABELS.all}
              </button>
              <div className="h-px mx-1.5 my-[2px] bg-border" />
              {FILTERABLE_STATUSES.map((s) => (
                <button
                  key={s}
                  className={`flex items-center gap-[5px] w-full px-2.5 py-1 border-none bg-transparent text-fg-primary text-xs cursor-pointer hover:bg-accent-hover ${
                    filter === s ? "bg-accent-hover" : ""
                  }`}
                  role="option"
                  aria-selected={filter === s}
                  onClick={() => handleSelect(s)}
                >
                  <span
                    className="shrink-0 w-[6px] h-[6px] rounded-full"
                    style={{
                      backgroundColor:
                        STATUS_DOT_COLORS[s] ?? "var(--fg-muted)",
                    }}
                  />
                  <span className="shrink-0 w-3 text-[10px] text-center text-accent">
                    {filter === s ? "✓" : ""}
                  </span>
                  {FILTER_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </div>

        {onNewSession && (
          <button
            className="shrink-0 flex items-center justify-center w-7 h-full min-h-[28px] border border-border rounded bg-bg-input text-fg-secondary text-base cursor-pointer transition-colors duration-150 hover:bg-accent-hover hover:text-fg-primary"
            onClick={onNewSession}
            title="New session"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
