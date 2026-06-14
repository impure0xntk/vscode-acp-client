import React from "react";
import { UserJumpNav } from "./UserJumpNav";
import { AgentBadge } from "./ui/AgentBadge";
import type { ChatMessage } from "../types";
import type { ConnectedAgentInfo } from "../store/sessionStore";
import { Icon } from "../lib/icons";

// ── props ─────────────────────────────────────────────────────────────────

export interface TopToolbarProps {
  messages: ChatMessage[];
  agentId?: string;
  agentName?: string;
  connectedAgents?: ConnectedAgentInfo[];
  model?: string;
  mode?: string;
  cwd?: string;
  workspaceRoot?: string;
  isTurnActive?: boolean;
  onJumpToMessage: (messageId: string) => void;
  sessionOverviewVisible?: boolean;
  onToggleSessionOverview?: () => void;
  /** Where the overview panel is rendered — controls toggle button placement */
  sessionOverviewPosition?: "right" | "left";
}

// ── component ─────────────────────────────────────────────────────────────

export function TopToolbar({
  messages,
  agentId,
  agentName,
  connectedAgents = [],
  model,
  mode,
  cwd,
  workspaceRoot,
  isTurnActive,
  onJumpToMessage,
  sessionOverviewVisible,
  onToggleSessionOverview,
  sessionOverviewPosition = "right",
}: TopToolbarProps): React.ReactElement {
  // Prefer session cwd, fall back to workspace root
  const displayCwd = cwd ?? workspaceRoot;

  // Show only the last path segment for brevity, or the full path if short
  const cwdLabel = displayCwd
    ? (displayCwd.split("/").pop() ?? displayCwd)
    : null;

  const overviewOnLeft = sessionOverviewPosition === "left";

  const overviewButton = onToggleSessionOverview ? (
    <button
      className={`top-toolbar-overview-btn${sessionOverviewVisible ? " active" : ""}`}
      onClick={onToggleSessionOverview}
      title="Toggle session overview"
    >
      <Icon name="list-tree" size="sm" />
    </button>
  ) : null;

  const agentColor = agentId
    ? connectedAgents.find((a) => a.agentId === agentId)?.color
    : undefined;

  return (
    <div className="top-toolbar">
      <div className="top-toolbar-left">
        {overviewOnLeft && overviewButton}
        <UserJumpNav messages={messages} onJumpTo={onJumpToMessage} />
      </div>
      <div className="top-toolbar-center">
        {agentId && agentName && (
          <AgentBadge
            agentId={agentId}
            agentName={agentName}
            agentColor={agentColor}
            className="top-toolbar-agent"
          />
        )}
        {cwdLabel && (
          <span className="top-toolbar-cwd" title={displayCwd}>
            <Icon name="folder-opened" size="sm" /> {cwdLabel}
          </span>
        )}
        {model && isTurnActive && (
          <span className="top-toolbar-model" title={model}>
            {model}
          </span>
        )}
        {mode && isTurnActive && (
          <span className="top-toolbar-mode" title={mode}>
            {mode}
          </span>
        )}
      </div>
      <div className="top-toolbar-right">
        {!overviewOnLeft && overviewButton}
      </div>
    </div>
  );
}
