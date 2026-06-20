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
      className={`ctx-bar ctx-bar--${color}`}
      title={title}
    >
      <span
        className="ctx-bar-fill"
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

  const statusBorderMap: Record<string, string> = {
    running: "border-l-[#4fc3f7]",
    completed: "border-l-[var(--success)]",
    error: "border-l-[var(--error)]",
    cancelled: "border-l-[var(--fg-muted)]",
    idle: "border-l-transparent",
  };

  return (
    <span
      className={`inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] bg-[var(--bg-secondary)] border border-[var(--border)] border-l-2 ${statusBorderMap[status] ?? "border-l-transparent"} text-[11px] whitespace-nowrap shrink-0${onClick ? " cursor-pointer" : ""}`.trim()}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={`${target.agentId}:${target.sessionId}`}
    >
      <StatusIcon status={status} size="sm" />
      <span className="text-[var(--fg-primary)] max-w-[120px] truncate">{target.label}</span>
      <ContextBar target={target} />
      <button
        className="inline-flex items-center justify-center w-[14px] h-[14px] p-0 rounded-[2px] bg-transparent text-[var(--fg-muted)] text-[12px] leading-none shrink-0 ml-[1px] hover:bg-[var(--error)] hover:text-[var(--user-fg)]"
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
