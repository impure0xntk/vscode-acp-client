import React from "react";
import { DisplayItemView } from "./DisplayItemView";
import { ToolBatchSummary } from "./ToolBatchSummary";
import { FileEditSummary } from "./FileEditSummary";
import type { IntermediateStep } from "../../pipeline";
import type { ChatDisplayItem } from "../../pipeline/types";

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
}

/**
 * Renders a single IntermediateStep: optional agent message + aggregated tool batch.
 *
 * Shared by IntermediateStepsBanner (folded) and SessionChatContainer (latest step).
 * Differences handled via props:
 * - forceHeader: latest step shows header context
 * - isNew/isAgentNew: streaming animation
 */
export function StepView({
  step,
  sessionId,
  agentId,
  isNew = true,
  forceHeader = false,
  isAgentNew = true,
  onAttachDiff,
}: StepViewProps): React.ReactElement {
  const allToolCalls = step.toolCalls.flatMap(
    (tc) => (tc as ChatDisplayItem).resolvedToolCalls ?? []
  );
  const hasToolCalls = allToolCalls.length > 0;

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
        {step.fileEditSummary && step.fileEditSummary.length > 0 && (
          <FileEditSummary entries={step.fileEditSummary} sessionId={sessionId} agentId={agentId} onAttachDiff={onAttachDiff} />
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
      {step.fileEditSummary && step.fileEditSummary.length > 0 && (
        <FileEditSummary entries={step.fileEditSummary} sessionId={sessionId} agentId={agentId} onAttachDiff={onAttachDiff} />
      )}
    </div>
  );
}
