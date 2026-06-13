import React, { useCallback, useMemo } from "react";
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
  onClose: (sessionId: string, agentId: string) => void;
  onToggleExpand: (sessionId: string) => void;
  onToggleCollapse: (sessionId: string) => void;
  /** Current width (controlled by parent) */
  width: number;
  /** New session button handler */
  onNewSession?: () => void;
  /** Toggle selection for a session (selection mode or click) */
  onToggleSelect: (sessionId: string) => void;
  /** Long-press: enter selection mode and select this session */
  onLongPress: (sessionId: string) => void;
  /** Batch close selected sessions */
  onCloseSelected: () => void;
  /** Exit selection mode */
  onExitSelectionMode: () => void;
}

export function SessionOverviewPanel({
  isVisible,
  state,
  tabs,
  onFilterChange,
  onFocus,
  onCancel,
  onClose,
  onToggleExpand,
  onToggleCollapse,
  width,
  onNewSession,
  onToggleSelect,
  onLongPress,
  onCloseSelected,
  onExitSelectionMode,
}: Props): React.ReactElement | null {
  if (!isVisible) return null;

  const expanded = state.expandedSessions ?? [];
  const selectedIds = state.selectedSessionIds ?? [];
  const selectionMode = state.selectionMode ?? false;

  // Apply filter to sessions
  const filteredSessions = useMemo(() => {
    if (state.filter === "all") return state.sessions;
    return state.sessions.filter((s) => s.status === state.filter);
  }, [state.sessions, state.filter]);

  const filteredTotalTokens = filteredSessions.reduce(
    (sum, s) => sum + s.progress.tokenUsage.total,
    0
  );

  // Build a lookup map for unread counts from tabs
  const unreadMap = new Map<string, number>();
  for (const tab of tabs) {
    unreadMap.set(`${tab.agentId}:${tab.sessionId}`, tab.unreadCount);
  }

  const activeKey =
    state.activeSessionId && state.activeAgentId
      ? `${state.activeAgentId}:${state.activeSessionId}`
      : null;

  // Count selected sessions (any status can be closed)
  const selectedCount = selectedIds.length;

  return (
    <div className="session-overview-panel" style={{ width, minWidth: width }}>
      <SessionOverviewToolbar
        filter={state.filter}
        sessionCount={filteredSessions.length}
        onFilterChange={onFilterChange}
        onNewSession={onNewSession}
        selectionMode={selectionMode}
        onExitSelectionMode={onExitSelectionMode}
      />

      {/* Batch operations bar — visible whenever selection mode is active */}
      {selectionMode && (
        <div className="session-overview-batch-bar">
          <span className="session-overview-batch-count">
            {selectedIds.length > 0
              ? `${selectedIds.length} selected`
              : "Tap sessions to select"}
          </span>
          <div className="session-overview-batch-actions">
            <button
              className="session-overview-batch-close"
              onClick={onCloseSelected}
              disabled={selectedCount === 0}
              title={`Close ${selectedCount} selected session(s)`}
            >
              Close {selectedCount > 0 ? selectedCount : ""}
            </button>
            <button
              className="session-overview-batch-close"
              onClick={onExitSelectionMode}
              title="Exit selection mode"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="session-overview-list">
        {filteredSessions.map((session) => (
          <SessionOverviewCard
            key={`${session.agentId}:${session.sessionId}`}
            session={session}
            isExpanded={expanded.includes(session.sessionId)}
            unreadCount={
              unreadMap.get(`${session.agentId}:${session.sessionId}`) ?? 0
            }
            isActive={`${session.agentId}:${session.sessionId}` === activeKey}
            isSelected={selectedIds.includes(session.sessionId)}
            selectionMode={selectionMode}
            onToggle={() => {
              if (expanded.includes(session.sessionId)) {
                onToggleCollapse(session.sessionId);
              } else {
                onToggleExpand(session.sessionId);
              }
            }}
            onFocus={() => onFocus(session.sessionId, session.agentId)}
            onCancel={() => onCancel(session.sessionId, session.agentId)}
            onClose={() => onClose(session.sessionId, session.agentId)}
            onSelect={onToggleSelect}
            onLongPress={onLongPress}
          />
        ))}
      </div>
      <div className="session-overview-footer">
        <span className="session-overview-total-tokens">
          Total: {fmt(filteredTotalTokens)} tokens
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
  props: Props & {
    onResizeEnd: (width: number) => void;
    onNewSession?: () => void;
  }
): React.ReactElement | null {
  const { width, isResizing, handleMouseDown } = useResizeHandle({
    initialWidth: props.width,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    onResizeEnd: props.onResizeEnd,
  });

  if (!props.isVisible) return null;

  return (
    <div
      className="session-overview-resize-container"
      style={{ display: "flex", flexDirection: "row" }}
    >
      <div
        className={`session-overview-resize-handle${isResizing ? " resizing" : ""}`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session overview panel"
      />
      <SessionOverviewPanel {...props} width={width} />
    </div>
  );
}
