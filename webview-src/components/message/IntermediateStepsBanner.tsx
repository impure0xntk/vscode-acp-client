import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { Icon } from "../../lib/icons";
import { DisplayItemView } from "./DisplayItemView";
import { StepView } from "./StepView";
import type { IntermediateStep, PipelineItem } from "../../pipeline";

const COLLAPSE_ANIMATION_DURATION = 150;

// ── Props ──────────────────────────────────────────────────────────────────

export interface IntermediateStepsBannerProps {
  steps: IntermediateStep[];
  defaultCollapsed?: boolean;
  sessionId?: string;
  agentId?: string;
  autoCollapse?: boolean;
  forceExpanded?: boolean;
  onToggle?: () => void;
  onExpandSettled?: () => void;
  onAttachDiff?: (attachment: import("../../types").ContextAttachment) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function totalDurationMs(steps: IntermediateStep[]): number {
  let minTs: number | undefined;
  let maxTs: number | undefined;
  for (const step of steps) {
    const items = step.agentMessage
      ? [step.agentMessage, ...step.toolCalls]
      : step.toolCalls;
    for (const item of items) {
      const ts = item.timestamp;
      if (ts != null) {
        if (minTs == null || ts < minTs) minTs = ts;
        if (maxTs == null || ts > maxTs) maxTs = ts;
      }
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

function stepLabel(step: IntermediateStep): string {
  if (step.isPreAgent && step.agentMessage == null) {
    return "Tool call";
  }
  if (step.agentMessage?.thinking) {
    return "Thinking";
  }
  if (step.toolCalls.length > 0) {
    return "Tool call";
  }
  return "Step";
}

function buildSummary(steps: IntermediateStep[]): string {
  const counts: Record<string, number> = {};
  for (const step of steps) {
    const label = stepLabel(step);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => `${count > 1 ? `${count}× ` : ""}${label}`)
    .join(", ");
}

// ── Component ──────────────────────────────────────────────────────────────

export function IntermediateStepsBanner({
  steps,
  defaultCollapsed = true,
  sessionId,
  agentId,
  autoCollapse = false,
  forceExpanded = false,
  onToggle,
  onExpandSettled,
  onAttachDiff,
}: IntermediateStepsBannerProps): React.ReactElement | null {
  const [isCollapsed, setIsCollapsed] = useState(
    autoCollapse ? true : forceExpanded ? false : defaultCollapsed
  );
  const [animatingCollapsed, setAnimatingCollapsed] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevForceExpanded = useRef(forceExpanded);
  useEffect(() => {
    if (forceExpanded && !prevForceExpanded.current) {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      setAnimatingCollapsed(false);
      setIsCollapsed(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => onExpandSettled?.());
      });
    } else if (!forceExpanded && prevForceExpanded.current) {
      setAnimatingCollapsed(true);
      setIsCollapsed(true);
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = setTimeout(() => {
        setAnimatingCollapsed(false);
        collapseTimerRef.current = null;
      }, COLLAPSE_ANIMATION_DURATION);
    } else {
      setIsCollapsed(!forceExpanded);
    }
    prevForceExpanded.current = forceExpanded;
  }, [forceExpanded, onExpandSettled]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  const toggle = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  if (steps.length === 0) return null;

  const duration = formatDuration(totalDurationMs(steps));
  const summary = buildSummary(steps);
  const showContent = !isCollapsed || animatingCollapsed;

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
            ? `Show ${steps.length} intermediate step${steps.length > 1 ? "s" : ""}`
            : "Hide intermediate steps"}
        </span>
        {isCollapsed && (
          <span className="flex-shrink-0 text-[10px] font-mono text-fg-muted opacity-70 ml-1">
            {summary} · {duration}
          </span>
        )}
      </button>
      {showContent && (
        <div
          className={`px-1 pb-1 pt-0.5 flex flex-col gap-[1px] opacity-70${animatingCollapsed ? " animate-intermediate-steps-collapse" : " animate-intermediate-steps-expand"}`}
        >
          {steps.map((step, idx) => (
            <StepView
              key={`step-${idx}`}
              step={step}
              sessionId={sessionId}
              agentId={agentId}
              onAttachDiff={onAttachDiff}
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


