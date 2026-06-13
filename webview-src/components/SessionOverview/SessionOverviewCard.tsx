import React, { useEffect, useRef, useState, useCallback } from "react";
import type { SessionOverviewItem } from "../../types";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  SessionOverviewFooter,
  ResponsePreviewList,
  sessionColorGroup,
  elapsedTier,
} from "./SessionOverviewCardBase";

interface Props {
  session: SessionOverviewItem;
  isExpanded: boolean;
  unreadCount: number;
  isActive: boolean;
  isSelected: boolean;
  selectionMode: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onCancel: () => void;
  onClose: () => void;
  onSelect: (sessionId: string) => void;
  /** Long-press: enter selection mode and select this session */
  onLongPress: (sessionId: string) => void;
}

const LONG_PRESS_MS = 500;

export function SessionOverviewCard({
  session,
  isExpanded,
  unreadCount,
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
  const isCancelable =
    session.status === "running" || session.status === "waiting" || session.status === "waiting_for_input";

  const tier = elapsedTier(session.progress.elapsedMs);

  const prevStatusRef = useRef(session.status);
  const [isFlashing, setIsFlashing] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    const wasActive =
      prevStatusRef.current === "running" || prevStatusRef.current === "waiting";
    const isTerminal =
      session.status === "completed" || session.status === "error";

    if (wasActive && isTerminal) {
      setIsFlashing(true);
    }

    prevStatusRef.current = session.status;
  }, [session.status]);

  const handleAnimationEnd = useCallback(() => {
    setIsFlashing(false);
  }, []);

  const flashingStatus = isFlashing ? session.status : undefined;

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
      data-status={session.status}
      data-color-group={sessionColorGroup(session.status)}
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
          <SessionOverviewHeader session={session} />
        </div>
        <button
          className="session-tab-close"
          type="button"
          aria-label="Close session"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>

      {/* Chips row */}
      <SessionOverviewChips session={session} />

      {/* Response preview */}
      <ResponsePreviewList
        responses={session.recentResponses}
        maxItems={isExpanded ? 5 : 3}
      />

      {/* Footer: timestamp + unread badge (bottom-right) */}
      <div className="session-overview-card-footer">
        <span className="session-overview-card-timestamp">
          {new Date(session.updatedAt).toLocaleTimeString()}
        </span>
        <div className="session-overview-card-actions">
          {unreadCount > 0 && (
            <span className="session-overview-card-badge">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
