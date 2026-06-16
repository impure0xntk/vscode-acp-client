import React, { useEffect, useState } from "react";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { sessionKeyOf } from "../../store/sessionStore";
import type { SessionTabState } from "../../store/sessionStore";
import { StatusIcon } from "../StatusIcon";
import type { StatusIconType, TurnOutcome } from "../StatusIcon";
import { UnreadBadge } from "../ui/UnreadBadge";
import { IconClose, IconPin, IconPinFilled } from "../../lib/icons";

export type LayoutMode = "single" | "split" | "grid";

// ============================================================================
// UnifiedSessionBar — session tab bar for UnifiedChatPanel
//
// Horizontal tabs with agent color, status icon, and close button.
// Includes a "+" button to create new sessions.
// ============================================================================

interface UnifiedSessionBarProps {
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  pinnedSessionKeys: string[];
  connectedAgents: { agentId: string; color?: string }[];
  onFocusChange: (key: string) => void;
  onClose: (key: string) => void;
  /** Create a new session (opens picker) */
  onNewSession: () => void;
  /** Current layout mode */
  layoutMode: LayoutMode;
  /** Current split direction */
  splitDirection: "vertical" | "horizontal";
  /** Layout mode change handler */
  onLayoutChange: (mode: LayoutMode) => void;
  /** Split direction change handler */
  onSplitDirectionChange: (dir: "vertical" | "horizontal") => void;
}

// ── Single tab component (compact, Classic SessionTab style) ────────────────

interface UnifiedTabProps {
  tab: SessionTabState;
  isActive: boolean;
  isPinned: boolean;
  agentColor?: string;
  unreadCount: number;
  onClick: () => void;
  onClose: () => void;
}

const UnifiedTab = React.memo(function UnifiedTab({
  tab,
  isActive,
  isPinned,
  agentColor,
  unreadCount,
  onClick,
  onClose,
}: UnifiedTabProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const sessionKey = sessionKeyOf(tab.agentId, tab.sessionId);
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

  return (
    <div
      className={`unified-session-bar-tab${isActive ? " unified-session-bar-tab--active" : ""}${isHovered ? " unified-session-bar-tab--hovered" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      style={{ borderLeft: `3px solid ${agentColor ?? "transparent"}` }}
    >
      <StatusIcon status={status} elapsedMs={elapsedMs} />
      <span
        className="unified-session-bar-tab-agent"
        style={{ color: agentColor ?? "var(--vscode-descriptionForeground)" }}
        title={tab.agentId}
      >
        {tab.agentId}
      </span>
      <span className="unified-session-bar-tab-title" title={tab.title}>
        {tab.title.length > 12 ? `${tab.title.slice(0, 12)}…` : tab.title}
      </span>
      {/* Pin icon — always reserves space; shows filled/outline SVG */}
      <span className="unified-session-bar-tab-pin" title={isPinned ? "Pinned" : ""}>
        {isPinned ? <IconPinFilled size={12} /> : <IconPin size={12} className="unified-session-bar-tab-pin--empty" />}
      </span>
      <UnreadBadge count={unreadCount} hidden={isActive} className="unified-session-bar-tab-badge" />
      {/* Close button — always reserves space; visibility toggled via CSS */}
      <button
        className={`unified-session-bar-tab-close${isActive || isHovered ? " unified-session-bar-tab-close--visible" : ""}`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title="Close"
        type="button"
      >
        <IconClose size={12} />
      </button>
    </div>
  );
});

// ── Bar container ──────────────────────────────────────────────────────────

export const UnifiedSessionBar = React.memo(function UnifiedSessionBar({
  tabs,
  activeSessionKey,
  pinnedSessionKeys,
  connectedAgents,
  onFocusChange,
  onClose,
  onNewSession,
  layoutMode,
  splitDirection,
  onLayoutChange,
  onSplitDirectionChange,
}: UnifiedSessionBarProps): React.ReactElement {
  return (
    <div className="unified-session-bar">
      <div className="unified-session-bar-scroll">
        {tabs.map((tab) => {
          const key = sessionKeyOf(tab.agentId, tab.sessionId);
          const isActive = key === activeSessionKey;
          const isPinned = pinnedSessionKeys.includes(key);
          const agent = connectedAgents.find((a) => a.agentId === tab.agentId);

          return (
            <UnifiedTab
              key={key}
              tab={tab}
              isActive={isActive}
              isPinned={isPinned}
              agentColor={agent?.color}
              unreadCount={0}
              onClick={() => onFocusChange(key)}
              onClose={() => onClose(key)}
            />
          );
        })}
      </div>

      {/* Layout mode toggle — right edge of session bar */}
      <div className="unified-session-bar-layout" role="group" aria-label="Layout mode">
        <button
          className={`unified-session-bar-layout-btn${layoutMode === "single" ? " unified-session-bar-layout-btn--active" : ""}`}
          onClick={() => onLayoutChange("single")}
          type="button"
          title="Single view"
        >
          1
        </button>
        <button
          className={`unified-session-bar-layout-btn${layoutMode === "split" && splitDirection === "horizontal" ? " unified-session-bar-layout-btn--active" : ""}`}
          onClick={() => { onLayoutChange("split"); onSplitDirectionChange("horizontal"); }}
          type="button"
          title="Side by side"
        >
          ║
        </button>
        <button
          className={`unified-session-bar-layout-btn${layoutMode === "split" && splitDirection === "vertical" ? " unified-session-bar-layout-btn--active" : ""}`}
          onClick={() => { onLayoutChange("split"); onSplitDirectionChange("vertical"); }}
          type="button"
          title="Stacked"
        >
          ═
        </button>
        <button
          className={`unified-session-bar-layout-btn${layoutMode === "grid" ? " unified-session-bar-layout-btn--active" : ""}`}
          onClick={() => onLayoutChange("grid")}
          type="button"
          title="Grid view"
        >
          ▦
        </button>
      </div>

      {/* Separator between layout toggle and session actions */}
      <div className="unified-session-bar-sep" aria-hidden="true" />

      {/* New session button */}
      <button
        className="unified-session-bar-new-btn"
        onClick={onNewSession}
        type="button"
        title="New session"
      >
        <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 500 }}>+</span>
      </button>
    </div>
  );
});
