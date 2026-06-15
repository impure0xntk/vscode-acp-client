import React, { useState, useEffect } from "react";
import type { SessionTabState } from "../store/sessionStore";
import { useSessionInfo } from "../hooks/useSessionInfo";
import { StatusIcon } from "./StatusIcon";
import type { StatusIconType, TurnOutcome } from "./StatusIcon";
import { UnreadBadge } from "./ui/UnreadBadge";

// ============================================================================
// SessionTab — compact horizontal tab for the tab bar
// ============================================================================
//
// Subscribes to its own session info via useSessionInfo(sessionKey).
// Only re-renders when this specific session's fields change — not when
// other sessions update.  elapsedMs is computed locally from lastResponseAt
// with a 1-second tick so the spinner color updates in real time.
//
// ═══ Responsibility split ═══
//   SessionTabs (parent) owns: drag/drop, hover timers, popup, unread computation
//   SessionTab (this)   owns:  status subscription, elapsedMs tick, click, close, layout
// ============================================================================

interface SessionTabProps {
  tab: SessionTabState;
  isActive: boolean;
  isHovered: boolean;
  /** Agent color from connected agents list */
  agentColor?: string;
  /** Unread message count */
  unreadCount: number;
  onClick: () => void;
  onClose: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

export function SessionTab({
  tab,
  isActive,
  isHovered,
  agentColor,
  unreadCount,
  onClick,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: SessionTabProps): React.ReactElement {
  const sessionKey = `${tab.agentId}:${tab.sessionId}`;
  const info = useSessionInfo(sessionKey);

  // Local tick for elapsedMs — recompute every second while running.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (info?.status !== "running" || !info?.lastResponseAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [info?.status, info?.lastResponseAt]);

  const rawStatus = info?.status ?? "idle";
  const lastOutcome: TurnOutcome | null = info?.lastTurnOutcome ?? null;

  // When idle with a turn outcome, show the outcome icon (✓/✗/⊘)
  // so the user can see what happened without needing a separate indicator.
  const status: StatusIconType =
    rawStatus === "running"
      ? "running"
      : rawStatus === "idle" && lastOutcome
        ? lastOutcome
        : rawStatus === "idle"
          ? "idle"
          : rawStatus;

  const elapsedMs =
    status === "running" && info?.lastResponseAt
      ? Date.now() - new Date(info.lastResponseAt).getTime()
      : undefined;

  const showCloseButton = isActive || isHovered;

  return (
    <div
      className={`session-tab${isActive ? " session-tab-active" : ""}${isHovered ? " session-tab-hovered" : ""}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Row 1: Status + Agent name — mirrors SessionOverviewCard header */}
      <div className="session-tab-row session-tab-row-agent">
        <StatusIcon status={status} elapsedMs={elapsedMs} />
        <span
          className="session-tab-agent-name"
          style={{ color: agentColor ?? "var(--vscode-descriptionForeground)" }}
          title={tab.agentId}
        >
          {tab.agentId}
        </span>
      </div>

      {/* Row 2: Session title — compact, no chips/preview/footer */}
      <div className="session-tab-row session-tab-row-session">
        <span className="session-tab-title" title={tab.title}>
          {tab.title}
        </span>
      </div>

      {/* Unread badge — absolute top-right, shared UnreadBadge */}
      <UnreadBadge
        count={unreadCount}
        hidden={isActive}
        className="session-tab-badge"
      />

      {/* Close button — visible on hover or active (not always, unlike card) */}
      <div
        className={`session-tab-actions${showCloseButton ? " session-tab-actions-visible" : ""}`}
      >
        <button
          className="session-tab-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close session"
        >
          ×
        </button>
      </div>
    </div>
  );
}
