import React from "react";

interface AgentBadgeProps {
  agentId: string;
  agentColor?: string;
}

/**
 * Compact agent identifier badge — colored dot + truncated name.
 *
 * Used by both SessionTab (tab bar) and SessionOverviewCard (card header),
 * providing a shared visual anchor for agent identity across the two views.
 */
export function AgentBadge({
  agentId,
  agentColor,
}: AgentBadgeProps): React.ReactElement {
  const dotColor = agentColor ?? "var(--vscode-descriptionForeground)";
  return (
    <span className="agent-badge">
      <span
        className="agent-badge-dot"
        style={{ backgroundColor: dotColor }}
      />
      <span className="agent-badge-name" title={agentId}>
        {agentId}
      </span>
    </span>
  );
}
