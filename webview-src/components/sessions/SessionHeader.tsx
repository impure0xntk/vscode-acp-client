import React, { useCallback, useState } from "react";
import { useLogger } from "../../hooks/useLogger";
import type { ChatMessage } from "../../types";
import type {
  ConnectedAgentInfo,
  SessionInfoDTO,
  SessionState,
} from "../../store/sessionStore";
import { Chip } from "../primitives/Chip";
import type { ToolbarMeta } from "../../types";

import { SectionDetailsPanel } from "./toolbar";
import { UserJumpNav } from "../message/UserJumpNav";
import { AgentBadge } from "../primitives/AgentBadge";
import { Icon, IconPin, IconPinFilled } from "../../lib/icons";

// ── props ─────────────────────────────────────────────────────────────────

export interface SessionHeaderProps {
  sessionKey: string | null;
  agentId?: string;
  agentName?: string;
  title?: string;
  connectedAgents?: ConnectedAgentInfo[];
  model?: string;
  mode?: string;
  cwd?: string;
  workspaceRoot?: string;
  status?: SessionState;
  onJumpToMessage?: (id: string) => void;
  sessionOverviewVisible?: boolean;
  onToggleSessionOverview?: () => void;
  sessionOverviewPosition?: "right" | "left";
  messages?: ChatMessage[];
  // Unified mode extensions:
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  onClick?: () => void;
  splitDirection?: "vertical" | "horizontal";
  messageCount?: number;
  info?: SessionInfoDTO;
  isActive?: boolean;
  color?: string;
  onForkSession?: () => void;
}

// ── component ─────────────────────────────────────────────────────────────

