import React, { useCallback, useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.SessionTabs");
import type {
  SessionTabState,
  ConnectedAgentInfo,
} from "../store/sessionStore";
import type { SessionOverviewItem } from "../types";
import type { MessageState } from "../store/messageStore";
import type { SessionState } from "../store/sessionStore";
import { useUiStateStore } from "../store/uiStateStore";
import { useMessageStore } from "../store/messageStore";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import { SessionTab } from "./SessionTab";
import { SessionOverviewPopup } from "./SessionOverview/SessionOverviewPopup";

/** Delay before showing popup after hover (ms) */
const HOVER_SHOW_DELAY = 300;
/** Delay before hiding popup after mouse leaves (ms) */
const HOVER_HIDE_DELAY = 200;

// ============================================================================
// SessionTabs — TabBar container that renders SessionTab for each open session
// ============================================================================
//
// Architecture:
//   SessionTabs (bar container, drag/drop, hover timers, popup)
//     └── SessionTab × N (individual tabs — compact 2-row horizontal)
//           ├── StatusIcon    ← shared with SessionOverviewCard
//           ├── AgentBadge    ← shared with SessionOverviewCard
//           ├── title
//           ├── UnreadBadge  ← shared with SessionOverviewCard
//           └── close button
//
// Contrast with SessionOverviewPanel:
//   SessionOverviewPanel (sidebar)
//     └── SessionOverviewCard (full vertical stack)
//           ├── SessionOverviewHeader (StatusIcon + AgentBadge + title + model)
//           ├── SessionOverviewChips (duration, tokens, context, messages)
//           ├── ResponsePreviewList (recent agent responses)
//           ├── footer (timestamp + UnreadBadge)
//           └── close button (always visible)
//
// Both SessionTab and SessionOverviewCard share:
//   - StatusIcon, AgentBadge, UnreadBadge (from ui/)
//   - sessionInfoMap as single source of truth (via getState())
//   - close signature: (sessionId: string, agentId: string)
//
// Divergence:
//   - Tab:  compact 2-row, no chips/preview/footer, close on hover only
//   - Card: full vertical, always-visible close, rich content
//
// Responsibility split:
//   SessionTabs owns: drag/drop, hover timers, popup, unread derivation,
//                     status derivation from sessionInfoMap
//   SessionTab owns:   visual layout, close button visibility, click handling
//   → SessionTab does NOT subscribe to any store; fully prop-driven.
// ============================================================================

interface SessionTabsProps {
  tabs: SessionTabState[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  connectedAgents: ConnectedAgentInfo[];
  overviewItems: Record<string, SessionOverviewItem>;
  onTabClick: (sessionId: string, agentId: string) => void;
  onTabClose: (sessionId: string, agentId: string) => void;
  onTabReorder: (tabs: SessionTabState[]) => void;
  onNewSession: () => void;
}

export function SessionTabs({
  tabs,
  activeSessionId,
  activeAgentId,
  connectedAgents,
  overviewItems,
  onTabClick,
  onTabClose,
  onTabReorder,
  onNewSession,
}: SessionTabsProps): React.ReactElement {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoveredTabKey, setHoveredTabKey] = useState<string | null>(null);
  const [popupSession, setPopupSession] = useState<{
    agentId: string;
    sessionId: string;
    rect: DOMRect;
  } | null>(null);

  const hoverShowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (hoverShowTimer.current) {
      clearTimeout(hoverShowTimer.current);
      hoverShowTimer.current = null;
    }
    if (hoverHideTimer.current) {
      clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // Clear hover state when the hovered session is removed from tabs
  useEffect(() => {
    if (
      hoveredTabKey !== null &&
      !tabs.some((t) => sessionKeyOf(t.agentId, t.sessionId) === hoveredTabKey)
    ) {
      setHoveredTabKey(null);
    }
  }, [hoveredTabKey, tabs]);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== targetIndex) {
        const newTabs = [...tabs];
        const [moved] = newTabs.splice(dragIndex, 1);
        newTabs.splice(targetIndex, 0, moved);
        onTabReorder(newTabs);
      }
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, tabs, onTabReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const handleTabMouseEnter = useCallback(
    (e: React.MouseEvent, tab: SessionTabState) => {
      clearTimers();
      setHoveredTabKey(sessionKeyOf(tab.agentId, tab.sessionId));
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      hoverShowTimer.current = setTimeout(() => {
        setPopupSession({
          agentId: tab.agentId,
          sessionId: tab.sessionId,
          rect,
        });
      }, HOVER_SHOW_DELAY);
    },
    [clearTimers],
  );

  const handleTabMouseLeave = useCallback(() => {
    clearTimers();
    hoverHideTimer.current = setTimeout(() => {
      setHoveredTabKey(null);
      setPopupSession(null);
    }, HOVER_HIDE_DELAY);
  }, [clearTimers]);

  const handlePopupMouseEnter = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  const handlePopupMouseLeave = useCallback(() => {
    clearTimers();
    setHoveredTabKey(null);
    setPopupSession(null);
  }, [clearTimers]);

  // Subscribe to stores so the component re-renders on changes.
  const perSession = useMessageStore(useShallow((s) => s.perSession));
  const sessionInfoMap = useSessionStore(useShallow((s) => s.sessionInfoMap));

  // Derive unread counts — recomputed whenever tabs or perSession changes.
  const unreadMap = React.useMemo(() => {
    const uiStore = useUiStateStore.getState();
    const map = new Map<string, number>();
    for (const tab of tabs) {
      const key = sessionKeyOf(tab.agentId, tab.sessionId);
      const ids = (perSession[key] ?? []).map((m) => m.id);
      map.set(key, uiStore.computeUnreadCount(key, ids));
    }
    return map;
  }, [tabs, perSession]);

  return (
    <div className="session-tabs-bar">
      <div className="session-tabs-scroll">
        {tabs.map((tab, index) => {
          const key = sessionKeyOf(tab.agentId, tab.sessionId);
          const isActive =
            tab.sessionId === activeSessionId &&
            tab.agentId === activeAgentId;
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== index;
          const isHovered = hoveredTabKey === key;

          // Derive display state from sessionInfoMap (single source of truth)
          const info = sessionInfoMap[key];
          const status = info?.status ?? "idle";
          const elapsedMs =
            status === "running" && info?.lastResponseAt
              ? Date.now() - new Date(info.lastResponseAt).getTime()
              : undefined;

          const unread = unreadMap.get(key) ?? 0;
          const agentColor = connectedAgents.find(
            (a) => a.agentId === tab.agentId,
          )?.color;

          return (
            <div
              key={key}
              style={{ display: "contents" }}
              draggable={isDragging}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <SessionTab
                tab={tab}
                isActive={isActive}
                isHovered={isHovered}
                status={status}
                elapsedMs={elapsedMs}
                agentColor={agentColor}
                agentIcon={tab.agentIcon}
                unreadCount={unread}
                onClick={() => onTabClick(tab.sessionId, tab.agentId)}
                onClose={() => onTabClose(tab.sessionId, tab.agentId)}
                onMouseEnter={(e) => handleTabMouseEnter(e, tab)}
                onMouseLeave={handleTabMouseLeave}
              />
            </div>
          );
        })}
      </div>
      <button
        className="session-new-btn"
        onClick={onNewSession}
        title="New session"
      >
        +
      </button>

      {/* Overview popup on tab hover */}
      {popupSession &&
        overviewItems[
          `${popupSession.agentId}:${popupSession.sessionId}`
        ] && (
          <div
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
          >
            <SessionOverviewPopup
              session={
                overviewItems[
                  `${popupSession.agentId}:${popupSession.sessionId}`
                ]
              }
              anchorRect={popupSession.rect}
            />
          </div>
        )}
    </div>
  );
}
