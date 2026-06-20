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
        className={`flex items-center gap-1 shrink-0 bg-[var(--bg-secondary)] border-b border-[var(--border)] min-h-[32px] relative${isActive ? " unified-section-header--active" : ""}`}
        data-color={color}
        data-is-horizontal={isHorizontal ? "true" : undefined}
        style={{ "--section-accent-color": color } as React.CSSProperties}
      >
        <div className="absolute top-0 bottom-0 left-0 w-[3px] bg-[var(--section-accent-color,var(--accent))] shrink-0 z-10 pointer-events-none" aria-hidden="true" />
        <button
          className="flex-1 flex items-center gap-2 px-2 py-1 border-none bg-transparent text-[var(--fg-primary)] text-[11px] cursor-pointer text-left min-w-0 transition-colors duration-150"
          onClick={handleClick}
          type="button"
          style={{ backgroundColor: activeBg }}
        >
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-mono text-[var(--fg-primary)]">
            {agentId}: {title}
          </span>
          <span className="inline-flex items-center gap-[3px] ml-auto shrink-0 overflow-hidden">
            {turnChip && <Chip meta={turnChip} />}
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {contextChip && <Chip meta={contextChip} />}
          <ExpandButton
            info={info}
            messageCount={messageCount}
            onForkSession={onForkSession}
          />
          {onTogglePin && (
            <button
              className={`inline-flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-[var(--fg-muted)] cursor-pointer hover:bg-[var(--accent-hover)] hover:text-[var(--fg-primary)]${isPinned ? " text-[var(--accent)]" : ""}`}
              onClick={handleTogglePin}
              type="button"
              title={isPinned ? "Unpin session" : "Pin session"}
            >
              {isPinned ? <IconPinFilled size={14} /> : <IconPin size={14} />}
            </button>
          )}
          {onClose && (
            <button
              className="inline-flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-[var(--fg-muted)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:text-[var(--error)]"
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
      <div className="relative inline-flex items-center">
        <button
          className={`inline-flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-[var(--fg-muted)] cursor-pointer transition-transform duration-150 hover:bg-[var(--accent-hover)] hover:text-[var(--fg-primary)]${open ? " rotate-180" : ""}`}
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
          className={`absolute top-full right-0 z-50 mt-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded shadow-[0_4px_16px_rgba(0,0,0,0.3)] min-w-[260px] transition-all duration-150${open ? " opacity-100 visible translate-y-0" : " opacity-0 invisible -translate-y-1"}`}
        >
          <div className="px-[10px] py-2 max-h-[300px] overflow-y-auto">
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
      <div className="flex items-center justify-between px-[14px] py-0.5 min-h-[26px] bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-1.5 shrink-0">
          {overviewOnLeft && overviewButton}
          <UserJumpNav
            messages={messages}
            onJumpTo={onJumpToMessage ?? (() => {})}
          />
        </div>
        <div className="flex items-center gap-2 flex-[0_1_auto] justify-center min-w-0 overflow-hidden">
          {agentId && agentName && (
            <AgentBadge
              agentId={agentId}
              agentName={agentName}
              agentColor={agentColor}
              className="text-[11px] font-medium font-mono max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap text-[var(--fg-muted)]"
            />
          )}
          {cwdLabel && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--fg-muted)] max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap" title={displayCwd ?? ""}>
              <Icon name="folder-opened" size="sm" /> {cwdLabel}
            </span>
          )}
          {model && status === "running" && (
            <span className="font-mono text-[11px] text-[var(--fg-muted)] max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap" title={model}>
              {model}
            </span>
          )}
          {mode && status === "running" && (
            <span className="font-mono text-[11px] text-[var(--fg-muted)] max-w-[60px] overflow-hidden text-ellipsis whitespace-nowrap" title={mode}>
              {mode}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!overviewOnLeft && overviewButton}
        </div>
      </div>
    );
  }
});
