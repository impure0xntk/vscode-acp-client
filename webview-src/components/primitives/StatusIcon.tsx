import React from "react";
import { elapsedColor } from "../../shared/elapsedColor";
import {
  IconSpinner,
  IconCircleOutline,
  IconCheck,
  IconCross,
  IconBan,
  IconWarning,
  IconInput,
} from "../../lib/icons";

// ============================================================================
// Unified status icon system — SVG-based
// ============================================================================

/** Session runtime state — no terminal values */
export type SessionStatus = "idle" | "running" | "cancelling";
/** Turn outcome — set after a turn completes */
export type TurnOutcome = "completed" | "error" | "cancelled";
export type ToolStatus = "in_progress" | "completed" | "failed";

export type StatusIconType =
  | SessionStatus
  | TurnOutcome
  | ToolStatus
  | "working"
  | "pending"
  | "waiting"
  | "waiting_for_input"
  | "disconnected"
  | "warning";

const classMap: Record<StatusIconType, string> = {
  idle: "idle",
  running: "running",
  cancelling: "cancelling",
  working: "running",
  in_progress: "running",
  pending: "running",
  waiting: "waiting",
  waiting_for_input: "waiting_for_input",
  completed: "completed",
  failed: "error",
  error: "error",
  cancelled: "cancelled",
  warning: "warning",
  disconnected: "cancelled",
};

const IconComponentMap: Record<
  string,
  React.FC<{ className?: string; size?: number }>
> = {
  idle: IconCircleOutline,
  running: IconSpinner,
  cancelling: IconSpinner,
  waiting: IconSpinner,
  waiting_for_input: IconInput,
  completed: IconCheck,
  error: IconCross,
  cancelled: IconBan,
  warning: IconWarning,
};

export interface StatusIconProps {
  status: StatusIconType;
  size?: "sm" | "md";
  className?: string;
  elapsedMs?: number;
  /** Force a specific color group accent (e.g. "active" or "waiting") */
  colorGroup?: string;
  /** Context variant: "tool" mutes completed check to gray; default keeps green */
  variant?: "default" | "tool";
}

export function StatusIcon({
  status,
  size = "sm",
  className = "",
  elapsedMs,
  colorGroup,
  variant = "default",
}: StatusIconProps): React.ReactElement {
  const mapped = classMap[status] ?? "idle";
  const IconEl = IconComponentMap[mapped] ?? IconCircleOutline;

  let colorSuffix = "";
  if (colorGroup === "waiting") {
    colorSuffix = " status-icon-waiting";
  } else if (mapped === "running" && elapsedMs !== undefined) {
    const tier = elapsedColor(elapsedMs);
    if (tier === "warning") colorSuffix = " status-icon-running-warning";
    else if (tier === "critical") colorSuffix = " status-icon-running-critical";
  }

  const px = size === "sm" ? 14 : 18;
  const variantSuffix = variant === "tool" ? " status-icon-tool" : "";
  const cls =
    `status-icon status-icon-${mapped} status-icon-${size}${variantSuffix}${colorSuffix} ${className}`.trim();
  const iconCls =
    mapped === "running" || mapped === "waiting"
      ? "status-icon-svg status-icon-spinner"
      : "status-icon-svg";
  return (
    <span className={cls}>
      <IconEl size={px} className={iconCls} />
    </span>
  );
}

export function StatusSpinner({
  status,
  className = "",
}: {
  status: StatusIconType;
  className?: string;
}): React.ReactElement {
  return (
    <StatusIcon
      status={status}
      className={`status-spinner-wrap ${className}`.trim()}
    />
  );
}
