import React, { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "../../lib/icons";

// ── Types ──────────────────────────────────────────────────────────

export type MeshMode = "fanout" | "supervisor" | "pipeline" | "status" | "task";

interface MeshModeCommand {
  mode: MeshMode;
  label: string;
  description: string;
  icon: string;
}

const MESH_MODES: MeshModeCommand[] = [
  {
    mode: "fanout",
    label: "Fanout",
    description: "Send to multiple agents",
    icon: "repo-forked",
  },
  {
    mode: "supervisor",
    label: "Supervisor",
    description: "Lead-worker pattern",
    icon: "brain",
  },
  {
    mode: "pipeline",
    label: "Pipeline",
    description: "Sequential chain",
    icon: "arrow-right-left",
  },
  {
    mode: "status",
    label: "Status",
    description: "Show mesh status",
    icon: "list-tree",
  },
  {
    mode: "task",
    label: "Task Board",
    description: "Show task board",
    icon: "output",
  },
];

// ── Props ──────────────────────────────────────────────────────────

export interface ModePickerProps {
  query: string;
  onSelect: (mode: MeshMode) => void;
  onClose: () => void;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  registerKeyHandler: (handler: ((e: KeyboardEvent) => void) | null) => void;
}

// ── Component ───────────────────────────────────────────────────────

/**
 * ModePicker — /mesh subcommand picker.
 *
 * Triggered when user types /mesh and shows available mesh commands.
 * After selecting a mode, the Composer text is updated to /mesh <mode>
 * and additional pickers (agent selection, etc.) may be shown.
 */
export function ModePicker({
  query,
  onSelect,
  onClose,
  selectedIndex,
  onSelectedIndexChange,
  registerKeyHandler,
}: ModePickerProps): React.ReactElement {
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? MESH_MODES.filter(
        (m) =>
          m.label.toLowerCase().includes(query.toLowerCase()) ||
          m.description.toLowerCase().includes(query.toLowerCase())
      )
    : MESH_MODES;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          onSelectedIndexChange(
            Math.min(selectedIndex + 1, filtered.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex].mode);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onSelectedIndexChange, onSelect, onClose]
  );

  useEffect(() => {
    registerKeyHandler(handleKeyDown);
    return () => registerKeyHandler(null);
  }, [handleKeyDown, registerKeyHandler]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.35)] overflow-hidden mb-1 max-h-[220px] flex flex-col">
      <div className="overflow-y-auto flex-1 min-h-0" ref={listRef}>
        {filtered.length === 0 && (
          <div className="p-3 text-center text-[var(--fg-muted)] text-xs">
            No matching mesh commands
          </div>
        )}
        {filtered.map((mode, i) => (
          <div
            key={mode.mode}
            className={`flex items-center gap-1.5 px-2.5 py-[5px] cursor-pointer text-xs transition-colors duration-100 min-w-0 ${
              i === selectedIndex
                ? "bg-[var(--accent-hover)]"
                : "hover:bg-[var(--accent-hover)]"
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(mode.mode)}
            onMouseEnter={() => onSelectedIndexChange(i)}
          >
            <Icon
              name={mode.icon}
              className="shrink-0 text-[13px] w-[18px] text-center"
              size="sm"
            />
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--fg-primary)]">
              {mode.label}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--fg-muted)] max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap">
              {mode.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
