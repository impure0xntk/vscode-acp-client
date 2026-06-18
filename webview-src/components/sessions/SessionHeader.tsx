import React, { useCallback } from "react";
import { useLogger } from "../../hooks/useLogger";
import type { ChatMessage } from "../../types";
import type {
  ConnectedAgentInfo,
  SessionInfoDTO,
} from "../../store/sessionStore";
import { Chip } from "../ui/Chip";
import type { ToolbarMeta } from "../../types";
import { fmt, visualBar, contextColor } from "./toolbar";
import { UserJumpNav } from "../message/UserJumpNav";
import { AgentBadge } from "../ui/AgentBadge";
import { Icon, IconPin, IconPinFilled } from "../../lib/icons";

// ── props ─────────────────────────────────────────────────────────────────

export interface SessionHeaderProps {
  sessionKey: string | null;
  agentId?: string;
  agentName?: string;
  connectedAgents?: ConnectedAgentInfo[];
  model?: string;
  mode?: string;
  cwd?: string;
  workspaceRoot?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled" | "warning";
  onJumpToMessage?: (id: string) => void;
  sessionOverviewVisible?: boolean;
  onToggleSessionOverview?: () => void;
  sessionOverviewPosition?: "right" | "left";
  messages?: ChatMessage[];
  // Unified mode extensions:
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  splitDirection?: "vertical" | "horizontal";
  messageCount?: number;
  info?: SessionInfoDTO;
  isActive?: boolean;
  color?: string;
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
  splitDirection = "vertical",
  messageCount = 0,
  info,
  isActive,
  color,
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

    // Build chips (mirrors BottomToolbar chip-building logic)
    const total = info
      ? info.tokenUsage.inputTokens + info.tokenUsage.outputTokens
      : 0;
    const ratio =
      info?.contextWindowMax && total > 0
        ? Math.min(total / info.contextWindowMax, 1)
        : 0;

    const chips: ToolbarMeta[] = [];

    if (info?.mode && info.status === "running") {
      chips.push({
        key: "mode",
        label: "Mode",
        value: info.mode,
        category: "runtime",
        modeIcon: info.mode,
      });
    }
    if (info?.model && info.status === "running") {
      chips.push({
        key: "model",
        label: "Model",
        value: info.model,
        category: "runtime",
      });
    }
    if (messageCount > 0) {
      chips.push({
        key: "msgs",
        label: "Messages",
        value: `msg:${messageCount}`,
        category: "metrics",
      });
    }

    chips.push({
      key: "tokens",
      label: "Tokens",
      value: `\u2191${fmt(info?.tokenUsage.inputTokens ?? 0)} \u2193${fmt(info?.tokenUsage.outputTokens ?? 0)}`,
      category: "metrics",
    });

    if (info?.contextWindowMax && total > 0) {
      const pct = visualBar(ratio);
      const contextChip: ToolbarMeta = {
        key: "context",
        label: "Context",
        value: `${pct}%`,
        category: "metrics",
        contextColor: contextColor(ratio),
        barPct: Number(pct),
      };
      const tokenIdx = chips.findIndex((c) => c.key === "tokens");
      if (tokenIdx >= 0) {
        chips.splice(tokenIdx, 0, contextChip);
      } else {
        chips.push(contextChip);
      }
    }

    // Turn outcome chip
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
            {chips.map((c) => (
              <Chip key={c.key} meta={c} />
            ))}
          </span>
        </button>

        <div className="unified-section-header-actions">
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
