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

function totalDurationMs(items: PipelineItem[]): number {
  let minTs: number | undefined;
  let maxTs: number | undefined;
  for (const item of items) {
    const ts = item.timestamp;
    if (ts != null) {
      if (minTs == null || ts < minTs) minTs = ts;
      if (maxTs == null || ts > maxTs) maxTs = ts;
    }
  }
  if (minTs != null && maxTs != null) return maxTs - minTs;
  return 0;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
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

  const duration = formatDuration(totalDurationMs(items));

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
          <span className="intermediate-steps-duration">{duration}</span>
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
              isNew={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}
