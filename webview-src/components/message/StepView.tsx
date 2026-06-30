import React, { memo } from "react";
import { DisplayItemView } from "./DisplayItemView";
import { ToolBatchSummary } from "./ToolBatchSummary";
import { FileEditSummary } from "./FileEditSummary";
import type { IntermediateStep } from "../../pipeline";
import type { ChatDisplayItem, FileEditEntry } from "../../pipeline/types";

export interface StepViewProps {
  step: IntermediateStep;
  sessionId?: string;
  agentId?: string;
  /** When true, apply appear animation to tool batch */
  isNew?: boolean;
  /** Force header display on agent message */
  forceHeader?: boolean;
  /** Whether the agent message key is "new" (for animation) */
  isAgentNew?: boolean;
  /** Callback when user wants to attach a diff to the composer */
  onAttachDiff?: (attachment: import("../../types").ContextAttachment) => void;
  /**
   * External file edit summary entries (from useFileEditSummaryMap).
   * When provided, rendered instead of step.fileEditSummary.
   */
  externalFileEditEntries?: FileEditEntry[];
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
  sessionId,
  agentId,
  isNew = true,
  forceHeader = false,
  isAgentNew = true,
  onAttachDiff,
  externalFileEditEntries,
}: StepViewProps): React.ReactElement {
  // Collect tool calls from step.toolCalls (tool items with role="tool")
  const allToolCalls = step.toolCalls.flatMap(
    (tc) => (tc as ChatDisplayItem).resolvedToolCalls ?? []
  );
  const hasToolCalls = allToolCalls.length > 0;
  const fileEditEntries = externalFileEditEntries ?? step.fileEditSummary ?? [];
  const hasFileEdits = fileEditEntries.length > 0;

  // Pre-agent step with only tool calls (no agent message) — show header
  if (!step.agentMessage && hasToolCalls) {
    const firstTs = step.toolCalls[0]?.timestamp;
    const timeStr = firstTs
      ? new Date(firstTs).toLocaleTimeString()
      : "";
    return (
      <div className="flex flex-col gap-[1px]">
        {forceHeader && (
          <div className="flex items-center gap-2 text-[11px] text-fg-muted mb-1 px-0.5">
            <span className="font-medium text-fg-secondary">Agent</span>
            <span className="text-[10px] opacity-50">{timeStr}</span>
          </div>
        )}
        <div className="ml-4 mr-1 mb-[2px]">
          <ToolBatchSummary calls={allToolCalls} isNew={isNew} />
        </div>
        {hasFileEdits && (
          <FileEditSummary entries={fileEditEntries} sessionId={sessionId} agentId={agentId} onAttachDiff={onAttachDiff} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[1px]">
      {step.agentMessage && (
        <DisplayItemView
          item={step.agentMessage}
          idx={0}
          items={[step.agentMessage]}
          sessionId={sessionId}
          agentId={agentId}
          isNew={isAgentNew}
          forceHeader={forceHeader}
        />
      )}
      {hasToolCalls && (
        <div className="ml-4 mr-1 mb-[2px]">
          <ToolBatchSummary calls={allToolCalls} isNew={isNew} />
        </div>
      )}
      {hasFileEdits && (
        <FileEditSummary entries={fileEditEntries} sessionId={sessionId} agentId={agentId} onAttachDiff={onAttachDiff} />
      )}
    </div>
  );
}

function areStepViewPropsEqual(
  prev: StepViewProps,
  next: StepViewProps,
): boolean {
  return (
    prev.step === next.step &&
    prev.sessionId === next.sessionId &&
    prev.agentId === next.agentId &&
    prev.isNew === next.isNew &&
    prev.forceHeader === next.forceHeader &&
    prev.isAgentNew === next.isAgentNew &&
    prev.onAttachDiff === next.onAttachDiff &&
    prev.externalFileEditEntries === next.externalFileEditEntries
  );
}

export const StepView = memo(StepViewInner, areStepViewPropsEqual);
