import React, { useEffect, useRef, useState, useCallback } from "react";
import type { SessionOverviewItem } from "../../types";
import { UnreadBadge } from "../ui/UnreadBadge";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  SessionOverviewFooter,
  ResponsePreviewList,
  sessionColorGroup,
  elapsedTier,
} from "./SessionOverviewCardBase";

// ============================================================================
// SessionOverviewCard — full vertical card for the overview panel
// ============================================================================
//
// ┌─ SessionOverviewCard ────────────────────────────────────────┐
// │ [●] agent-name  title  model  [×]  ← SessionOverviewHeader │
// │ [chips: duration, tokens, context, messages]                │
// │ ▸ response preview list                                     │
// │ timestamp                              [unread badge]       │
// └─────────────────────────────────────────────────────────────┘
//
// ═══ Design contrast: SessionOverviewCard vs SessionTab ═══
//
//   Aspect          SessionOverviewCard              SessionTab
//   ──────────────  ──────────────────────────────    ────────────────────────
//   Layout          vertical stack                    2-row compact horizontal
//   Structure       Header → Chips → Preview → Footer Row1: status+agent
//                                                       Row2: title only
//   StatusIcon      in SessionOverviewHeader           left of agent name
//   AgentBadge      in SessionOverviewHeader           left of title row
//   UnreadBadge     footer-right                       absolute top-right
//   Chips           duration/tokens/context/msgs       (none)
//   Preview         recent agent responses             (none)
//   Footer          timestamp                          (none)
//   Close button    always visible                     hover/active only
//   Width           full card width                    compact, flex-shrink
//
// ═══ Shared building blocks (from ui/) ═══
//   - StatusIcon  → both use for session status indicator
//   - AgentBadge  → both use colored dot + truncated name
//   - UnreadBadge → both use for unread message count
//
// ═══ Data flow ═══
//   SessionOverviewCard ← SessionOverviewItem (derived from sessionInfoMap)
//   SessionTab          ← SessionTabState (lightweight) + status resolved by parent
//
// ═══ Responsibility split ═══
//   SessionOverviewPanel (parent) owns: filter, selection mode, batch ops
//   SessionOverviewCard (this)  owns: expand/collapse, long-press, flash anim
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
  const isCancelable =
    session.status === "running" || session.status === "waiting" || session.status === "waiting_for_input";

  const tier = elapsedTier(session.progress.elapsedMs);

  const prevStatusRef = useRef(session.status);
  const [isFlashing, setIsFlashing] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const wasActive =
      prev === "running" || prev === "waiting" || prev === "waiting_for_input";
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
          <SessionOverviewHeader session={session} agentColor={agentColor} />
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
      <SessionOverviewChips session={session} />

      {/* Response preview */}
      <ResponsePreviewList
        responses={session.recentResponses}
        maxItems={isExpanded ? 5 : 3}
      />

      {/* Footer: timestamp + unread badge (bottom-right) */}
      <div className="session-overview-card-footer">
        <span className="session-overview-card-timestamp">
          {new Date(session.lastResponseAt ?? session.createdAt).toLocaleTimeString()}
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
