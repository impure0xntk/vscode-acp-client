import React, { useState, useCallback, useEffect, useRef } from "react";
import { Icon } from "../../lib/icons";
import { DisplayItemView } from "./DisplayItemView";
import { StepView } from "./StepView";
import type { IntermediateStep, PipelineItem } from "../../pipeline";
import type { FileEditEntry } from "../../pipeline/types";
import { useFileEditSummaryMap } from "../../hooks/useFileEditSummaryMap";

const COLLAPSE_ANIMATION_DURATION = 150;

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
  /**
   * External file edit summary map (from useFileEditSummaryMap).
   * When provided, StepView reads summaries from this map by step index
   * instead of step.fileEditSummary.
   */
  fileEditSummaryMap?: Map<number, FileEditEntry[]>;
}

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

export function stepLabel(step: IntermediateStep): string {
  // A thinking-only message (role="agent", thinking set, no text content)
  // is folded into the banner as a "Thinking" step, just like any other
  // intermediate step.  It may arrive as a pre-agent step (agentMessage=null)
  // with the thinking item carried in toolCalls.
  const hasThinking =
    step.agentMessage?.thinking != null ||
    step.toolCalls.some((tc) => tc.thinking != null);
  if (hasThinking) {
    return "Thinking";
  }
  if (step.isPreAgent && step.agentMessage == null) {
    return "Tool call";
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

export function IntermediateStepsBanner({
  steps,
  defaultCollapsed = true,
  sessionId,
  agentId,
  autoCollapse = false,
  forceExpanded,
  onToggle,
  onExpandSettled,
  onAttachDiff,
  fileEditSummaryMap,
}: IntermediateStepsBannerProps): React.ReactElement | null {
  // Determine initial collapsed state: forceExpanded (parent control) takes
  // priority over autoCollapse. When forceExpanded is explicitly passed
  // (including false), it overrides autoCollapse/defaultCollapsed.
  const initialCollapsed =
    forceExpanded !== undefined
      ? !forceExpanded
      : autoCollapse
        ? true
        : defaultCollapsed;

  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [animatingCollapsed, setAnimatingCollapsed] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether the user has manually toggled this banner.
  // Once the user interacts, suppress auto-expand on new steps.
  // Reset when forceExpanded becomes true due to PARENT-initiated change.
  const userToggledRef = useRef(false);
  const userInitiatedToggleRef = useRef(false);
  // Tracks whether the parent (store) explicitly collapsed this banner.
  // The default collapsed state (forceExpanded === false) is NOT an explicit
  // collapse — it just means "not expanded".  Only a parent-driven collapse
  // (e.g. the turn-completion fold) sets this, so auto-expand below can reveal
  // newly streamed steps during a turn without fighting a user's intent.
  const parentCollapsedRef = useRef(false);

  // Auto-expand when new steps appear so that a step promoted from
  // currentStep → olderSteps isn't silently hidden inside a collapsed
  // banner.  Skip if the user has manually collapsed, or if the parent has
  // explicitly collapsed this banner (e.g. on turn completion).
  const prevStepCount = useRef(steps.length);
  useEffect(() => {
    if (steps.length > prevStepCount.current) {
      prevStepCount.current = steps.length;
      if (
        isCollapsed &&
        !userToggledRef.current &&
        !parentCollapsedRef.current
      ) {
        setAnimatingCollapsed(false);
        setIsCollapsed(false);
        onExpandSettled?.();
      }
      return;
    }
    prevStepCount.current = steps.length;
  }, [steps.length, isCollapsed, onExpandSettled]);

  const toggle = useCallback(() => {
    userToggledRef.current = true;
    userInitiatedToggleRef.current = true;
    onToggle?.();
  }, [onToggle]);

  // Sync internal state with forceExpanded (parent control).
  // Only reset userToggledRef when the change is NOT user-initiated.
  const prevForceExpanded = useRef(forceExpanded);
  useEffect(() => {
    const isUserInitiated = userInitiatedToggleRef.current;
    userInitiatedToggleRef.current = false; // consume the flag

    if (forceExpanded && !prevForceExpanded.current) {
      // Parent forces expand
      if (!isUserInitiated) {
        userToggledRef.current = false;
      }
      // An explicit parent expand clears any prior explicit-collapse intent.
      parentCollapsedRef.current = false;
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
      // Parent forces collapse — remember this so auto-expand respects it.
      parentCollapsedRef.current = true;
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
          {steps.map((step, idx) => {
            // Use external fileEditSummaryMap if provided (only when step.fileEditSummary is missing)
            const externalSummary = fileEditSummaryMap?.get(idx);
            const stepWithSummary =
              externalSummary && !step.fileEditSummary
                ? { ...step, fileEditSummary: externalSummary }
                : step;
            // Collapse the file edits on every step except the last one,
            // so the banner's older steps stay compact by default.
            const isLastStep = idx === steps.length - 1;
            return (
              <StepView
                key={`step-${idx}`}
                step={stepWithSummary}
                sessionId={sessionId}
                agentId={agentId}
                suppressHeader
                startFileEditCollapsed={!isLastStep}
                onAttachDiff={onAttachDiff}
              />
            );
          })}
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
