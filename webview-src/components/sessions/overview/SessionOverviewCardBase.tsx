import React from "react";
import type {
  SessionOverviewItem,
  ToolbarMeta,
  ResponsePreview,
} from "../../../types";
import type { TurnOutcome } from "../../primitives/StatusIcon";
import { Chip } from "../../primitives/Chip";
import { AgentBadge } from "../../primitives/AgentBadge";
import { StatusIcon } from "../../primitives/StatusIcon";
import type { StatusIconType } from "../../primitives/StatusIcon";
import {
  ELAPSED_WARNING_MS,
  ELAPSED_CRITICAL_MS,
} from "../../../shared/constants";
import { Icon } from "../../../lib/icons";
import { snapshotToOverviewItem } from "../../../store/sessionStore";
import { ResponsePreviewList } from "./ResponsePreviewList";
export { snapshotToOverviewItem, ResponsePreviewList };

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
  lastTurnOutcome: TurnOutcome | null
): StatusIconType {
  if (status === "running") return "running";
  if (lastTurnOutcome) return lastTurnOutcome;
  if (
    status === "idle" ||
    status === "waiting" ||
    status === "waiting_for_input"
  )
    return status;
  return "idle";
}

export const STATUS_STYLE_MAP: Record<
  string,
  {
    iconStatus: StatusIconType;
    accentClass: string;
    colorGroup: SessionColorGroup;
  }
> = {
  running: {
    iconStatus: "running",
    accentClass: "status-icon-running",
    colorGroup: "active",
  },
  idle: { iconStatus: "idle", accentClass: "", colorGroup: "done" },
  waiting: {
    iconStatus: "waiting",
    accentClass: "status-icon-waiting",
    colorGroup: "waiting",
  },
  waiting_for_input: {
    iconStatus: "waiting",
    accentClass: "status-icon-waiting",
    colorGroup: "waiting",
  },
  completed: { iconStatus: "completed", accentClass: "", colorGroup: "done" },
  error: { iconStatus: "error", accentClass: "", colorGroup: "done" },
  cancelled: { iconStatus: "cancelled", accentClass: "", colorGroup: "done" },
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

export interface CardProps {
  session: SessionOverviewItem;
  isExpanded: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onCancel: () => void;
}

/** Header: agent name → title — shared between card and popup */
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
  return (
    <div
      className={`flex items-center gap-1 min-w-0 overflow-hidden ${className}`.trim()}
    >
      <AgentBadge
        agentId={session.agentId}
        agentColor={agentColor}
        className="shrink-0 text-[9px] font-normal text-fg-muted font-[var(--font-ui)] max-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap opacity-70"
      />
      <span className="flex-1 min-w-0 text-[11px] font-medium text-fg-primary overflow-hidden text-ellipsis whitespace-nowrap">
        {session.title}
      </span>
      {session.model && (
        <span className="shrink-0 text-[9px] text-fg-muted font-[var(--font-mono)] max-w-[60px] overflow-hidden text-ellipsis whitespace-nowrap">
          {session.model}
        </span>
      )}
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
    <div className="flex flex-wrap gap-0.5 mt-1">
      {chips.map((c) => (
        <Chip key={c.key} meta={c} className="text-[10px] px-1 py-0.5" />
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
    <div className="flex items-center justify-between mt-1 pt-1 border-t border-[color-mix(in_srgb,var(--border)_30%,transparent)]">
      <span className="text-[9px] text-fg-muted font-[var(--font-mono)]">
        {new Date(ts).toLocaleTimeString()}
      </span>
    </div>
  );
}
