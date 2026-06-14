import React from "react";

export interface AgentChipProps {
  agentId: string;
  color: string;
  isConsecutive: boolean;
}

export const AgentChip = React.memo(function AgentChip({
  agentId,
  color,
  isConsecutive,
}: AgentChipProps): React.ReactElement {
  if (isConsecutive) {
    return (
      <span
        className="message-agent-chip message-agent-chip-dot"
        style={{ backgroundColor: color }}
        title={agentId}
      />
    );
  }

  return (
    <span
      className="message-agent-chip"
      style={{ backgroundColor: `${color}33` }}
    >
      <span className="message-agent-chip-id" style={{ color }}>
        {agentId}
      </span>
    </span>
  );
});
