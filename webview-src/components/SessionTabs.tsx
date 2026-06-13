import React, { useCallback, useState, useEffect, useRef } from "react";
import type {
  SessionTabState,
  SessionInfoSnapshot,
  ConnectedAgentInfo,
  SessionOverviewItem,
} from "../hooks/useSessionContext";
import { StatusIcon } from "./StatusIcon";
import { SessionOverviewPopup } from "./SessionOverview/SessionOverviewPopup";

/** Delay before showing popup after hover (ms) */
const HOVER_SHOW_DELAY = 300;
/** Delay before hiding popup after mouse leaves (ms) */
const HOVER_HIDE_DELAY = 200;

// ============================================================================
// Props
// ============================================================================

interface SessionTabsProps {
  tabs: SessionTabState[];
  activeSessionId: string | null;
  /** SessionInfo snapshots from extension host — source of truth for status/tokenUsage/etc */
  sessionInfoMap: Record<string, SessionInfoSnapshot>;
  /** Connected agents info for color lookup */
  connectedAgents: ConnectedAgentInfo[];
  /** Session overview items keyed by "agentId:sessionId" — source of truth for popup content */
  overviewItems: Record<string, SessionOverviewItem>;
  onTabClick: (sessionId: string, agentId: string) => void;
  onTabClose: (sessionId: string) => void;
  onTabReorder: (tabs: SessionTabState[]) => void;
  onNewSession: () => void;
}

// ============================================================================
// Agent badge — coloured dot + truncated name
// ============================================================================

function AgentBadge({
  agentId,
  agentColor,
}: {
  agentId: string;
  agentColor?: string;
}): React.ReactElement {
  return (
    <span className="session-tab-agent-badge" title={agentId}>
      <span
        className="session-tab-agent-dot"
        style={{ background: agentColor }}
      />
      <span className="session-tab-agent-name">{agentId}</span>
    </span>
  );
}

// ============================================================================
// SessionTabs Component — no internal tick, derives elapsed from sessionInfoMap
// ============================================================================

export function SessionTabs({
  tabs,
  activeSessionId,
  sessionInfoMap,
  connectedAgents,
  overviewItems,
  onTabClick,
  onTabClose,
  onTabReorder,
  onNewSession,
}: SessionTabsProps): React.ReactElement {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // Clear hover state when the hovered session is removed from tabs
  useEffect(() => {
    if (
      hoveredTabId !== null &&
      !tabs.some((t) => t.sessionId === hoveredTabId)
    ) {
      setHoveredTabId(null);
    }
  }, [hoveredTabId, tabs]);

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
    [dragIndex, tabs, onTabReorder]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const handleTabMouseEnter = useCallback(
    (e: React.MouseEvent, tab: SessionTabState) => {
      clearTimers();
      setHoveredTabId(tab.sessionId);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      hoverShowTimer.current = setTimeout(() => {
        setPopupSession({
          agentId: tab.agentId,
          sessionId: tab.sessionId,
          rect,
        });
      }, HOVER_SHOW_DELAY);
    },
    [clearTimers]
  );

  const handleTabMouseLeave = useCallback(() => {
    clearTimers();
    hoverHideTimer.current = setTimeout(() => {
      setHoveredTabId(null);
      setPopupSession(null);
    }, HOVER_HIDE_DELAY);
  }, [clearTimers]);

  const handlePopupMouseEnter = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  const handlePopupMouseLeave = useCallback(() => {
    clearTimers();
    setHoveredTabId(null);
    setPopupSession(null);
  }, [clearTimers]);

  return (
    <div className="session-tabs-bar">
      <div className="session-tabs-scroll">
        {tabs.map((tab, index) => {
          const isActive = tab.sessionId === activeSessionId;
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== index;
          const isHovered = hoveredTabId === tab.sessionId;
          const showCloseButton = isActive || isHovered;

          // Derive display state from sessionInfoMap (source of truth)
          const key = `${tab.agentId}:${tab.sessionId}`;
          const info = sessionInfoMap[key];
          const status = info?.status ?? "idle";
          const elapsedMs =
            status === "running" && info?.updatedAt
              ? Date.now() - new Date(info.updatedAt).getTime()
              : undefined;

          return (
            <div
              key={key}
              className={`session-tab${isActive ? " session-tab-active" : ""}${isDragging ? " dragging" : ""}${isDropTarget ? " drop-target" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => onTabClick(tab.sessionId, tab.agentId)}
              onMouseEnter={(e) => handleTabMouseEnter(e, tab)}
              onMouseLeave={handleTabMouseLeave}
            >
              {/* Row 1: Status + Agent name */}
              <div className="session-tab-row session-tab-row-agent">
                <StatusIcon status={status} elapsedMs={elapsedMs} />
                {tab.agentIcon ? (
                  <span className="session-tab-agent-icon">
                    {tab.agentIcon}
                  </span>
                ) : (
                  <AgentBadge
                    agentId={tab.agentId}
                    agentColor={
                      connectedAgents.find((a) => a.agentId === tab.agentId)
                        ?.color
                    }
                  />
                )}
              </div>

              {/* Row 2: Session title + badge */}
              <div className="session-tab-row session-tab-row-session">
                <span className="session-tab-title" title={tab.title}>
                  {tab.title}
                </span>
              </div>
              {/* Badge: positioned absolute at top-right */}
              {tab.unreadCount > 0 && !isActive && (
                <span className="session-tab-badge">
                  {tab.unreadCount > 99 ? "99+" : tab.unreadCount}
                </span>
              )}

              {/* Action buttons - visible on hover or active */}
              <div
                className={`session-tab-actions${showCloseButton ? " session-tab-actions-visible" : ""}`}
              >
                <button
                  className="session-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.sessionId);
                  }}
                  title="Close session"
                >
                  ×
                </button>
              </div>
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
      {popupSession && overviewItems[`${popupSession.agentId}:${popupSession.sessionId}`] && (
        <div
          onMouseEnter={handlePopupMouseEnter}
          onMouseLeave={handlePopupMouseLeave}
        >
          <SessionOverviewPopup
            session={
              overviewItems[`${popupSession.agentId}:${popupSession.sessionId}`]
            }
            anchorRect={popupSession.rect}
          />
        </div>
      )}
    </div>
  );
}
