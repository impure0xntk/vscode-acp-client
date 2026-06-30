import React, { useCallback } from "react";
import { StatusIcon } from "../../primitives/StatusIcon";
import type { StatusIconType } from "../../primitives/StatusIcon";
import { UnreadBadge } from "../../primitives/UnreadBadge";
import { IconClose, IconClipboardList } from "../../../lib/icons";
import type { SupervisorViewMode } from "./supervisor-types";
import { getLogger } from "../../../lib/logger";

/** Coerce an arbitrary session-status string to a valid StatusIconType. */
function toIconStatus(s: string): StatusIconType {
  if (s === "running" || s === "cancelling" || s === "idle") return s;
  if (s === "completed" || s === "error" || s === "cancelled") return s;
  if (s === "waiting" || s === "waiting_for_input") return s;
  return "idle";
}

const log = getLogger("supervisor.tabBar");

interface TeamSessionTab {
  sessionKey: string;
  agentId: string;
  sessionId: string;
  role: "lead" | "worker" | "reviewer";
  status: string;
  title: string;
  agentColor?: string;
  hasUnread: boolean;
}

interface Props {
  viewMode: SupervisorViewMode;
  focusSessionKey: string | null;
  teamId: string | null;
  teamSessions: TeamSessionTab[];
  onOverview: () => void;
  onFocusSession: (sessionKey: string) => void;
  onCloseSession: (sessionKey: string) => void;
  onNewSession: () => void;
}

export const SupervisorTabBar = React.memo(function SupervisorTabBar({
  viewMode,
  focusSessionKey,
  teamId,
  teamSessions,
  onOverview,
  onFocusSession,
  onCloseSession,
  onNewSession,
}: Props): React.ReactElement {
  const isOverviewActive = viewMode === "overview";

  const handleOverviewClick = useCallback(() => {
    log.debug("overview tab clicked");
    onOverview();
  }, [onOverview]);

  const handleSessionClick = useCallback(
    (sessionKey: string) => {
      log.debug("session tab clicked", { sessionKey });
      onFocusSession(sessionKey);
    },
    [onFocusSession]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent, sessionKey: string) => {
      e.stopPropagation();
      log.debug("close tab", { sessionKey });
      onCloseSession(sessionKey);
    },
    [onCloseSession]
  );

  return (
    <div className="flex shrink-0 items-center gap-1 p-[4px 8px] overflow-x-auto bg-bg-secondary border-b border-border">
      <button
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] whitespace-nowrap cursor-pointer shrink-0 transition-all duration-150 border border-transparent ${
          isOverviewActive
            ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-fg-primary font-semibold"
            : "text-fg-secondary hover:bg-accent-hover"
        }`}
        onClick={handleOverviewClick}
        type="button"
        title="Team overview"
      >
        <IconClipboardList size={14} />
        <span>Overview</span>
      </button>

      <div className="w-px h-4 bg-border mx-1 shrink-0" />

      {focusSessionKey &&
        teamSessions
          .filter((t) => t.sessionKey === focusSessionKey)
          .map((tab) => {
            const isActive =
              viewMode === "focus" && focusSessionKey === tab.sessionKey;
            return (
              <div
                key={tab.sessionKey}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] whitespace-nowrap cursor-pointer shrink-0 transition-all duration-150 border border-transparent ${
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-fg-primary font-semibold"
                    : "text-fg-secondary hover:bg-accent-hover"
                }`}
                style={{
                  borderLeft: `3px solid ${tab.agentColor ?? "transparent"}`,
                }}
                onClick={() => handleSessionClick(tab.sessionKey)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    handleSessionClick(tab.sessionKey);
                }}
              >
                <StatusIcon status={toIconStatus(tab.status)} size="sm" />
                <span
                  className="font-semibold font-mono text-[11px] shrink-0"
                  style={{
                    color:
                      tab.agentColor ?? "var(--vscode-descriptionForeground)",
                  }}
                  title={tab.agentId}
                >
                  {tab.agentId}
                </span>
                <span className="max-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap shrink min-w-0 text-[11px] text-fg-secondary">
                  {tab.title.length > 12
                    ? `${tab.title.slice(0, 12)}…`
                    : tab.title}
                </span>
                <UnreadBadge
                  count={tab.hasUnread ? 1 : 0}
                  hidden={isActive}
                  className="shrink-0"
                />
                <button
                  className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer shrink-0 transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:text-error"
                  onClick={(e) => handleClose(e, tab.sessionKey)}
                  title="Close"
                  type="button"
                >
                  <IconClose size={12} />
                </button>
              </div>
            );
          })}

      <div className="flex-1" />

      <button
        className="shrink-0 flex items-center justify-center w-7 h-full min-h-[32px] border-none bg-transparent text-fg-secondary text-base cursor-pointer transition-colors duration-150"
        onClick={onNewSession}
        type="button"
        title="New session"
      >
        <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 500 }}>+</span>
      </button>
    </div>
  );
});
