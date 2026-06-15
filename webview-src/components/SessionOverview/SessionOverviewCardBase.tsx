import React from "react";
import type { SessionOverviewItem, ToolbarMeta, ResponsePreview } from "../../types";
import type { TurnOutcome } from "../StatusIcon";
import { Chip } from "../ui/Chip";
import { AgentBadge } from "../ui/AgentBadge";
import { StatusIcon } from "../StatusIcon";
import type { StatusIconType } from "../StatusIcon";
import { ELAPSED_WARNING_MS, ELAPSED_CRITICAL_MS } from "../../shared/constants";
import { Icon } from "../../lib/icons";
import { snapshotToOverviewItem } from "../../store/sessionStore";
export { snapshotToOverviewItem };


// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Shared color group for Spinner and Session Overview.
 * - active:  agent responding → #4fc3f7 blue
 * - waiting: agent waiting for response → #ffd54f yellow
 * - done:   finished → no color (uses status-specific color)
 */
export type SessionColorGroup = "active" | "waiting" | "done";

export function sessionColorGroup(status: string): SessionColorGroup {
  if (status === "running") return "active";
  if (status === "waiting" || status === "waiting_for_input") return "waiting";
  return "done";
}

export const COLOR_GROUP_ACCENT: Record<SessionColorGroup, string> = {
  active: "#4fc3f7",
  waiting: "#ffd54f",
  done: "transparent",
};

/**
 * Returns the same elapsed-time tier as Spinner.
 * - "normal"  : < 10s
 * - "warning" : ≥ 10s
 * - "critical": ≥ 30s
 */
export type ElapsedTier = "normal" | "warning" | "critical";

export function elapsedTier(elapsedMs: number): ElapsedTier {
  if (elapsedMs >= ELAPSED_CRITICAL_MS) return "critical";
  if (elapsedMs >= ELAPSED_WARNING_MS) return "warning";
  return "normal";
}

/**
 * Resolve the effective icon status for a session overview item.
 * When idle with a lastTurnOutcome, show the turn outcome icon
 * so the user can see what happened in the most recent turn.
 */
export function effectiveStatus(
  status: string,
  lastTurnOutcome: TurnOutcome | null,
): StatusIconType {
  if (status === "running") return "running";
  if (lastTurnOutcome) return lastTurnOutcome;
  if (status === "idle" || status === "waiting" || status === "waiting_for_input") return status;
  return "idle";
}

export const STATUS_STYLE_MAP: Record<
  string,
  { iconStatus: StatusIconType; accentClass: string; colorGroup: SessionColorGroup }
> = {
  running:           { iconStatus: "running",  accentClass: "status-icon-running",          colorGroup: "active" },
  idle:              { iconStatus: "idle",     accentClass: "",                             colorGroup: "done" },
  waiting:           { iconStatus: "waiting",  accentClass: "status-icon-waiting",         colorGroup: "waiting" },
  waiting_for_input: { iconStatus: "waiting",  accentClass: "status-icon-waiting",         colorGroup: "waiting" },
  completed:         { iconStatus: "completed", accentClass: "",                             colorGroup: "done" },
  error:             { iconStatus: "error",     accentClass: "",                             colorGroup: "done" },
  cancelled:         { iconStatus: "cancelled", accentClass: "",                             colorGroup: "done" },
};

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function contextColor(ratio: number): "normal" | "warning" | "critical" {
  if (ratio >= 0.85) return "critical";
  if (ratio >= 0.7) return "warning";
  return "normal";
}

export function sessionToChips(session: SessionOverviewItem): ToolbarMeta[] {
  const chips: ToolbarMeta[] = [];
  const { progress } = session;

  if (progress.elapsedMs > 0) {
    chips.push({
      key: "dur",
      label: "Duration",
      value: fmtDuration(progress.elapsedMs),
      category: "metrics",
    });
  }

  chips.push({
    key: "tokens",
    label: "Tokens",
    value: `↑${fmt(progress.tokenUsage.input)} ↓${fmt(progress.tokenUsage.output)}`,
    category: "metrics",
  });

  if (progress.contextWindow) {
    const pct = progress.contextWindow.percentage;
    chips.push({
      key: "context",
      label: "Context",
      value: `${pct}%`,
      category: "metrics",
      contextColor: contextColor(pct / 100),
      barPct: pct,
    });
  }

  if (progress.messageCount > 0) {
    chips.push({
      key: "msgs",
      label: "Messages",
      value: `msg:${progress.messageCount}`,
      category: "metrics",
    });
  }

  return chips;
}

// ============================================================================
// Card Props
// ============================================================================

export interface CardProps {
  session: SessionOverviewItem;
  isExpanded: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onCancel: () => void;
}

// ============================================================================
// Shared sub-components
// ============================================================================

/** Header: spinner → agent name → title — shared between card and popup */
export function SessionOverviewHeader({
  session,
  className = "",
  agentColor,
}: {
  session: SessionOverviewItem;
  className?: string;
  /** Optional agent color for the badge dot */
  agentColor?: string;
}): React.ReactElement {
  const iconStatus = effectiveStatus(session.status, session.lastTurnOutcome);
  const styleInfo = STATUS_STYLE_MAP[session.status] ?? STATUS_STYLE_MAP.idle;
  const elapsedMs = session.progress.elapsedMs;

  return (
    <div className={`soc-title-row ${className}`.trim()}>
      <StatusIcon status={iconStatus} elapsedMs={elapsedMs} colorGroup={styleInfo.colorGroup} />
      <AgentBadge agentId={session.agentId} agentColor={agentColor} className="soc-agent" />
      <span className="soc-title">{session.title}</span>
      {session.model && <span className="soc-model">{session.model}</span>}
    </div>
  );
}

/** Chips row — shared between card and popup */
export function SessionOverviewChips({
  session,
}: {
  session: SessionOverviewItem;
}): React.ReactElement {
  const chips = sessionToChips(session);
  return (
    <div className="session-overview-chips">
      {chips.map((c) => (
        <Chip key={c.key} meta={c} />
      ))}
    </div>
  );
}

/** Footer: last-response timestamp (when agent last produced output) */
export function SessionOverviewFooter({
  session,
}: {
  session: SessionOverviewItem;
}): React.ReactElement {
  const ts = session.lastResponseAt ?? session.createdAt;
  return (
    <div className="session-overview-card-footer">
      <span className="session-overview-card-timestamp">
        {new Date(ts).toLocaleTimeString()}
      </span>
    </div>
  );
}

// ============================================================================
// Response Preview — compact inline list (card & popup)
// ============================================================================

const STATUS_ICON: Record<string, string> = {
  completed: "pass-filled",
  loading: "loading",
  failed: "error",
};

export function ResponsePreviewList({
  responses,
  maxItems = 5,
  className = "",
}: {
  responses: ResponsePreview[];
  maxItems?: number;
  className?: string;
}): React.ReactElement | null {
  if (responses.length === 0) return null;
  const items = responses.slice(-maxItems);

  return (
    <div className={`response-preview-list ${className}`.trim()}>
      {items.map((r) => (
        <div
          key={r.messageId}
          className={`response-preview-item response-preview-item--${r.role}`}
        >
          {r.status && (
            <Icon
              name={STATUS_ICON[r.status] ?? "loading"}
              className="response-preview-status"
              size="sm"
            />
          )}
          <span className="response-preview-text" title={r.preview}>
            {r.preview}
          </span>
        </div>
      ))}
    </div>
  );
}
