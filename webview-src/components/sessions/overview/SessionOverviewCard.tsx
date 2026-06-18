import React, { useEffect, useRef, useState, useCallback } from "react";
import { getLogger } from "../../../lib/logger"

const log = getLogger("webview.SessionOverviewCard");
import type { SessionOverviewItem } from "../../../types";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import { UnreadBadge } from "../../primitives/UnreadBadge";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  SessionOverviewFooter,
  ResponsePreviewList,
  sessionColorGroup,
  elapsedTier,
  snapshotToOverviewItem,
} from "./SessionOverviewCardBase";
import { useSessionStore } from "../../../store/sessionStore"
import type { TurnOutcome } from "../../primitives/StatusIcon"

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

  const status = liveItem.status as string;
  const isCancelable =
    status === "running" ||
    status === "waiting" ||
    status === "waiting_for_input";

  const tier = elapsedTier(liveItem.progress.elapsedMs);

  // Use lastTurnOutcome for attribute when idle, so CSS can style by outcome
  const effectiveOutcome = liveItem.lastTurnOutcome;

  const prevOutcomeRef = useRef<TurnOutcome | null | undefined>(undefined);
  const [isFlashing, setIsFlashing] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    const prev = prevOutcomeRef.current;
    const current = liveItem.lastTurnOutcome;

    // Skip on first render (prev is undefined) to avoid false flash
    if (prev === undefined) {
      prevOutcomeRef.current = current;
      return;
    }

    // Flash when a new terminal outcome appears
    const isTerminal =
      current === "completed" || current === "error" || current === "cancelled";
    const isNew = current !== prev;

    if (isTerminal && isNew) {
      setIsFlashing(true);
    }

    prevOutcomeRef.current = current;
  }, [liveItem.lastTurnOutcome]);

  const handleAnimationEnd = useCallback(() => {
    setIsFlashing(false);
  }, []);

  const flashingStatus = isFlashing
    ? (liveItem.lastTurnOutcome ?? liveItem.status)
    : undefined;

  // ── Long-press handling ────────────────────────────────────────────
  const handlePointerDown = useCallback(() => {
    didLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      log.debug("card long press", { sessionId: session.sessionId });
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
      return;
    }
    if (selectionMode) {
      log.debug("card click → toggle select", { sessionId: session.sessionId });
      onSelect(session.sessionId);
    } else {
      log.info("card click → focus", {
        sessionId: session.sessionId,
        agentId: session.agentId,
      });
      onFocus();
    }
  }, [selectionMode, onSelect, session.sessionId, onFocus]);

  return (
    <div
      className={`session-overview-card${isExpanded ? " session-overview-card-expanded" : ""}${isActive ? " session-overview-card-active" : ""}${isSelected ? " session-overview-card-selected" : ""}`}
      data-status={
        liveItem.status === "idle" && effectiveOutcome
          ? effectiveOutcome
          : liveItem.status
      }
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
          {new Date(
            liveItem.lastResponseAt ?? liveItem.createdAt
          ).toLocaleTimeString()}
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
