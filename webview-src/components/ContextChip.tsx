import React from "react";
import type { ContextAttachment } from "../types";

export interface ContextChipProps {
  attachment: ContextAttachment;
  onRemove: (id: string) => void;
}

export function ContextChip({ attachment, onRemove }: ContextChipProps): React.ReactElement {
  const icon = typeIcon(attachment.type);

  return (
    <span className="context-chip" title={`${attachment.path}\n${attachment.tokenCount} tokens`}>
      <span className="context-chip-icon">{icon}</span>
      <span className="context-chip-label">{attachment.label}</span>
      <span className="context-chip-tokens">{attachment.tokenCount}t</span>
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

function typeIcon(type: ContextAttachment["type"]): string {
  switch (type) {
    case "file":
      return "📄";
    case "selection":
      return "✂️";
    case "symbol":
      return "🔷";
    case "diff":
      return "📋";
  }
}
