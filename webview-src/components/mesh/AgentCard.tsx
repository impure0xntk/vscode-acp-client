import React, { useCallback } from "react";
import type {
  SessionInfoDTO,
  ConnectedAgentInfo,
} from "../../store/sessionStore";
import { StatusIcon } from "../ui/StatusIcon";
import { Icon } from "../../lib/icons";
import {
  fmtDuration,
  sessionColorGroup,
} from "../overview/SessionOverview/SessionOverviewCardBase";
import { fmt } from "../sessions/toolbar/formatting";
import {
  ELAPSED_WARNING_MS,
  ELAPSED_CRITICAL_MS,
} from "../../shared/constants";

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

function progressTier(elapsedMs: number): "normal" | "warning" | "critical" {
  if (elapsedMs >= ELAPSED_CRITICAL_MS) return "critical";
  if (elapsedMs >= ELAPSED_WARNING_MS) return "warning";
  return "normal";
}

function tierColor(tier: "normal" | "warning" | "critical"): string {
  if (tier === "critical") return "#ef5350";
  if (tier === "warning") return "#ffd54f";
  return "#4fc3f7";
}

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

  const elapsedMs =
    status === "running" && sessionInfo.lastResponseAt
      ? Date.now() - new Date(sessionInfo.lastResponseAt).getTime()
      : 0;
  const tier = progressTier(elapsedMs);
  const barColor = tierColor(tier);

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
      className={`agent-card${isSelected ? " agent-card--selected" : ""}`}
      data-status={status}
      data-color-group={colorGroup}
      onClick={onSelect}
      type="button"
    >
      {/* Header: status icon + agent name */}
      <div className="agent-card-header">
        <StatusIcon status={status} size="sm" elapsedMs={elapsedMs} />
        <span className="agent-card-name">
          {agent?.name ?? sessionInfo.agentId}
        </span>
      </div>

      {/* Status label */}
      <div className="agent-card-status">{STATUS_LABEL[status] ?? status}</div>

      {/* Progress bar (only when running) */}
      {status === "running" && (
        <div className="agent-card-progress">
          <div className="agent-card-progress-track">
            <div
              className="agent-card-progress-fill"
              style={{
                width: `${Math.min(ctxPct ?? 60, 100)}%`,
                background: barColor,
              }}
            />
          </div>
          <span className="agent-card-elapsed">{fmtDuration(elapsedMs)}</span>
        </div>
      )}

      {/* Token usage */}
      <div className="agent-card-tokens">
        <Icon name="brain" size="sm" />
        <span>{fmt(tokenTotal)}</span>
        {ctxPct !== null && (
          <span
            className={`agent-card-ctx-pct${ctxPct >= 85 ? " agent-card-ctx-pct--critical" : ctxPct >= 70 ? " agent-card-ctx-pct--warning" : ""}`}
          >
            {ctxPct}%
          </span>
        )}
      </div>

      {/* Quick actions */}
      <div className="agent-card-actions">
        {isCancelable && (
          <span
            className="agent-card-action-btn"
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
            className="agent-card-action-btn"
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
