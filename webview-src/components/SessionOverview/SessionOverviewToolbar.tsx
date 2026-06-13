import React, { useState, useRef, useEffect } from "react";
import type { SessionOverviewFilter } from "../../types";
import { FILTERABLE_STATUSES } from "../../types";

interface Props {
  filter: SessionOverviewFilter;
  sessionCount: number;
  onFilterChange: (filter: SessionOverviewFilter) => void;
  onNewSession?: () => void;
  selectionMode: boolean;
  onExitSelectionMode: () => void;
}

const FILTER_LABELS: Record<SessionOverviewFilter, string> = {
  all: "All",
  running: "Running",
  completed: "Completed",
  error: "Error",
  cancelled: "Cancelled",
};

export function SessionOverviewToolbar({
  filter,
  sessionCount,
  onFilterChange,
  onNewSession,
  selectionMode,
  onExitSelectionMode,
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
    <div className="session-overview-toolbar">
      {selectionMode ? (
        <>
          <span className="session-overview-toolbar-title">Select</span>
          <div className="session-overview-toolbar-actions">
            <button
              className="session-overview-batch-close"
              onClick={onExitSelectionMode}
              title="Exit selection mode"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="session-overview-toolbar-title">Sessions</span>
          <span className="session-overview-toolbar-count">{sessionCount}</span>

          <div className="session-overview-toolbar-actions">
            <div className="session-overview-filter" ref={ref}>
              <button
                className={`session-overview-filter-trigger${isActive ? " active" : ""}`}
                onClick={() => setOpen(!open)}
                aria-haspopup="listbox"
                aria-expanded={open}
                title="Filter sessions by status"
              >
                <span className="session-overview-filter-label">
                  {isActive ? FILTER_LABELS[filter] : "Filter"}
                </span>
                <span className={`session-overview-filter-arrow${open ? " open" : ""}`}>
                  ▾
                </span>
              </button>

              {open && (
                <div
                  className="session-overview-filter-dropdown"
                  role="listbox"
                  aria-label="Session status filter"
                >
                  <button
                    className={`session-overview-filter-option${filter === "all" ? " selected" : ""}`}
                    role="option"
                    aria-selected={filter === "all"}
                    onClick={() => onFilterChange("all")}
                  >
                    <span className="session-overview-filter-check">
                      {filter === "all" ? "✓" : ""}
                    </span>
                    {FILTER_LABELS.all}
                  </button>
                  <div className="session-overview-filter-sep" />
                  {FILTERABLE_STATUSES.map((s) => (
                    <button
                      key={s}
                      className={`session-overview-filter-option filter-${s}${filter === s ? " selected" : ""}`}
                      role="option"
                      aria-selected={filter === s}
                      onClick={() => handleSelect(s)}
                    >
                      <span className={`session-overview-filter-dot dot-${s}`} />
                      <span className="session-overview-filter-check">
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
                className="session-new-btn"
                onClick={onNewSession}
                title="New session"
              >
                +
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
