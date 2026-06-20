import React from "react";

export interface AgentBadgeProps {
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
    <span className={`inline-flex items-center gap-1 ${className}`.trim()}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      <span className="text-[11px] font-medium text-[var(--fg-primary)] truncate" title={agentId}>
        {displayName}
      </span>
    </span>
  );
}
