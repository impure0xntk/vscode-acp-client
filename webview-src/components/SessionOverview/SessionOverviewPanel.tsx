import React, { useCallback, useMemo } from "react";
import type {
  SessionOverviewState,
  SessionOverviewFilter,
  SessionOverviewItem,
} from "../../types";
import type { ConnectedAgentInfo } from "../../hooks/useSessionContext";
import { useSessionUiStateStore } from "../../store/sessionUiStateStore";
import { useMessageStore } from "../../store/messageStore";
import { useSessionStore } from "../../store/sessionStore";
import { useStore } from "zustand";
import { SessionOverviewToolbar } from "./SessionOverviewToolbar";
import { SessionOverviewCard } from "./SessionOverviewCard";
import { useResizeHandle } from "../../hooks/useResizeHandle";

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

interface Props {
  isVisible: boolean;
  state: SessionOverviewState;
  /** Connected agents info for color lookup — passed through to AgentBadge */
  connectedAgents: ConnectedAgentInfo[];
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
  connectedAgents,
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

  // Derive overview items from store (single source of truth: tabs + sessionInfoMap)
  // Read via getState() to avoid useSyncExternalStore subscription —
  // getOverviewItems() returns a new array every call, which would cause
  // infinite re-renders via Object.is comparison in useSyncExternalStore.
  const overviewItems = useSessionStore.getState().getOverviewItems();

  // Apply filter to sessions
  const filteredSessions = useMemo(() => {
    if (state.filter === "all") return overviewItems;
    return overviewItems.filter((s) => s.status === state.filter);
  }, [overviewItems, state.filter]);

  const filteredTotalTokens = filteredSessions.reduce(
    (sum, s) => sum + s.progress.tokenUsage.total,
    0
  );

  // Build a lookup map for unread counts.
  // Read via getState() to avoid subscribing to the message store —
  // recompute when overviewItems or perSession changes.
  const unreadMap = useMemo(() => {
    const msgStore = useMessageStore.getState();
    const uiStore = useSessionUiStateStore.getState();
    const map = new Map<string, number>();
    for (const s of overviewItems) {
      const key = `${s.agentId}:${s.sessionId}`;
      const ids = (msgStore.perSession[key] ?? []).map((m) => m.id);
      map.set(key, uiStore.computeUnreadCount(key, ids));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewItems, useMessageStore.getState().perSession]);

  const storeActiveKey = useSessionStore.getState().activeSessionKey;

  // Count selected sessions (any status can be closed)
  const selectedCount = selectedIds.length;

  return (
    <div className="session-overview-panel" style={{ width, minWidth: width }}>
      <SessionOverviewToolbar
        filter={state.filter}
        sessionCount={filteredSessions.length}
        onFilterChange={onFilterChange}
        onNewSession={onNewSession}
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
              className="session-overview-batch-cancel"
              onClick={onExitSelectionMode}
              title="Exit selection mode"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="session-overview-list">
        {filteredSessions.map((session) => {
          const agentColor = connectedAgents.find(
            (a) => a.agentId === session.agentId
          )?.color;
          return (
            <SessionOverviewCard
              key={`${session.agentId}:${session.sessionId}`}
              session={session}
              agentColor={agentColor}
              isExpanded={expanded.includes(session.sessionId)}
              unreadCount={
                unreadMap.get(`${session.agentId}:${session.sessionId}`) ?? 0
              }
              isActive={`${session.agentId}:${session.sessionId}` === storeActiveKey}
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
          );
        })}
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
