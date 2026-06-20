import React from "react";
import type { ContextAttachment, SelectedTeam, SendTarget } from "../../types";
import { ContextChip } from "./ContextChip";
import { Icon } from "../../lib/icons";

export interface ContextBarProps {
  attachments: ContextAttachment[];
  onRemove: (id: string) => void;
  sendTargets?: SendTarget[];
  onRemoveSendTarget?: (agentId: string, sessionId: string) => void;
  connectedAgents?: { agentId: string; color?: string }[];
  selectedTeam?: SelectedTeam | null;
  onRemoveSelectedTeam?: () => void;
}

// Re-export for convenience
export type { SelectedTeam } from "../../types";

export function ContextBar({
  attachments,
  onRemove,
  sendTargets = [],
  onRemoveSendTarget,
  connectedAgents = [],
  selectedTeam = null,
  onRemoveSelectedTeam,
}: ContextBarProps): React.ReactElement | null {
  const hasAttachments = attachments.length > 0;
  const hasTargets = sendTargets.length > 0;
  const hasTeam = selectedTeam !== null;
  if (!hasAttachments && !hasTargets && !hasTeam) return null;

  return (
    <div className="context-bar">
      <div className="context-bar-chips">
        {selectedTeam && (
          <span
            className="context-chip context-chip--team"
            title={`Team: ${selectedTeam.name} (${selectedTeam.id})`}
          >
            <Icon name="users" className="context-chip-icon" size="sm" />
            <span className="context-chip-label">{selectedTeam.name}</span>
            <button
              className="context-chip-remove"
              onClick={onRemoveSelectedTeam}
              title="Remove team"
            >
              <Icon name="close" size="sm" />
            </button>
          </span>
        )}
        {sendTargets.map((target) => (
          <span
            key={`target:${target.agentId}:${target.sessionId}`}
            className="context-chip context-chip--target"
            title={`${target.agentId}:${target.sessionId}`}
          >
            <Icon name="chat" className="context-chip-icon" size="sm" />
            <span className="context-chip-label">{target.label}</span>
            <button
              className="context-chip-remove"
              onClick={() =>
                onRemoveSendTarget?.(target.agentId, target.sessionId)
              }
              title="Remove"
            >
              <Icon name="close" size="sm" />
            </button>
          </span>
        ))}
        {attachments.map((a) => (
          <ContextChip key={a.id} attachment={a} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}
