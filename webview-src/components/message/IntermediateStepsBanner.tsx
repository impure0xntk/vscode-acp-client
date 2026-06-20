import React, { useState, useCallback, useEffect, useRef } from "react";
import { Icon } from "../../lib/icons";
import { DisplayItemView } from "./DisplayItemView";
import type { PipelineItem } from "../../pipeline";

// ── Props ──────────────────────────────────────────────────────────────────

export interface IntermediateStepsBannerProps {
  items: PipelineItem[];
  defaultCollapsed?: boolean;
  sessionId?: string;
  agentId?: string;
  /**
   * When true, renders expanded on first mount then immediately collapses.
   * Creates a visual "auto-fold" effect for newly-completed intermediate steps.
   */
  autoCollapse?: boolean;
  /**
   * When true, forces the banner to show expanded state (content visible).
   * Used when the group is expanded via the store to keep the banner as a
   * persistent collapse toggle.
   */
  forceExpanded?: boolean;
  /** Called when the user toggles the banner. */
  onToggle?: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function itemLabel(item: PipelineItem): string {
  switch (item.type) {
    case "chat": {
      if (item.thinking) return "Thinking";
      if (item.resolvedToolCalls && item.resolvedToolCalls.length > 0) {
        const kinds = new Set(item.resolvedToolCalls.map((tc) => tc.kind));
        return `${kinds.size > 1 ? "Tool calls" : (kinds.values().next().value ?? "Tool")} ×${item.resolvedToolCalls.length}`;
      }
      return "Message";
    }
    case "compression":
      return "Context compressed";
    case "mode_change":
      return "Mode changed";
    case "error_notice":
      return "Error";
    case "custom":
      return "System";
  }
}

function buildSummary(items: PipelineItem[]): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const label = itemLabel(item);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => `${count > 1 ? `${count}× ` : ""}${label}`)
    .join(", ");
}

// ── Component ──────────────────────────────────────────────────────────────

export function IntermediateStepsBanner({
  items,
  defaultCollapsed = true,
  sessionId,
  agentId,
  autoCollapse = false,
  forceExpanded = false,
  onToggle,
}: IntermediateStepsBannerProps): React.ReactElement | null {
  // autoCollapse: start expanded (to render content), then collapse on next frame
  const [isCollapsed, setIsCollapsed] = useState(
    autoCollapse ? false : forceExpanded ? false : defaultCollapsed
  );
  const autoCollapseDoneRef = useRef(false);

  // Sync with forceExpanded from the store — overrides local state when
  // the parent decides the group should be expanded/collapsed.
  useEffect(() => {
    if (!autoCollapse) {
      setIsCollapsed(!forceExpanded);
    }
  }, [forceExpanded, autoCollapse]);

  useEffect(() => {
    if (autoCollapse && !autoCollapseDoneRef.current) {
      autoCollapseDoneRef.current = true;
      // Use rAF to ensure the expanded content is painted before collapsing
      requestAnimationFrame(() => {
        setIsCollapsed(true);
      });
    }
  }, [autoCollapse]);

  const toggle = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  if (items.length === 0) return null;

  const summary = buildSummary(items);

  return (
    <div
      className="intermediate-steps-banner"
      role="region"
      aria-label="Intermediate steps"
    >
      <button
        className="intermediate-steps-toggle"
        onClick={toggle}
        aria-expanded={!isCollapsed}
        type="button"
      >
        <span
          className={`intermediate-steps-chevron ${isCollapsed ? "" : "open"}`}
        >
          ▶
        </span>
        <Icon name="history" size="sm" className="intermediate-steps-icon" />
        <span className="intermediate-steps-label">
          {isCollapsed
            ? `Show ${items.length} intermediate step${items.length > 1 ? "s" : ""}`
            : "Hide intermediate steps"}
        </span>
        {isCollapsed && (
          <span className="intermediate-steps-summary">{summary}</span>
        )}
      </button>
      {!isCollapsed && (
        <div className="intermediate-steps-body">
          {items.map((item, idx) => (
            <DisplayItemView
              key={item.key}
              item={item}
              idx={idx}
              items={items}
              sessionId={sessionId}
              agentId={agentId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
