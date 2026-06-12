import React from "react";
import { UserJumpNav } from "./UserJumpNav";
import type { ChatMessage } from "../types";

// ── props ─────────────────────────────────────────────────────────────────

export interface TopToolbarProps {
  messages: ChatMessage[];
  agentName?: string;
  model?: string;
  mode?: string;
  cwd?: string;
  workspaceRoot?: string;
  isTurnActive?: boolean;
  onJumpToMessage: (messageId: string) => void;
}

// ── component ─────────────────────────────────────────────────────────────

export function TopToolbar({
  messages,
  agentName,
  model,
  mode,
  cwd,
  workspaceRoot,
  isTurnActive,
  onJumpToMessage,
}: TopToolbarProps): React.ReactElement {
  // Prefer session cwd, fall back to workspace root
  const displayCwd = cwd ?? workspaceRoot;

  // Show only the last path segment for brevity, or the full path if short
  const cwdLabel = displayCwd
    ? displayCwd.split("/").pop() ?? displayCwd
    : null;

  return (
    <div className="top-toolbar">
      <div className="top-toolbar-left">
        <UserJumpNav messages={messages} onJumpTo={onJumpToMessage} />
      </div>
      <div className="top-toolbar-center">
        {agentName && (
          <span className="top-toolbar-agent" title={agentName}>
            {agentName}
          </span>
        )}
        {cwdLabel && (
          <span className="top-toolbar-cwd" title={displayCwd}>
            📁 {cwdLabel}
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
      <div className="top-toolbar-right" />
    </div>
  );
}
