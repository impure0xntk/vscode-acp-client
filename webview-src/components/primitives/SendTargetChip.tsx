import React from "react";
import type { SendTarget } from "../../types";
import { StatusIcon } from "./StatusIcon";

// ── Props ──────────────────────────────────────────────────────────

export interface SendTargetChipProps {
  target: SendTarget;
  onRemove: () => void;
  onClick?: () => void;
}

// ── Context chip helper ────────────────────────────────────────────

function ContextBar({ target }: { target: SendTarget }): React.ReactElement | null {
  const { tokenUsage, contextWindowMax } = target;
  if (!tokenUsage) return null;

  const pct =
    contextWindowMax && contextWindowMax > 0
      ? Math.round((tokenUsage.totalTokens / contextWindowMax) * 100)
      : null;

  const color =
    pct !== null
      ? pct >= 90
        ? "ctx-critical"
        : pct >= 70
          ? "ctx-warning"
          : "ctx-normal"
      : "ctx-normal";

  const fillHeight = pct !== null ? Math.max(10, Math.min(100, pct)) : 0;
  const title = pct !== null
    ? `${pct}% (${formatTokens(tokenUsage.totalTokens)} / ${formatTokens(contextWindowMax ?? 0)})`
    : `${formatTokens(tokenUsage.totalTokens)} tokens used`;

  return (
    <span
      className={`send-target-context-bar send-target-context-bar--${color}`}
      title={title}
    >
      <span
        className="send-target-context-bar-fill"
        style={{ height: `${fillHeight}%` }}
      />
    </span>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Component ───────────────────────────────────────────────────────

/**
 * SendTargetChip — displays a single send target with status indicator
 * and context usage chip.
 *
 * Layout:
 * ┌──────────────────────────────────┐
 * │ ✕ Claude:refactor [42%]         │
 * │   (idle)                         │
 * └──────────────────────────────────┘
 *
 * Status colors: idle=gray, running=blue+spin, completed=green, error=red
 * Context colors: normal=green, warning=yellow, critical=red
 */
export function SendTargetChip({
  target,
  onRemove,
  onClick,
}: SendTargetChipProps): React.ReactElement {
  const status = target.status ?? "idle";

  return (
    <span
      className={`send-target-chip send-target-chip--${status}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={`${target.agentId}:${target.sessionId}`}
    >
      <StatusIcon status={status} size="sm" />
      <span className="send-target-chip-label">{target.label}</span>
      <ContextBar target={target} />
      <button
        className="send-target-chip-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove send target"
        aria-label={`Remove ${target.label}`}
      >
        ✕
      </button>
    </span>
  );
}
