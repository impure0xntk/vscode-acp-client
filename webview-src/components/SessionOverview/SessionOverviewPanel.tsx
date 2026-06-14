import React, { useCallback, useMemo } from "react";
import type {
  SessionOverviewState,
  SessionOverviewFilter,
  SessionOverviewItem,
} from "../../types";
import type { ConnectedAgentInfo } from "../../store/sessionStore";
import { useUiStateStore } from "../../store/uiStateStore";
import { useMessageStore } from "../../store/messageStore";
import {
  useSessionStore,
  selectOverviewItems,
  sessionKeyOf,
} from "../../store/sessionStore";
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

  // Subscribe to activeSessionKey (primitive — stable identity).
  const storeActiveKey = useSessionStore((s) => s.activeSessionKey);

  // Subscribe only to the structural primitives that feed selectOverviewItems.
  // Do NOT subscribe to sessionInfoMap — live fields are now handled by each
  // SessionOverviewCard individually via useSessionInfo(sessionKey).
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const tabTitles = useSessionStore((s) => s.tabTitles);

  // Build overview items from tabOrder + tabTitles (structural only).
  // Live status/elapsedMs come from each card's own subscription.
  const overviewItems = useMemo(
    () => {
      const keys = tabOrder;
      return keys.map((key): SessionOverviewItem => {
        const [agentId, sessionId] = key.split(":");
        const title = tabTitles[key] ?? sessionId;
        // Minimal item — live fields will be filled by SessionOverviewCard.
        return {
          sessionId,
          agentId,
          title,
          status: "idle",
          progress: {
            elapsedMs: 0,
            tokenUsage: { input: 0, output: 0, total: 0 },
            messageCount: 0,
            toolCallCount: 0,
            toolCallsCompleted: 0,
          },
          recentResponses: [],
          createdAt: new Date().toISOString(),
          lastResponseAt: null,
        };
      });
    },
    [tabOrder, tabTitles],
  );

  // Apply filter to sessions — but since we no longer have live status here,
  // we show all sessions and let the card's own subscription handle visibility.
  // For now, pass through all items; filtering by status would require a
  // separate mechanism (e.g., a status summary map).
  const filteredSessions = useMemo(() => {
    if (state.filter === "all") return overviewItems;
    // Without sessionInfoMap, we can't filter by status here.
    // Return all items; the card will show its own live status.
    // TODO: if status filtering is needed, add a lightweight status-only selector.
    return overviewItems;
  }, [overviewItems, state.filter]);

  // Build unread count map — only recompute when the set of filtered session
  // keys actually changes.
  const filteredKeys = useMemo(
    () => filteredSessions.map((s) => `${s.agentId}:${s.sessionId}`).join(","),
    [filteredSessions],
  );
  const unreadMap = useMemo(() => {
    const msgStore = useMessageStore.getState();
    const uiStore = useUiStateStore.getState();
    const map = new Map<string, number>();
    for (const s of filteredSessions) {
      const key = sessionKeyOf(s.agentId, s.sessionId);
      const msgs = msgStore.perSession[key];
      const ids = (msgs ?? []).map((m) => m.id);
      map.set(key, uiStore.computeUnreadCount(key, ids));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredKeys]);

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
          Total: {fmtTotal(filteredSessions)} tokens
        </span>
      </div>
    </div>
  );
}

function fmtTotal(sessions: SessionOverviewItem[]): string {
  const total = sessions.reduce((sum, s) => sum + s.progress.tokenUsage.total, 0);
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}m`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
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
