import React from "react";
import type { ContextAttachment, SelectedTeam, SendTarget } from "../../types";
import type { ContextColor } from "../../types";
import { ContextChip } from "./ContextChip";
import { SendTargetChip } from "../primitives/SendTargetChip";
import { Icon } from "../../lib/icons";

export interface ContextBarProps {
  attachments: ContextAttachment[];
  onRemove: (id: string) => void;
  sendTargets?: SendTarget[];
  onRemoveSendTarget?: (agentId: string, sessionId: string) => void;
  connectedAgents?: { agentId: string; color?: string }[];
  selectedTeam?: SelectedTeam | null;
  onRemoveSelectedTeam?: () => void;
  contextColor?: ContextColor;
}

export type { SelectedTeam } from "../../types";

export function ContextBar({
  attachments,
  onRemove,
  sendTargets = [],
  onRemoveSendTarget,
  connectedAgents = [],
  selectedTeam = null,
  onRemoveSelectedTeam,
  contextColor = "normal",
}: ContextBarProps): React.ReactElement | null {
  const hasAttachments = attachments.length > 0;
  const hasTargets = sendTargets.length > 0;
  const hasTeam = selectedTeam !== null;
  if (!hasAttachments && !hasTargets && !hasTeam) return null;

  return (
    <div className="flex flex-col justify-end gap-1 py-1 overflow-x-auto flex-shrink-0">
      <div className="flex flex-wrap gap-1 flex-shrink-0 min-w-0">
        {selectedTeam && (
          <span
            className="inline-flex items-center gap-[3px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] text-[11px] whitespace-nowrap shrink-0"
            title={`Team: ${selectedTeam.name} (${selectedTeam.id})`}
          >
            <Icon name="users" className="text-[11px] shrink-0" size="sm" />
            <span className="text-fg-primary max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
              {selectedTeam.name}
            </span>
            <button
              className="inline-flex items-center justify-center w-3.5 h-3.5 p-0 border-none rounded-[2px] bg-transparent text-fg-muted text-[12px] leading-none cursor-pointer shrink-0 ml-0.5 hover:bg-error hover:text-user-fg"
              onClick={onRemoveSelectedTeam}
              title="Remove team"
            >
              <Icon name="close" size="sm" />
            </button>
          </span>
        )}
        {sendTargets.map((target) => (
          <SendTargetChip
            key={`target:${target.agentId}:${target.sessionId}`}
            target={target}
            onRemove={() =>
              onRemoveSendTarget?.(target.agentId, target.sessionId)
            }
          />
        ))}
        {attachments.map((a) => (
          <ContextChip
            key={a.id}
            attachment={a}
            onRemove={onRemove}
            contextColor={contextColor}
          />
        ))}
      </div>
    </div>
  );
}
