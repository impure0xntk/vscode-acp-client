import React, { memo } from "react";
import { DisplayItemView } from "./DisplayItemView";
import { ToolBatchSummary } from "./ToolBatchSummary";
import { FileEditSummary } from "./FileEditSummary";
import type { IntermediateStep } from "../../pipeline";
import type { ChatDisplayItem, FileEditEntry } from "../../pipeline/types";

export interface StepViewProps {
  step: IntermediateStep;
  /** True when this step is the latest/final step of the turn — thinking
   * blocks inside it expand by default (only the latest one). */
  isFinalStep?: boolean;
  sessionId?: string;
  agentId?: string;
  /** When true, apply appear animation to tool batch */
  isNew?: boolean;
  /** Force header display on agent message */
  forceHeader?: boolean;
  /**
   * Suppress the per-step message header (the "Agent hh:mm:ss" label).
   * Used by IntermediateStepsBanner, which folds many steps together and
   * does not want a header on every step — the banner toggle already groups
   * them, so the repeated labels are redundant noise.
   */
  suppressHeader?: boolean;
  /** Whether the agent message key is "new" (for animation) */
  isAgentNew?: boolean;
  /** Callback when user wants to attach a diff to the composer */
  onAttachDiff?: (attachment: import("../../types").ContextAttachment) => void;
  /**
   * External file edit summary entries (from useFileEditSummaryMap).
   * When provided, rendered instead of step.fileEditSummary.
   */
  externalFileEditEntries?: FileEditEntry[];
  /**
   * When true, FileEditSummary renders collapsed by default. Fed by
   * IntermediateStepsBanner so that every step except the last starts folded.
   */
  startFileEditCollapsed?: boolean;
}

/**
 * Renders a single IntermediateStep: optional agent message + aggregated tool batch.
 *
 * Shared by IntermediateStepsBanner (folded) and SessionChatContainer (latest step).
 * Differences handled via props:
 * - forceHeader: latest step shows header context
 * - isNew/isAgentNew: streaming animation
 */
function StepViewInner({
  step,
  isFinalStep = false,
  sessionId,
  agentId,
  isNew = true,
  forceHeader = false,
  suppressHeader = false,
  isAgentNew = true,
  onAttachDiff,
  externalFileEditEntries,
  startFileEditCollapsed = false,
}: StepViewProps): React.ReactElement {
  // Thinking items are carried as pre-agent step "tool calls" (role="agent",
  // thinking set, no resolvedToolCalls).  They render as normal agent
  // messages via DisplayItemView → Message → ThinkingBlock, so they appear
  // folded inside the IntermediateStepsBanner exactly like a real agent
  // message step.  This keeps a thinking block from being silently dropped.
  const thinkingItems = step.toolCalls.filter(
    (tc) => (tc as ChatDisplayItem).thinking != null
  );
  const hasThinking = thinkingItems.length > 0;

  // Real tool calls (exclude thinking items, which have no resolvedToolCalls)
  const allToolCalls = step.toolCalls
    .filter((tc) => (tc as ChatDisplayItem).thinking == null)
    .flatMap((tc) => (tc as ChatDisplayItem).resolvedToolCalls ?? []);
  const hasToolCalls = allToolCalls.length > 0;
  const fileEditEntries = externalFileEditEntries ?? step.fileEditSummary ?? [];
  const hasFileEdits = fileEditEntries.length > 0;

  // Render a single thinking item as a normal message block.  Force
  // isFirstOfTurn off (clone) so the Message component does not draw its own
  // header — the step header above already provides the Agent / time label.
  // When this is the final step, only the latest thinking block is
  // expanded by default; earlier ones stay collapsed.
  const renderThinking = (ti: ChatDisplayItem, idx: number) => {
    const isLast = idx === thinkingItems.length - 1;
    const thinking: ChatDisplayItem["thinking"] = ti.thinking
      ? { ...ti.thinking, defaultExpanded: isFinalStep && isLast }
      : ti.thinking;
    return (
      <DisplayItemView
        key={`${ti.key}-${isLast}`}
        item={{ ...ti, isFirstOfTurn: false, thinking }}
        idx={0}
        items={[ti]}
        sessionId={sessionId}
        agentId={agentId}
        isNew={isNew}
        forceHeader={false}
      />
    );
  };

  // Pre-agent step (no agent message) — header + thinking + tool calls
  if (!step.agentMessage) {
    if (!hasThinking && !hasToolCalls && !hasFileEdits) {
      return <div />;
    }
    const firstTs = step.toolCalls[0]?.timestamp;
    const timeStr = firstTs ? new Date(firstTs).toLocaleTimeString() : "";
    return (
      <div className="flex flex-col gap-[1px]">
        {!suppressHeader && forceHeader && (
          <div className="flex items-center gap-2 text-[11px] text-fg-muted mb-1 px-0.5">
            <span className="font-medium text-fg-secondary">Agent</span>
            <span className="text-[10px] opacity-50">{timeStr}</span>
          </div>
        )}
        {hasThinking &&
          thinkingItems.map((ti, idx) =>
            renderThinking(ti as ChatDisplayItem, idx)
          )}
        {hasToolCalls && (
          <div className="ml-4 mr-1 mb-[2px]">
            <ToolBatchSummary calls={allToolCalls} isNew={isNew} />
          </div>
        )}
        {hasFileEdits && (
          <FileEditSummary
            entries={fileEditEntries}
            sessionId={sessionId}
            agentId={agentId}
            onAttachDiff={onAttachDiff}
            startCollapsed={startFileEditCollapsed}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[1px]">
      {step.agentMessage && (
        <DisplayItemView
          item={
            suppressHeader
              ? { ...step.agentMessage, isFirstOfTurn: false }
              : step.agentMessage
          }
          idx={0}
          items={[step.agentMessage]}
          sessionId={sessionId}
          agentId={agentId}
          isNew={isAgentNew}
          forceHeader={suppressHeader ? false : forceHeader}
        />
      )}
      {hasThinking &&
        thinkingItems.map((ti, idx) =>
          renderThinking(ti as ChatDisplayItem, idx)
        )}
      {hasToolCalls && (
        <div className="ml-4 mr-1 mb-[2px]">
          <ToolBatchSummary calls={allToolCalls} isNew={isNew} />
        </div>
      )}
      {hasFileEdits && (
        <FileEditSummary
          entries={fileEditEntries}
          sessionId={sessionId}
          agentId={agentId}
          onAttachDiff={onAttachDiff}
          startCollapsed={startFileEditCollapsed}
        />
      )}
    </div>
  );
}

function areStepViewPropsEqual(
  prev: StepViewProps,
  next: StepViewProps
): boolean {
  return (
    prev.step === next.step &&
    prev.isFinalStep === next.isFinalStep &&
    prev.sessionId === next.sessionId &&
    prev.agentId === next.agentId &&
    prev.isNew === next.isNew &&
    prev.forceHeader === next.forceHeader &&
    prev.suppressHeader === next.suppressHeader &&
    prev.isAgentNew === next.isAgentNew &&
    prev.onAttachDiff === next.onAttachDiff &&
    prev.externalFileEditEntries === next.externalFileEditEntries &&
    prev.startFileEditCollapsed === next.startFileEditCollapsed
  );
}

export const StepView = memo(StepViewInner, areStepViewPropsEqual);