export const SessionHeader = React.memo(function SessionHeader({
  sessionKey,
  agentId,
  agentName,
  connectedAgents = [],
  model,
  mode,
  cwd,
  workspaceRoot,
  status,
  onJumpToMessage,
  sessionOverviewVisible,
  onToggleSessionOverview,
  sessionOverviewPosition = "right",
  messages = [],
  isPinned,
  onTogglePin,
  onClose,
  splitDirection = "horizontal",
  messageCount = 0,
  info,
  isActive,
  color,
  onForkSession,
}: SessionHeaderProps): React.ReactElement {
  const log = useLogger("SessionHeader");

  // Unified mode: compact header with accent bar
  if (color) {
    return renderUnifiedHeader();
  }

  // Classic mode: full toolbar
  return renderClassicToolbar();

  // ── Unified mode render ───────────────────────────────────────────────

  function renderUnifiedHeader(): React.ReactElement {
    const handleClick = useCallback(() => {
      log.debug("header click", { sessionKey, agentId, isActive });
    }, [log, sessionKey, agentId, isActive]);

    const handleTogglePin = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        log.debug("pin toggle", { sessionKey, isPinned: !isPinned });
        onTogglePin?.();
      },
      [onTogglePin, log, sessionKey, isPinned]
    );

    const handleClose = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        log.info("close section", { sessionKey });
        onClose?.();
      },
      [onClose, log, sessionKey]
    );

    const isHorizontal = splitDirection === "horizontal";
    const activeBg = isActive ? `${color}20` : `${color}14`;

    // Turn outcome chip only (no message/token count in header)
    const turnChip: ToolbarMeta | null = (() => {
      if (info?.status === "running") {
        return {
          key: "turn",
          label: "Turn",
          value: "Active",
          category: "session" as const,
          turnStatus: "running" as const,
        };
      }
      if (info?.lastTurnOutcome === "completed") {
        return {
          key: "turn",
          label: "Turn",
          value: "Done",
          category: "session" as const,
          turnStatus: "completed" as const,
        };
      }
      if (info?.lastTurnOutcome === "error") {
        return {
          key: "turn",
          label: "Turn",
          value: "Error",
          category: "session" as const,
          turnStatus: "error" as const,
        };
      }
      if (info?.lastTurnOutcome === "cancelled") {
        return {
          key: "turn",
          label: "Turn",
          value: "Cancelled",
          category: "session" as const,
          turnStatus: "cancelled" as const,
        };
      }
      return null;
    })();

    // Context usage chip — between turn chip and expand button
    const contextChip: ToolbarMeta | null = (() => {
      if (!info?.contextWindowMax || info.contextWindowMax <= 0) return null;
      const used = info.tokenUsage?.totalTokens ?? 0;
      const pct = Math.min(100, Math.round((used / info.contextWindowMax) * 100));
      const ctxColor: "normal" | "warning" | "critical" =
        pct >= 90 ? "critical" : pct >= 70 ? "warning" : "normal";
      return {
        key: "context",
        label: "Context",
        value: `${pct}%`,
        category: "metrics" as const,
        barPct: pct,
        contextColor: ctxColor,
      };
    })();

    const title = info?.sessionId ?? agentId ?? "";

    return (
      <div
        className={`unified-section-header${isActive ? " unified-section-header--active" : ""}`}
        data-color={color}
        data-is-horizontal={isHorizontal ? "true" : undefined}
        style={{ "--section-accent-color": color } as React.CSSProperties}
      >
        <div className="unified-section-header-accent" aria-hidden="true" />
        <button
          className="unified-section-header-bar"
          onClick={handleClick}
          type="button"
          style={{ backgroundColor: activeBg }}
        >
          <span className="unified-section-header-label">
            {agentId}: {title}
          </span>
          <span className="section-header-chips">
            {turnChip && <Chip meta={turnChip} />}
          </span>
        </button>

        <div className="unified-section-header-actions">
          {contextChip && <Chip meta={contextChip} />}
          <ExpandButton
            info={info}
            messageCount={messageCount}
            onForkSession={onForkSession}
          />
          {onTogglePin && (
            <button
              className={`unified-section-header-pin${isPinned ? " unified-section-header-pin--active" : ""}`}
              onClick={handleTogglePin}
              type="button"
              title={isPinned ? "Unpin session" : "Pin session"}
            >
              {isPinned ? <IconPinFilled size={14} /> : <IconPin size={14} />}
            </button>
          )}
          {onClose && (
            <button
              className="unified-section-header-close"
              onClick={handleClose}
              type="button"
              title="Close session"
            >
              <Icon name="close" size="sm" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Expand button (chevron + details panel) ─────────────────────────

  function ExpandButton({
    info,
    messageCount,
    onForkSession,
  }: {
    info: SessionInfoDTO;
    messageCount: number;
    onForkSession?: () => void;
  }): React.ReactElement {
    const [open, setOpen] = useState(false);

    const handleToggle = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        log.debug("toggle details", { sessionKey, open: !open });
        setOpen((v) => !v);
      },
      [log, sessionKey, open]
    );

    return (
      <div className="unified-section-header-expand-wrapper">
        <button
          className={`unified-section-header-expand${open ? " unified-section-header-expand--open" : ""}`}
          onClick={handleToggle}
          type="button"
          title={open ? "Hide details" : "Show details"}
          aria-expanded={open}
          aria-label="Toggle session details"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d={open ? "M3 9L7 5L11 9" : "M3 5L7 9L11 5"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div
          className={`unified-section-header-details${open ? " unified-section-header-details--open" : ""}`}
        >
          <div className="unified-section-header-details-body">
            <SectionDetailsPanel
              info={info}
              messageCount={messageCount}
              onForkSession={onForkSession}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Classic mode render ───────────────────────────────────────────────

  function renderClassicToolbar(): React.ReactElement {
    const displayCwd = cwd ?? workspaceRoot;
    const cwdLabel = displayCwd
      ? (displayCwd.split("/").pop() ?? displayCwd)
      : null;

    const overviewOnLeft = sessionOverviewPosition === "left";

    const overviewButton = onToggleSessionOverview ? (
      <button
        className={`top-toolbar-overview-btn${sessionOverviewVisible ? " active" : ""}`}
        onClick={onToggleSessionOverview}
        title="Toggle session overview"
      >
        <Icon name="list-tree" size="sm" />
      </button>
    ) : null;

    const agentColor = agentId
      ? connectedAgents.find((a) => a.agentId === agentId)?.color
      : undefined;

    return (
      <div className="top-toolbar">
        <div className="top-toolbar-left">
          {overviewOnLeft && overviewButton}
          <UserJumpNav
            messages={messages}
            onJumpTo={onJumpToMessage ?? (() => {})}
          />
        </div>
        <div className="top-toolbar-center">
          {agentId && agentName && (
            <AgentBadge
              agentId={agentId}
              agentName={agentName}
              agentColor={agentColor}
              className="top-toolbar-agent"
            />
          )}
          {cwdLabel && (
            <span className="top-toolbar-cwd" title={displayCwd ?? ""}>
              <Icon name="folder-opened" size="sm" /> {cwdLabel}
            </span>
          )}
          {model && status === "running" && (
            <span className="top-toolbar-model" title={model}>
              {model}
            </span>
          )}
          {mode && status === "running" && (
            <span className="top-toolbar-mode" title={mode}>
              {mode}
            </span>
          )}
        </div>
        <div className="top-toolbar-right">
          {!overviewOnLeft && overviewButton}
        </div>
      </div>
    );
  }
});
