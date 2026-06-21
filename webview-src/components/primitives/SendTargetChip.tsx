import React from "react";
import type { SendTarget } from "../../types";
import { StatusIcon } from "./StatusIcon";

export interface SendTargetChipProps {
  target: SendTarget;
  onRemove: () => void;
  onClick?: () => void;
}

function ContextBar({ target }: { target: SendTarget }): React.ReactElement | null {
  const { tokenUsage, contextWindowMax } = target;
  if (!tokenUsage) return null;

  const pct =
    contextWindowMax && contextWindowMax > 0
      ? Math.round((tokenUsage.totalTokens / contextWindowMax) * 100)
      : null;

  const isCritical = pct !== null && pct >= 90;
  const isWarning = pct !== null && pct >= 70;
  const fillColor = isCritical ? "#ef5350" : isWarning ? "#ffd54f" : "#4fc3f7";
  const fillHeight = pct !== null ? Math.max(10, Math.min(100, pct)) : 0;
  const title = pct !== null
    ? `${pct}% (${formatTokens(tokenUsage.totalTokens)} / ${formatTokens(contextWindowMax ?? 0)})`
    : `${formatTokens(tokenUsage.totalTokens)} tokens used`;

  return (
    <span className={`inline-flex shrink-0 ml-[2px] w-[3px] h-[14px] overflow-hidden rounded-1.5${isCritical ? " animate-context-pulse" : ""}`} title={title}>
      <span className="w-full rounded-1.5" style={{ height: `${fillHeight}%`, backgroundColor: fillColor, transition: "height 0.3s ease, background 0.3s ease" }} />
    </span>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function SendTargetChip({
  target,
  onRemove,
  onClick,
}: SendTargetChipProps): React.ReactElement {
  const status = target.status ?? "idle";

  const statusBorderMap: Record<string, string> = {
    running: "border-l-[#4fc3f7]",
    completed: "border-l-success",
    error: "border-l-error",
    cancelled: "border-l-fg-muted",
    idle: "border-l-transparent",
  };

  return (
    <span
      className={`inline-flex items-center gap-0.75 px-1.5 py-0.5 rounded bg-bg-secondary border border-border border-l-2 ${statusBorderMap[status] ?? "border-l-transparent"} text-[11px] whitespace-nowrap shrink-0${onClick ? " cursor-pointer" : ""}`.trim()}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={`${target.agentId}:${target.sessionId}`}
    >
      <StatusIcon status={status} size="sm" />
      <span className="text-fg-primary max-w-[120px] truncate">{target.label}</span>
      <ContextBar target={target} />
      <button
        className="inline-flex items-center justify-center w-3.5 h-3.5 p-0 rounded-[2px] bg-transparent text-fg-muted text-[12px] leading-none shrink-0 ml-0.5 hover:bg-error hover:text-user-fg"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove send target"
        aria-label={`Remove ${target.label}`}
      >
        ✕
      </button>
    </span>
  );
}
