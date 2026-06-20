import React from "react";
import type { ContextAttachment } from "../../types";

export interface ContextChipProps {
  attachment: ContextAttachment;
  onRemove: (id: string) => void;
  contextColor?: "normal" | "warning" | "critical";
}

export function ContextChip({
  attachment,
  onRemove,
  contextColor = "normal",
}: ContextChipProps): React.ReactElement {
  const colorClass =
    contextColor === "warning"
      ? "context-chip--ctx-warning"
      : contextColor === "critical"
        ? "context-chip--ctx-critical"
        : "context-chip--ctx-normal";

  return (
    <span
      className={`context-chip ${colorClass}`}
      title={`${attachment.path}\n${attachment.tokenCount} tokens`}
    >
      <span className="context-chip-bar">
        <span className="context-chip-bar-fill" />
      </span>
      <span className="context-chip-label">{attachment.label}</span>
      <span className="context-chip-tokens">{attachment.tokenCount}</span>
      <button
        className="context-chip-remove"
        onClick={() => onRemove(attachment.id)}
        title="Remove"
      >
        ×
      </button>
    </span>
  );
}
