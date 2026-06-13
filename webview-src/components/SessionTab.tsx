import React from "react";
import type { SessionTabState } from "../hooks/useSessionContext";
import { StatusIcon } from "./StatusIcon";
import type { StatusIconType } from "./StatusIcon";
import { UnreadBadge } from "./ui/UnreadBadge";

// ============================================================================
// SessionTab — compact horizontal tab for the tab bar
// ============================================================================
//
// ┌─ SessionTab ──────────────────────────────────────────────────┐
// │ [●] agent-name          ← StatusIcon + AgentBadge (shared)   │
// │ session-title           ← title only, no chips/preview       │
// │                                          [×] ← hover/active  │
// └───────────────────────────────────────────────────────────────┘
//
// ═══ Design contrast: SessionTab vs SessionOverviewCard ═══
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
//   SessionTabs (parent) owns: drag/drop, hover timers, popup, unread computation
//   SessionTab (this)   owns:  click, close, hover visual, layout
//
// Drag/drop is handled by the parent wrapper <div>, not by SessionTab itself.
// ============================================================================

interface SessionTabProps {
  tab: SessionTabState;
  isActive: boolean;
  isHovered: boolean;
  /** Pre-resolved status from sessionInfoMap (parent reads via getState()) */
  status: StatusIconType;
  /** Elapsed time for running indicator (ms) */
  elapsedMs?: number;
  /** Agent color from connected agents list */
  agentColor?: string;
  /** Optional agent icon (emoji) */
  agentIcon?: string;
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
  status,
  elapsedMs,
  agentColor,
  agentIcon,
  unreadCount,
  onClick,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: SessionTabProps): React.ReactElement {
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
        {agentIcon ? (
          <span className="session-tab-agent-icon">{agentIcon}</span>
        ) : (
          <span
            className="session-tab-agent-name"
            style={{ color: agentColor ?? "var(--vscode-descriptionForeground)" }}
            title={tab.agentId}
          >
            {tab.agentId}
          </span>
        )}
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
