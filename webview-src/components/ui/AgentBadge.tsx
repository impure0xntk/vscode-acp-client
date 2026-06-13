import React from "react";

interface AgentBadgeProps {
  agentId: string;
  /** Display name — if omitted, falls back to agentId */
  agentName?: string;
  agentColor?: string;
  className?: string;
}

/**
 * Compact agent identifier badge — colored dot + truncated name.
 *
 * Used by SessionTab (tab bar), SessionOverviewCard (card header), and
 * TopToolbar (status bar), providing a shared visual anchor for agent
 * identity across all views.
 */
export function AgentBadge({
  agentId,
  agentName,
  agentColor,
  className = "",
}: AgentBadgeProps): React.ReactElement {
  const dotColor = agentColor ?? "var(--vscode-descriptionForeground)";
  const displayName = agentName ?? agentId;
  return (
    <span className={`agent-badge ${className}`.trim()}>
      <span
        className="agent-badge-dot"
        style={{ backgroundColor: dotColor }}
      />
      <span className="agent-badge-name" title={agentId}>
        {displayName}
      </span>
    </span>
  );
}
