import React, { useCallback, useState } from "react";
import type { SessionTabState } from "../hooks/useSessionContext";
import { StatusIcon } from "./StatusIcon";

// ============================================================================
// Props
// ============================================================================

interface SessionTabsProps {
  tabs: SessionTabState[];
  activeSessionId: string | null;
  onTabClick: (sessionId: string, agentId: string) => void;
  onTabClose: (sessionId: string) => void;
  onTabReorder: (tabs: SessionTabState[]) => void;
  onNewSession: () => void;
}

// ============================================================================
// Agent badge — coloured dot + truncated name
// ============================================================================

function AgentBadge({ agentId, agentColor }: { agentId: string; agentColor?: string }): React.ReactElement {
  return (
    <span className="session-tab-agent-badge" title={agentId}>
      <span className="session-tab-agent-dot" style={{ background: agentColor }} />
      <span className="session-tab-agent-name">{agentId}</span>
    </span>
  );
}

// ============================================================================
// SessionTabs Component
// ============================================================================

export function SessionTabs({
  tabs,
  activeSessionId,
  onTabClick,
  onTabClose,
  onTabReorder,
  onNewSession,
}: SessionTabsProps): React.ReactElement {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropIndex(index);
    },
    []
  );

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

  return (
    <div className="session-tabs-bar">
      <div className="session-tabs-scroll">
        {tabs.map((tab, index) => {
          const isActive = tab.sessionId === activeSessionId;
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== index;
          const isHovered = hoveredTabId === tab.sessionId;
          const showCloseButton = isActive || isHovered;

          return (
            <div
              key={`${tab.agentId}:${tab.sessionId}`}
              className={`session-tab${isActive ? " session-tab-active" : ""}${isDragging ? " dragging" : ""}${isDropTarget ? " drop-target" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => onTabClick(tab.sessionId, tab.agentId)}
              onMouseEnter={() => setHoveredTabId(tab.sessionId)}
              onMouseLeave={() => setHoveredTabId(null)}
            >
              {/* Row 1: Status + Agent name */}
              <div className="session-tab-row session-tab-row-agent">
                <StatusIcon status={tab.status} />
                {tab.agentIcon ? (
                  <span className="session-tab-agent-icon">{tab.agentIcon}</span>
                ) : (
                  <AgentBadge agentId={tab.agentId} agentColor={tab.agentColor} />
                )}
              </div>

              {/* Row 2: Session title + actions */}
              <div className="session-tab-row session-tab-row-session">
                <span className="session-tab-title" title={tab.title}>
                  {tab.title}
                </span>
                {tab.unreadCount > 0 && !isActive && (
                  <span className="session-tab-badge">{tab.unreadCount}</span>
                )}
              </div>

              {/* Action buttons - visible on hover or active */}
              <div className={`session-tab-actions${showCloseButton ? " session-tab-actions-visible" : ""}`}>
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
    </div>
  );
}
