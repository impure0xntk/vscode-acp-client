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
  contextColor = "normal",
}: ContextBarProps): React.ReactElement | null {
  const hasAttachments = attachments.length > 0;
  const hasTargets = sendTargets.length > 0;
  const hasTeam = selectedTeam !== null;
  if (!hasAttachments && !hasTargets && !hasTeam) return null;

  return (
    <div className="flex items-center gap-1 py-1 overflow-x-auto flex-shrink-0">
      <div className="flex flex-nowrap gap-1 flex-shrink-0 min-w-0">
        {selectedTeam && (
          <span
            className="inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] text-[11px] whitespace-nowrap shrink-0"
            title={`Team: ${selectedTeam.name} (${selectedTeam.id})`}
          >
            <Icon name="users" className="text-[11px] shrink-0" size="sm" />
            <span className="text-[var(--fg-primary)] max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
              {selectedTeam.name}
            </span>
            <button
              className="inline-flex items-center justify-center w-[14px] h-[14px] p-0 border-none rounded-[2px] bg-transparent text-[var(--fg-muted)] text-[12px] leading-none cursor-pointer shrink-0 ml-[1px] hover:bg-[var(--error)] hover:text-[var(--user-fg)]"
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
          <ContextChip key={a.id} attachment={a} onRemove={onRemove} contextColor={contextColor} />
        ))}
      </div>
    </div>
  );
}
