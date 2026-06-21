import React from "react";
import type { ToolbarMeta, ContextColor } from "../../types";
import type { SessionTabStatus } from "../../store/sessionStore";
import { Icon } from "../../lib/icons";

export type { ToolbarMeta, ContextColor };

const STATUS_DOT: Record<SessionTabStatus, { color: string; icon: string }> = {
  running: { color: "#4ec9b0", icon: "circle-filled" },
  idle: { color: "#666666", icon: "circle-outline" },
  cancelling: { color: "#cca700", icon: "circle-filled" },
  completed: { color: "#4ec9b0", icon: "pass-filled" },
  error: { color: "#f14c4c", icon: "circle-filled" },
  cancelled: { color: "#666666", icon: "circle-slash" },
};

const TURN_ICON: Record<string, string> = {
  running: "watch",
  completed: "pass-filled",
  error: "error",
  cancelled: "circle-slash",
};

const MODE_ICON: Record<string, string> = {
  tool: "tools",
  final: "pass-filled",
  clarify: "question",
  plan: "output",
};

export function Chip({
  meta,
  onClick,
  className = "",
}: {
  meta: ToolbarMeta;
  onClick?: () => void;
  className?: string;
}): React.ReactElement {
  const cat = meta.category ?? "";
  const dot = meta.statusIndicator ? STATUS_DOT[meta.statusIndicator] : null;
  const resolvedModeIcon = meta.modeIcon
    ? (MODE_ICON[meta.modeIcon] ?? meta.modeIcon)
    : null;
  const turnKey = meta.turnStatus ?? null;
  const turnIconName = turnKey ? (TURN_ICON[turnKey] ?? null) : null;

  const catBorderMap: Record<string, string> = {
    session: "border-l-accent",
    runtime: "border-l-warning",
    metrics: "border-l-success",
    workspace: "border-l-fg-muted",
  };
  const turnBorderMap: Record<string, string> = {
    completed: "border-l-success",
    error: "border-l-error",
    cancelled: "border-l-fg-muted",
    running: "border-l-[#4fc3f7]",
  };
  const ctxBorderMap: Record<string, string> = {
    normal: "border-l-[#4fc3f7]",
    warning: "border-l-[#ffd54f]",
    critical: "border-l-[#ef5350]",
  };
  const ctxValueColorMap: Record<string, string> = {
    normal: "text-[#4fc3f7]",
    warning: "text-[#ffd54f]",
    critical: "text-[#ef5350]",
  };

  const borderCls = catBorderMap[cat] ?? "";
  const turnBorderCls = turnBorderMap[turnKey ?? ""] ?? "";
  const ctxBorderCls = ctxBorderMap[meta.contextColor ?? ""] ?? "";
  const ctxValueCls = ctxValueColorMap[meta.contextColor ?? ""] ?? "";
  const criticalAnim = meta.contextColor === "critical" ? "animate-context-pulse" : "";

  return (
    <span
      className={`inline-flex items-center gap-[3px] px-1.5 py-0.5 rounded-[3px] bg-accent-hover text-[10.5px] leading-[1.4] whitespace-nowrap shrink-0 border-l-2 ${borderCls} ${turnBorderCls} ${ctxBorderCls} ${criticalAnim}${onClick ? " cursor-pointer hover:bg-bg-input focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1" : ""} ${className}`.trim()}
      title={`${meta.label}: ${meta.value}`}
      aria-label={`${meta.label}: ${meta.value}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {dot && (
        <Icon
          name={dot.icon}
          className="inline-flex items-center justify-center text-[8px] leading-none shrink-0 mr-[2px]"
          style={{ color: dot.color }}
          size="sm"
        />
      )}
      {turnIconName && !dot && (
        <Icon name={turnIconName} className="inline-flex items-center text-[10px] leading-none shrink-0 mr-[2px]" size="sm" />
      )}
      {resolvedModeIcon && (
        <Icon name={resolvedModeIcon} className="inline-flex items-center text-[10px] leading-none shrink-0 mr-[2px]" size="sm" />
      )}
      {meta.icon && !(typeof meta.icon === "string") && (
        <span className="inline-flex items-center text-[10px] leading-none shrink-0 mr-[2px]">{meta.icon}</span>
      )}
      {meta.barPct !== undefined ? (
        <span className="inline-flex items-center gap-[4px] min-w-[60px]">
          <span className="inline-block w-[40px] h-[4px] rounded-[2px] bg-[color-mix(in_srgb,var(--fg-muted)_20%,transparent)] shrink-0 overflow-hidden">
            <span
              className="block h-full rounded-[2px] bg-current transition-[width] duration-300"
              style={{ width: `${meta.barPct}%` }}
            />
          </span>
          <span className={`font-mono ${ctxValueCls}`}>{meta.value}</span>
        </span>
      ) : (
        <span className="font-mono text-fg-secondary">{meta.value}</span>
      )}
    </span>
  );
}
