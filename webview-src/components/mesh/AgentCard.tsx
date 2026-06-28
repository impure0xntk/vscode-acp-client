import React, { useCallback } from "react";
import type {
  SessionInfoDTO,
  ConnectedAgentInfo,
} from "../../store/sessionStore";
import { StatusIcon } from "../primitives/StatusIcon";
import { Icon } from "../../lib/icons";
import {
  fmtDuration,
  sessionColorGroup,
} from "../sessions/overview/SessionOverviewCardBase";
import { fmt } from "../sessions/toolbar/formatting";

interface AgentCardProps {
  sessionInfo: SessionInfoDTO;
  agent?: ConnectedAgentInfo;
  isSelected: boolean;
  onSelect: () => void;
  onCancel: () => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  running: "Active",
  idle: "Idle",
  waiting: "Waiting",
  waiting_for_input: "Waiting for Input",
  completed: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

export function AgentCard({
  sessionInfo,
  agent,
  isSelected,
  onSelect,
  onCancel,
  onClose,
}: AgentCardProps): React.ReactElement {
  const status = sessionInfo.status;
  const isCancelable =
    status === "running" ||
    status === "waiting" ||
    status === "waiting_for_input";
  const isTerminal =
    status === "completed" || status === "error" || status === "cancelled";
  const colorGroup = sessionColorGroup(status);

  const tokenTotal = sessionInfo.tokenUsage.totalTokens;
  const ctxMax = sessionInfo.contextWindowMax;
  const ctxPct = ctxMax ? Math.round((tokenTotal / ctxMax) * 100) : null;

  const handleCancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCancel();
    },
    [onCancel]
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  return (
    <button
      className={`agent-card flex flex-col gap-0.5 p-2 border border-transparent rounded-[4px] bg-bg-primary cursor-pointer text-left hover:bg-accent-hover focus-visible:outline focus-visible:outline-accent focus-visible:outline-offset-1 min-w-[140px] max-w-[200px] flex-shrink-0 ${isSelected ? "border-[color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" : ""}${status === "completed" ? " border-l-success" : status === "error" ? " border-l-error" : status === "cancelled" ? " border-l-fg-muted" : status === "waiting" || status === "waiting_for_input" ? " border-l-[#ffd54f]" : ""}`}
      data-status={status}
      data-color-group={colorGroup}
      onClick={onSelect}
      type="button"
    >
      {/* Header: status icon + agent name */}
      <div className="flex items-center gap-1 min-w-0">
        <StatusIcon status={status} size="sm" />
        <span className="flex-1 min-w-0 text-[10px] font-semibold font-mono text-fg-primary overflow-hidden text-ellipsis whitespace-nowrap">
          {agent?.name ?? sessionInfo.agentId}
        </span>
      </div>

      {/* Status label */}
      <div className="flex-shrink-0 text-[9px] text-fg-muted">{STATUS_LABEL[status] ?? status}</div>

      {/* Progress bar (only when running) */}
      {status === "running" && (
        <div className="flex items-center gap-1">
          <div className="flex-1 h-[3px] rounded-[1.5px] bg-[color-mix(in_srgb,var(--fg-muted)_15%,transparent)] overflow-hidden">
            <div
              className="h-full rounded-[1.5px] bg-[#4fc3f7]"
              style={{ width: `${Math.min(ctxPct ?? 60, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Token usage */}
      <div className="flex items-center gap-[3px] text-[9px] text-fg-muted font-mono">
        <Icon name="brain" size="sm" />
        <span>{fmt(tokenTotal)}</span>
        {ctxPct !== null && (
          <span
            className={`ml-auto text-[9px] font-mono ${ctxPct >= 85 ? "text-[#ef5350]" : ctxPct >= 70 ? "text-[#ffd54f]" : "text-fg-muted"}`}
          >
            {ctxPct}%
          </span>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-0.5 mt-px">
        {isCancelable && (
          <span
            className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-accent-hover hover:text-fg-primary"
            onClick={handleCancel}
            title="Cancel"
            role="button"
            tabIndex={0}
          >
            <Icon name="circle-slash" size="sm" />
          </span>
        )}
        {isTerminal && (
          <span
            className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-accent-hover hover:text-fg-primary"
            onClick={handleClose}
            title="Close"
            role="button"
            tabIndex={0}
          >
            <Icon name="close" size="sm" />
          </span>
        )}
      </div>
    </button>
  );
}
