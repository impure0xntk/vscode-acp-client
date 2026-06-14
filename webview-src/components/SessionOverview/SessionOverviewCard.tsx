import React, { useEffect, useRef, useState, useCallback } from "react";
import type { SessionOverviewItem } from "../../types";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { UnreadBadge } from "../ui/UnreadBadge";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  SessionOverviewFooter,
  ResponsePreviewList,
  sessionColorGroup,
  elapsedTier,
  snapshotToOverviewItem,
} from "./SessionOverviewCardBase";
import { useSessionStore } from "../../store/sessionStore";

// ============================================================================
// SessionOverviewCard — full vertical card for the overview panel
// ============================================================================
//
// Subscribes to its own session info via useSessionInfo(sessionKey).
// The parent (SessionOverviewPanel) still passes a SessionOverviewItem for
// structural data (title, etc.), but live fields (status, elapsedMs, tokenUsage)
// come from the hook so the card re-renders only when its own session changes.
//
// ═══ Responsibility split ═══
//   SessionOverviewPanel (parent) owns: filter, selection mode, batch ops
//   SessionOverviewCard (this)  owns: live status subscription, expand/collapse,
//                                    long-press, flash anim
// ============================================================================

interface Props {
  session: SessionOverviewItem;
  /** Agent color for the badge dot — looked up by parent from connectedAgents */
  agentColor?: string;
  isExpanded: boolean;
  unreadCount?: number;
  isActive: boolean;
  isSelected: boolean;
  selectionMode: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onCancel: () => void;
  onClose: (sessionId: string, agentId: string) => void;
  onSelect: (sessionId: string) => void;
  /** Long-press: enter selection mode and select this session */
  onLongPress: (sessionId: string) => void;
}

const LONG_PRESS_MS = 500;

export function SessionOverviewCard({
  session,
  agentColor,
  isExpanded,
  unreadCount = 0,
  isActive,
  isSelected,
  selectionMode,
  onToggle,
  onFocus,
  onCancel,
  onClose,
  onSelect,
  onLongPress,
}: Props): React.ReactElement {
  // Subscribe to live session info — re-renders only when this session changes.
  const sessionKey = `${session.agentId}:${session.sessionId}`;
  const liveInfo = useSessionInfo(sessionKey);

  // Merge: use live info when available, fall back to the snapshot from parent.
  const liveItem: SessionOverviewItem = liveInfo
    ? snapshotToOverviewItem(liveInfo, session.title)
    : session;

  const isCancelable =
    liveItem.status === "running" || liveItem.status === "waiting" || liveItem.status === "waiting_for_input";

  const tier = elapsedTier(liveItem.progress.elapsedMs);

  const prevStatusRef = useRef(liveItem.status);
  const [isFlashing, setIsFlashing] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const wasActive =
      prev === "running" || prev === "waiting" || prev === "waiting_for_input";
    const isTerminal =
      liveItem.status === "completed" || liveItem.status === "error";

    if (wasActive && isTerminal) {
      setIsFlashing(true);
    }

    prevStatusRef.current = liveItem.status;
  }, [liveItem.status]);

  const handleAnimationEnd = useCallback(() => {
    setIsFlashing(false);
  }, []);

  const flashingStatus = isFlashing ? liveItem.status : undefined;

  // ── Long-press handling ────────────────────────────────────────────
  const handlePointerDown = useCallback(() => {
    didLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      onLongPress(session.sessionId);
    }, LONG_PRESS_MS);
  }, [session.sessionId, onLongPress]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // ── Click handler ──────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    if (didLongPressRef.current) {
      // Consumed by long-press — don't navigate
      return;
    }
    if (selectionMode) {
      onSelect(session.sessionId);
    } else {
      onFocus();
    }
  }, [selectionMode, onSelect, session.sessionId, onFocus]);

  return (
    <div
      className={`session-overview-card${isExpanded ? " session-overview-card-expanded" : ""}${isActive ? " session-overview-card-active" : ""}${isSelected ? " session-overview-card-selected" : ""}`}
      data-status={liveItem.status}
      data-color-group={sessionColorGroup(liveItem.status)}
      data-elapsed-tier={tier}
      data-flashing={flashingStatus}
      onAnimationEnd={handleAnimationEnd}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (selectionMode) {
            onSelect(session.sessionId);
          } else {
            onFocus();
          }
        }
      }}
    >
      {/* Header row: close button top-right */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SessionOverviewHeader session={liveItem} agentColor={agentColor} />
        </div>
        <button
          className="session-tab-close"
          type="button"
          aria-label="Close session"
          onClick={(e) => {
            e.stopPropagation();
            onClose(session.sessionId, session.agentId);
          }}
        >
          ×
        </button>
      </div>

      {/* Chips row */}
      <SessionOverviewChips session={liveItem} />

      {/* Response preview */}
      <ResponsePreviewList
        responses={liveItem.recentResponses}
        maxItems={isExpanded ? 5 : 3}
      />

      {/* Footer: timestamp + unread badge (bottom-right) */}
      <div className="session-overview-card-footer">
        <span className="session-overview-card-timestamp">
          {new Date(liveItem.lastResponseAt ?? liveItem.createdAt).toLocaleTimeString()}
        </span>

        <div className="session-overview-card-actions">
          <UnreadBadge
            count={unreadCount}
            hidden={isActive}
            className="session-overview-card-badge"
          />
        </div>
      </div>
    </div>
  );
}
