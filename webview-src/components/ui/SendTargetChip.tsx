import React from "react";
import type { SendTarget } from "../../types";
import { StatusIcon } from "../ui/StatusIcon";

// ── Props ──────────────────────────────────────────────────────────

export interface SendTargetChipProps {
  target: SendTarget;
  onRemove: () => void;
  onClick?: () => void;
}

// ── Component ───────────────────────────────────────────────────────

/**
 * SendTargetChip — displays a single send target with status indicator.
 *
 * Design (from Section 5.1 of mesh-orchestrator-integration-design.md):
 * ┌─────────────────────┐
 * │ ✕ Claude:refactor   │
 * │   (idle)            │
 * └─────────────────────┘
 *
 * Status colors: idle=gray, running=blue+spin, completed=green, error=red
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
