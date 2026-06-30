import React from "react";
import type { SessionOverviewCardItem } from "./supervisor-types";
import { SessionOverviewCard } from "../overview/SessionOverviewCard";
import type { SessionOverviewItem } from "../../../types";

interface Props {
  sessions: SessionOverviewCardItem[];
  currentStepId: string | null;
  onFocus: (sessionKey: string) => void;
  onCancel: (sessionKey: string) => void;
}

/**
 * Adaptor that maps SessionOverviewCardItem (supervisor domain) to
 * SessionOverviewItem (existing overview card's expected shape).
 */
function toOverviewItem(item: SessionOverviewCardItem): SessionOverviewItem {
  return {
    sessionId: item.sessionId,
    agentId: item.agentId,
    title: item.title,
    status: item.status,
    lastTurnOutcome: null,
    progress: {
      elapsedMs: item.elapsedMs ?? 0,
      tokenUsage: {
        input: item.tokenUsage.input,
        output: item.tokenUsage.output,
        total: item.tokenUsage.input + item.tokenUsage.output,
      },
      messageCount: 0,
      toolCallCount: 0,
      toolCallsCompleted: 0,
    },
    recentResponses: [],
    createdAt: new Date().toISOString(),
    lastResponseAt: null,
  };
}

export const SessionOverviewGrid = React.memo(function SessionOverviewGrid({
  sessions,
  currentStepId,
  onFocus,
  onCancel,
}: Props): React.ReactElement {
  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-muted text-xs p-4">
        No sessions in this team. Create a session to get started.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-2 overflow-y-auto flex-1 min-h-0">
      {sessions.map((item) => (
        <SessionOverviewCard
          key={item.sessionKey}
          session={toOverviewItem(item)}
          agentColor={item.agentColor}
          isExpanded={false}
          unreadCount={item.hasUnread ? 1 : 0}
          isActive={false}
          isSelected={item.assignedStepId === currentStepId}
          selectionMode={false}
          onToggle={() => {}}
          onFocus={() => onFocus(item.sessionKey)}
          onCancel={() => onCancel(item.sessionKey)}
          onClose={() => {}}
          onSelect={() => {}}
          onLongPress={() => {}}
        />
      ))}
    </div>
  );
});
