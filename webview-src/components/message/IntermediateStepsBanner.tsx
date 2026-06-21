import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
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
  /**
   * Called after the expand/collapse animation / DOM mutation settles and
   * the final layout is stable.  The parent uses this to recompute scroll
   * state (isAtBottom / readUpTo) so the scroll-to-bottom button and
   * unread badge stay correct.
   */
  onExpandSettled?: () => void;
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
  onExpandSettled,
}: IntermediateStepsBannerProps): React.ReactElement | null {
  // autoCollapse: start collapsed immediately — no flash of expanded content
  const [isCollapsed, setIsCollapsed] = useState(
    autoCollapse ? true : forceExpanded ? false : defaultCollapsed
  );

  // Sync with forceExpanded from the store — overrides local state when
  // the parent decides the group should be expanded/collapsed.
  // Always respect forceExpanded regardless of autoCollapse, so that
  // user-initiated toggle (via store) works even after turn completion.
  const prevForceExpanded = useRef(forceExpanded);
  useEffect(() => {
    setIsCollapsed(!forceExpanded);
    // When the group transitions from collapsed→expanded, notify parent
    // after the DOM has settled so it can recompute scroll state.
    if (forceExpanded && !prevForceExpanded.current) {
      // Double rAF: let the browser paint the expanded content first
      requestAnimationFrame(() => {
        requestAnimationFrame(() => onExpandSettled?.());
      });
    }
    prevForceExpanded.current = forceExpanded;
  }, [forceExpanded, onExpandSettled]);

  const toggle = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  if (items.length === 0) return null;

  const duration = formatDuration(totalDurationMs(items));

  return (
    <div
      className="my-[2px] rounded overflow-hidden bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)]"
      role="region"
      aria-label="Intermediate steps"
    >
      <button
        className="flex items-center gap-1.5 w-full px-[2px] py-0.5 border-none bg-transparent text-fg-muted text-[11px] font-[var(--font-ui)] cursor-pointer text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)] hover:text-fg-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]"
        onClick={toggle}
        aria-expanded={!isCollapsed}
        type="button"
      >
        <span
          className={`inline-block text-[9px] transition-transform duration-150 flex-shrink-0 opacity-60${isCollapsed ? "" : " rotate-90"}`}
        >
          ▶
        </span>
        <Icon
          name="history"
          size="sm"
          className="inline-flex items-center flex-shrink-0 opacity-70"
        />
        <span className="font-medium whitespace-nowrap">
          {isCollapsed
            ? `Show ${items.length} intermediate step${items.length > 1 ? "s" : ""}`
            : "Hide intermediate steps"}
        </span>
        {isCollapsed && (
          <span className="flex-shrink-0 text-[10px] font-mono text-fg-muted opacity-70 ml-1">
            {duration}
          </span>
        )}
      </button>
      {!isCollapsed && (
        <div className="px-1 pb-1 pt-0.5 flex flex-col gap-[1px] animate-intermediate-steps-expand opacity-70">
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
          <button
            className="flex items-center gap-1.5 w-full px-[2px] py-0.5 border-none bg-transparent text-fg-muted text-[11px] font-[var(--font-ui)] cursor-pointer text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent-hover)_50%,transparent)] hover:text-fg-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-[-1px]"
            onClick={toggle}
            aria-expanded={false}
            type="button"
          >
            <span className="inline-block text-[9px] flex-shrink-0 opacity-60 -rotate-90">
              ▶
            </span>
            <span className="font-medium whitespace-nowrap">
              Hide intermediate steps
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
