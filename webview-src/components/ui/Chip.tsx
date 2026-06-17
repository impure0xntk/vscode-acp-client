import React, { type ReactNode } from "react";
import type { SessionTabStatus, TurnOutcome } from "../../store/sessionStore";
import { Icon } from "../../lib/icons";

export type ContextColor = "normal" | "warning" | "critical";

export interface ToolbarMeta {
  key: string;
  label: string;
  value: string;
  icon?: ReactNode;
  category?: "session" | "runtime" | "metrics" | "workspace";
  statusIndicator?: SessionTabStatus;
  modeIcon?: string;
  contextColor?: ContextColor;
  barPct?: number;
  turnStatus?: TurnOutcome | "running" | null;
}

const STATUS_DOT: Record<SessionTabStatus, { color: string; icon: string }> = {
  running: { color: "#4ec9b0", icon: "circle-filled" },
  idle: { color: "#666666", icon: "circle-outline" },
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
}: {
  meta: ToolbarMeta;
  onClick?: () => void;
}): React.ReactElement {
  const cat = meta.category ?? "";
  const dot = meta.statusIndicator ? STATUS_DOT[meta.statusIndicator] : null;
  const resolvedModeIcon = meta.modeIcon
    ? (MODE_ICON[meta.modeIcon] ?? meta.modeIcon)
    : null;
  const turnKey = meta.turnStatus ?? null;
  const turnIconName = turnKey ? (TURN_ICON[turnKey] ?? null) : null;
  const turnCls = turnKey ? ` toolbar-chip--turn-${turnKey}` : "";
  const ctxColor = meta.contextColor
    ? ` toolbar-chip--ctx-${meta.contextColor}`
    : "";

  return (
    <span
      className={`toolbar-chip toolbar-chip--${cat}${turnCls}${ctxColor}${onClick ? " toolbar-chip--clickable" : ""}`}
      title={`${meta.label}: ${meta.value}`}
      aria-label={`${meta.label}: ${meta.value}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {dot && (
        <Icon
          name={dot.icon}
          className="toolbar-chip-dot"
          style={{ color: dot.color }}
          size="sm"
        />
      )}
      {turnIconName && !dot && (
        <Icon name={turnIconName} className="toolbar-chip-icon" size="sm" />
      )}
      {resolvedModeIcon && (
        <Icon name={resolvedModeIcon} className="toolbar-chip-icon" size="sm" />
      )}
      {meta.icon && !(typeof meta.icon === "string") && (
        <span className="toolbar-chip-icon">{meta.icon}</span>
      )}
      {meta.barPct !== undefined ? (
        <span className="toolbar-chip-bar-wrap">
          <span className="toolbar-chip-bar-track">
            <span
              className="toolbar-chip-bar-fill"
              style={{ width: `${meta.barPct}%` }}
            />
          </span>
          <span className="toolbar-chip-value">{meta.value}</span>
        </span>
      ) : (
        <span className="toolbar-chip-value">{meta.value}</span>
      )}
    </span>
  );
}
