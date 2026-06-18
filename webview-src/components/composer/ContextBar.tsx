import React from "react";
import type { ContextAttachment } from "../../types";
import { ContextChip } from "./ContextChip";

export interface ContextBarProps {
  attachments: ContextAttachment[];
  onRemove: (id: string) => void;
}

export function ContextBar({
  attachments,
  onRemove,
}: ContextBarProps): React.ReactElement | null {
  if (attachments.length === 0) return null;

  return (
    <div className="context-bar">
      <div className="context-bar-chips">
        {attachments.map((a) => (
          <ContextChip key={a.id} attachment={a} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}
