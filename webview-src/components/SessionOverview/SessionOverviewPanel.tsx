import React, { useCallback } from "react";
import type {
  SessionOverviewState,
  SessionOverviewFilter,
} from "../../types";
import { SessionOverviewToolbar } from "./SessionOverviewToolbar";
import { SessionOverviewCard } from "./SessionOverviewCard";
import { useResizeHandle } from "../../hooks/useResizeHandle";

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

interface Props {
  isVisible: boolean;
  state: SessionOverviewState;
  /** Tab state for unread badge lookup */
  tabs: Array<{ sessionId: string; agentId: string; unreadCount: number }>;
  onFilterChange: (filter: SessionOverviewFilter) => void;
  onFocus: (sessionId: string, agentId: string) => void;
  onCancel: (sessionId: string, agentId: string) => void;
  onToggleExpand: (sessionId: string) => void;
  onToggleCollapse: (sessionId: string) => void;
  /** Current width (controlled by parent) */
  width: number;
}

export function SessionOverviewPanel({
  isVisible,
  state,
  tabs,
  onFilterChange,
  onFocus,
  onCancel,
  onToggleExpand,
  onToggleCollapse,
  width,
}: Props): React.ReactElement | null {
  if (!isVisible) return null;

  const expanded = state.expandedSessions ?? [];
  const totalTokens = state.sessions.reduce(
    (sum, s) => sum + s.progress.tokenUsage.total,
    0
  );

  // Build a lookup map for unread counts from tabs
  const unreadMap = new Map<string, number>();
  for (const tab of tabs) {
    unreadMap.set(`${tab.agentId}:${tab.sessionId}`, tab.unreadCount);
  }

  const activeKey = state.activeSessionId && state.activeAgentId
    ? `${state.activeAgentId}:${state.activeSessionId}`
    : null;

  return (
    <div className="session-overview-panel" style={{ width, minWidth: width }}>
      <SessionOverviewToolbar
        filter={state.filter}
        sessionCount={state.sessions.length}
        onFilterChange={onFilterChange}
      />
      <div className="session-overview-list">
        {state.sessions.map((session) => (
          <SessionOverviewCard
            key={`${session.agentId}:${session.sessionId}`}
            session={session}
            isExpanded={expanded.includes(session.sessionId)}
            unreadCount={unreadMap.get(`${session.agentId}:${session.sessionId}`) ?? 0}
            isActive={`${session.agentId}:${session.sessionId}` === activeKey}
            onToggle={() => {
              if (expanded.includes(session.sessionId)) {
                onToggleCollapse(session.sessionId);
              } else {
                onToggleExpand(session.sessionId);
              }
            }}
            onFocus={() => onFocus(session.sessionId, session.agentId)}
            onCancel={() => onCancel(session.sessionId, session.agentId)}
          />
        ))}
      </div>
      <div className="session-overview-footer">
        <span className="session-overview-total-tokens">
          Total: {fmt(totalTokens)} tokens
        </span>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Wrapper component that adds resize handle */
export function ResizableSessionOverviewPanel(
  props: Props & { onResizeEnd: (width: number) => void }
): React.ReactElement | null {
  const { width, isResizing, handleMouseDown } = useResizeHandle({
    initialWidth: props.width,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    onResizeEnd: props.onResizeEnd,
  });

  if (!props.isVisible) return null;

  return (
    <div className="session-overview-resize-container" style={{ display: "flex", flexDirection: "row" }}>
      <div
        className={`session-overview-resize-handle${isResizing ? " resizing" : ""}`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session overview panel"
      />
      <SessionOverviewPanel
        {...props}
        width={width}
      />
    </div>
  );
}
