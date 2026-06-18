import React from "react";
import type { ContextAttachment, SendTarget } from "../../types";
import { ContextChip } from "./ContextChip";
import { Icon } from "../../lib/icons";

export interface ContextBarProps {
  attachments: ContextAttachment[];
  onRemove: (id: string) => void;
  sendTargets?: SendTarget[];
  onRemoveSendTarget?: (agentId: string, sessionId: string) => void;
  connectedAgents?: { agentId: string; color?: string }[];
}

export function ContextBar({
  attachments,
  onRemove,
  sendTargets = [],
  onRemoveSendTarget,
  connectedAgents = [],
}: ContextBarProps): React.ReactElement | null {
  const hasAttachments = attachments.length > 0;
  const hasTargets = sendTargets.length > 0;
  if (!hasAttachments && !hasTargets) return null;

  return (
    <div className="context-bar">
      <div className="context-bar-chips">
        {sendTargets.map((target) => {
          const agentColor = connectedAgents.find(
            (a) => a.agentId === target.agentId
          )?.color;
          return (
            <span
              key={`target:${target.agentId}:${target.sessionId}`}
              className="context-chip context-chip--target"
              title={`${target.agentId}:${target.sessionId}`}
              style={
                agentColor
                  ? { borderTop: `2px solid ${agentColor}` }
                  : undefined
              }
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
          );
        })}
        {attachments.map((a) => (
          <ContextChip key={a.id} attachment={a} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}
