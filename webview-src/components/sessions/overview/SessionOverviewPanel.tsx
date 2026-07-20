import React, { useCallback, useMemo } from "react";
import type {
  SessionOverviewState,
  SessionOverviewFilter,
  SessionOverviewItem,
} from "../../../types";
import type {
  ConnectedAgentInfo,
  SessionInfoDTO,
} from "../../../store/sessionStore";
import { useScrollStateStore } from "../../../store/scrollStateStore";
import { useMessageStore } from "../../../store/messageStore";
import { useSessionStore, sessionKeyOf } from "../../../store/sessionStore";
import { SessionOverviewToolbar } from "./SessionOverviewToolbar";
import { SessionOverviewCard } from "./SessionOverviewCard";
import { useResizeHandle } from "../../../hooks/useResizeHandle";

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
  /** Expand a session (drill-down to its message history) — MiniChat only */
  onExpand?: (sessionId: string, agentId: string) => void;
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
  onExpand,
}: Props): React.ReactElement | null {
  if (!isVisible) return null;

  const expanded = state.expandedSessions ?? [];
  const selectedIds = state.selectedSessionIds ?? [];
  const selectionMode = state.selectionMode ?? false;

  const storeActiveKey = useSessionStore((s) => s.activeSessionKey);

  const tabOrder = useSessionStore((s) => s.tabOrder);
  const tabTitles = useSessionStore((s) => s.tabTitles);

  const overviewItems = useMemo(() => {
    const sessionInfoMap = useSessionStore.getState().sessionInfoMap;
    const keys = tabOrder;
    return keys.map((key): SessionOverviewItem => {
      const [agentId, sessionId] = key.split(":");
      const title = tabTitles[key] ?? sessionId;
      const info: SessionInfoDTO | undefined = sessionInfoMap[key];
      return {
        sessionId,
        agentId,
        title,
        status: info?.status ?? "idle",
        lastTurnOutcome: info?.lastTurnOutcome ?? null,
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
  }, [tabOrder, tabTitles]);

  const filteredSessions = useMemo(() => {
    if (state.filter === "all") return overviewItems;
    if (state.filter === "running") {
      return overviewItems.filter((s) => s.status === "running");
    }
    return overviewItems.filter((s) => s.lastTurnOutcome === state.filter);
  }, [overviewItems, state.filter]);

  const filteredKeys = useMemo(
    () => filteredSessions.map((s) => `${s.agentId}:${s.sessionId}`).join(","),
    [filteredSessions]
  );
  const unreadMap = useMemo(() => {
    const scrollStore = useScrollStateStore.getState();
    const msgStore = useMessageStore.getState();
    const map = new Map<string, number>();
    for (const s of filteredSessions) {
      const key = sessionKeyOf(s.agentId, s.sessionId);
      const scrollState = scrollStore.perSession[key];
      const msgs = msgStore.perSession[key] ?? [];
      const totalCount = msgs.length;

      if (!scrollState || totalCount === 0) {
        map.set(key, 0);
        continue;
      }

      const { readUpToMessageId, isAtBottom } = scrollState;
      if (isAtBottom || !readUpToMessageId) {
        map.set(key, 0);
        continue;
      }

      const idx = msgs.findIndex((m) => m.id === readUpToMessageId);
      if (idx < 0 || idx + 1 >= totalCount) {
        map.set(key, 0);
        continue;
      }

      map.set(key, totalCount - idx - 1);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredKeys]);

  const selectedCount = selectedIds.length;

  const handleFocus = useCallback(
    (sessionId: string, agentId: string) => {
      onFocus(sessionId, agentId);
    },
    [onFocus]
  );

  const handleCancel = useCallback(
    (sessionId: string, agentId: string) => {
      onCancel(sessionId, agentId);
    },
    [onCancel]
  );

  const handleClose = useCallback(
    (sessionId: string, agentId: string) => {
      onClose(sessionId, agentId);
    },
    [onClose]
  );

  const handleToggleSelect = useCallback(
    (sessionId: string) => {
      onToggleSelect(sessionId);
    },
    [onToggleSelect]
  );

  const handleLongPress = useCallback(
    (sessionId: string) => {
      onLongPress(sessionId);
    },
    [onLongPress]
  );

  const handleCloseSelected = useCallback(() => {
    onCloseSelected();
  }, [onCloseSelected]);

  const handleExitSelectionMode = useCallback(() => {
    onExitSelectionMode();
  }, [onExitSelectionMode]);

  const handleFilterChange = useCallback(
    (f: SessionOverviewFilter) => {
      onFilterChange(f);
    },
    [onFilterChange]
  );

  const handleNewSession = useCallback(() => {
    onNewSession?.();
  }, [onNewSession]);

  return (
    <div
      className="h-full border-l border-border bg-bg-secondary flex flex-col shrink-0"
      style={{ width, minWidth: width }}
    >
      <SessionOverviewToolbar
        filter={state.filter}
        sessionCount={filteredSessions.length}
        onFilterChange={handleFilterChange}
        onNewSession={handleNewSession}
      />

      {selectionMode && (
        <div className="flex items-center justify-between px-1.5 py-[3px] border-b border-border shrink-0 bg-[color-mix(in_srgb,var(--bg-input)_40%,transparent)] gap-1.5">
          <span className="text-[10px] text-fg-secondary">
            {selectedIds.length > 0
              ? `${selectedIds.length} selected`
              : "Tap sessions to select"}
          </span>
          <div className="flex gap-[3px]">
            <button
              className="text-[10px] px-1.5 py-px border border-border rounded-sm bg-bg-input text-fg-secondary cursor-pointer transition-all duration-150"
              onClick={handleCloseSelected}
              disabled={selectedCount === 0}
              title={`Close ${selectedCount} selected session(s)`}
            >
              Close {selectedCount > 0 ? selectedCount : ""}
            </button>
            <button
              className="text-[10px] px-1.5 py-px border border-border rounded-sm bg-bg-input text-fg-secondary cursor-pointer transition-all duration-150"
              onClick={handleExitSelectionMode}
              title="Exit selection mode"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
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
              isActive={
                `${session.agentId}:${session.sessionId}` === storeActiveKey
              }
              isSelected={selectedIds.includes(session.sessionId)}
              selectionMode={selectionMode}
              onToggle={() => {
                if (expanded.includes(session.sessionId)) {
                  onToggleCollapse(session.sessionId);
                } else {
                  onToggleExpand(session.sessionId);
                }
              }}
              onFocus={() => handleFocus(session.sessionId, session.agentId)}
              onCancel={() => handleCancel(session.sessionId, session.agentId)}
              onClose={() => handleClose(session.sessionId, session.agentId)}
              onSelect={handleToggleSelect}
              onLongPress={handleLongPress}
              onExpand={
                onExpand
                  ? () => onExpand(session.sessionId, session.agentId)
                  : undefined
              }
            />
          );
        })}
      </div>
      <div className="px-2 py-1 border-t border-border shrink-0 text-right">
        <span className="text-[10px] text-fg-muted font-[var(--font-mono)]">
          Total: {fmtTotal(filteredSessions)} tokens
        </span>
      </div>
    </div>
  );
}

function fmtTotal(sessions: SessionOverviewItem[]): string {
  const total = sessions.reduce(
    (sum, s) => sum + s.progress.tokenUsage.total,
    0
  );
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}m`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

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
    <div className="flex flex-row h-full shrink-0">
      <div
        className={`w-4 h-full cursor-col-resize shrink-0 bg-transparent transition-colors duration-150 relative${isResizing ? " resizing" : ""}`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session overview panel"
      />
      <SessionOverviewPanel {...props} width={width} />
    </div>
  );
}
