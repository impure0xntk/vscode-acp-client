import React from "react";
import type { ContextAttachment } from "../types";
import { Icon, iconForType } from "../lib/icons";

export interface ContextChipProps {
  attachment: ContextAttachment;
  onRemove: (id: string) => void;
}

export function ContextChip({
  attachment,
  onRemove,
}: ContextChipProps): React.ReactElement {
  return (
    <span
      className="context-chip"
      title={`${attachment.path}\n${attachment.tokenCount} tokens`}
    >
      <Icon name={iconForType(attachment.type)} className="context-chip-icon" size="sm" />
      <span className="context-chip-label">{attachment.label}</span>
      <span className="context-chip-sep">({attachment.tokenCount} tokens)</span>
      <button
        className="context-chip-remove"
        onClick={() => onRemove(attachment.id)}
        title="Remove"
      >
        <Icon name="close" size="sm" />
      </button>
    </span>
  );
}
