import React from "react";
import { elapsedColor } from "../shared/elapsedColor";

// ============================================================================
// Unified status icon system
// ============================================================================

export type SessionStatus = "idle" | "running" | "completed" | "error" | "cancelled" | "warning";
export type ToolStatus = "in_progress" | "completed" | "failed";

export type StatusIconType = SessionStatus | ToolStatus | "working" | "pending";

// CSS class suffix matches the status value.  Colour is defined in CSS.
const classMap: Record<StatusIconType, string> = {
  idle: "idle",
  running: "running",
  working: "running",
  in_progress: "running",
  pending: "running",
  completed: "completed",
  failed: "error",
  error: "error",
  cancelled: "cancelled",
  warning: "warning",
};

// ---------------------------------------------------------------------------
// Inline SVG icons — each is a 16×16 viewBox, stroke-based for crisp rendering
// ---------------------------------------------------------------------------

function SpinnerIcon(): React.ReactElement {
  return (
    <svg className="status-icon-svg status-icon-spinner" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg className="status-icon-svg" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon(): React.ReactElement {
  return (
    <svg className="status-icon-svg" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CircleIcon(): React.ReactElement {
  return (
    <svg className="status-icon-svg" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3" />
    </svg>
  );
}

function BanIcon(): React.ReactElement {
  return (
    <svg className="status-icon-svg" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 4.5l7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon(): React.ReactElement {
  return (
    <svg className="status-icon-svg" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2.5l6.5 11h-13L8 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

const iconElementMap: Record<string, () => React.ReactElement> = {
  idle: CircleIcon,
  running: SpinnerIcon,
  completed: CheckIcon,
  error: CrossIcon,
  cancelled: BanIcon,
  warning: WarningIcon,
};

interface StatusIconProps {
  status: StatusIconType;
  size?: "sm" | "md";
  className?: string;
  /** Elapsed ms since turn started — when provided and status is running,
   *  the icon colour shifts from normal → warning → critical. */
  elapsedMs?: number;
}

export function StatusIcon({ status, size = "sm", className = "", elapsedMs }: StatusIconProps): React.ReactElement {
  const mapped = classMap[status] ?? "idle";
  const IconEl = iconElementMap[mapped] ?? CircleIcon;

  // Build colour-tier suffix for running states
  let colorSuffix = "";
  if (mapped === "running" && elapsedMs !== undefined) {
    const tier = elapsedColor(elapsedMs);
    if (tier === "warning") colorSuffix = " status-icon-running-warning";
    else if (tier === "critical") colorSuffix = " status-icon-running-critical";
  }

  const cls = `status-icon status-icon-${mapped} status-icon-${size}${colorSuffix} ${className}`.trim();
  return (
    <span className={cls}>
      <IconEl />
    </span>
  );
}

// Convenience: explicit spinner wrapper for places that need guaranteed animation
export function StatusSpinner({ status, className = "" }: { status: StatusIconType; className?: string }): React.ReactElement {
  return <StatusIcon status={status} className={`status-spinner-wrap ${className}`.trim()} />;
}
