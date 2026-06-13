import React from "react";
import type { SessionOverviewItem, ToolbarMeta, ResponsePreview } from "../../types";
import { Chip } from "../ui/Chip";
import { StatusIcon } from "../StatusIcon";
import type { StatusIconType } from "../StatusIcon";
import { elapsedColor } from "../../shared/elapsedColor";
import { Icon } from "../../lib/icons";

// ============================================================================
// Shared helpers
// ============================================================================

export const STATUS_STYLE_MAP: Record<
  string,
  { iconStatus: StatusIconType; accentClass: string }
> = {
  running: { iconStatus: "running", accentClass: "status-icon-running" },
  idle: { iconStatus: "idle", accentClass: "" },
  waiting: { iconStatus: "running", accentClass: "status-icon-running" },
  waiting_for_input: { iconStatus: "running", accentClass: "status-icon-running" },
  completed: { iconStatus: "completed", accentClass: "" },
  error: { iconStatus: "error", accentClass: "" },
  cancelled: { iconStatus: "cancelled", accentClass: "" },
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

function visualBar(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
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
      value: `${visualBar(pct / 100)} ${pct}%`,
      category: "metrics",
      contextColor: contextColor(pct / 100),
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
}: {
  session: SessionOverviewItem;
  className?: string;
}): React.ReactElement {
  const styleInfo =
    STATUS_STYLE_MAP[session.status] ?? STATUS_STYLE_MAP.idle;
  const elapsedMs = session.progress.elapsedMs;
  const showElapsedColor =
    styleInfo.iconStatus === "running" && elapsedMs > 0;
  const showRenderDelay =
    showElapsedColor && elapsedColor(elapsedMs) !== "normal";

  return (
    <div className={`soc-title-row ${className}`.trim()}>
      <StatusIcon status={styleInfo.iconStatus} elapsedMs={elapsedMs} />
      {showRenderDelay && (
        <span
          className="soc-agent-accent-border"
          style={{ borderColor: "#cca700" }}
        />
      )}
      <span className="soc-agent">{session.agentId}</span>
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

/** Footer: last-updated timestamp */
export function SessionOverviewFooter({
  session,
}: {
  session: SessionOverviewItem;
}): React.ReactElement {
  return (
    <div className="session-overview-card-footer">
      <span className="session-overview-card-timestamp">
        {new Date(session.updatedAt).toLocaleTimeString()}
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
