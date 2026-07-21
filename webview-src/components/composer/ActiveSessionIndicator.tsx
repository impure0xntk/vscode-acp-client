import React from "react";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { sessionColorForKey } from "../../shared/sessionColor";
import { StatusIcon } from "../primitives/StatusIcon";
import { Icon } from "../../lib/icons";
import type { SendTarget } from "../../types";

export interface ActiveSessionIndicatorProps {
  /** Active session key (`${agentId}:${sessionId}`), or null when none. */
  activeSessionKey: string | null;
  /** Multi-@ send targets currently selected in the Composer. */
  sendTargets?: SendTarget[];
  /** Click handler — focuses/switches to the active session. */
  onClick?: () => void;
  /** Whether the Composer is disabled (no connected agent). */
  disabled?: boolean;
}

/**
 * Inline destination indicator pinned just above the Composer input.
 *
 * Mirrors patterns from Claude Code (status-line session context),
 * Continue (active-session chip in the chat header), and ChatGPT's
 * tool-switching composer (inline scope chips): make the *destination* of
 * the next send always visible, rendered as a low-contrast inline row that
 * matches the surrounding ContextBar chips instead of a heavy bordered block.
 *
 * - Single active session → status dot + agentId + title + status label.
 * - Multi-@ mode (sendTargets set) → "→ N selected" summary, since the
 *   message fans out to several sessions (the SendTargetChips already list
 *   them individually in the ContextBar).
 */
export function ActiveSessionIndicator({
  activeSessionKey,
  sendTargets = [],
  onClick,
  disabled = false,
}: ActiveSessionIndicatorProps): React.ReactElement | null {
  const isMultiMode = sendTargets.length > 0;

  // Subscribe to the active session so its title/status stay live.
  const info = useSessionInfo(activeSessionKey);

  if (disabled && !activeSessionKey) {
    return (
      <div className="flex items-center gap-1 h-[18px] px-0.5 text-[10px] text-fg-muted leading-none">
        <Icon name="circle-slash" size="xs" />
        <span>No active session — connect an agent</span>
      </div>
    );
  }

  if (!activeSessionKey) return null;

  // Multi-@ mode: the message goes to the selected targets, not the tab's
  // active session. Show a compact inline summary rather than a single-session
  // label (the SendTargetChips enumerate them in the ContextBar below).
  if (isMultiMode) {
    return (
      <div
        className="flex items-center gap-1 h-[18px] px-0.5 text-[10px] text-fg-muted leading-none"
        title={`Message will be sent to ${sendTargets.length} selected session(s)`}
      >
        <Icon name="arrow-right" size="xs" className="text-accent" />
        <span className="font-medium text-fg-secondary">
          {sendTargets.length} selected
        </span>
        <span className="opacity-70">· fans out to targets above</span>
      </div>
    );
  }

  const [agentId, sessionId] = activeSessionKey.split(":");
  const title =
    useSessionStore.getState().tabTitles[activeSessionKey] ??
    info?.title ??
    sessionId;
  const color = info?.sessionColor ?? sessionColorForKey(activeSessionKey);
  const status = info?.status ?? "idle";

  const statusLabel: Record<string, string> = {
    idle: "Ready",
    running: "Working…",
    cancelling: "Cancelling…",
    completed: "Done",
    error: "Error",
    cancelled: "Cancelled",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 h-[18px] px-0.5 text-[10px] text-fg-muted leading-none hover:bg-accent-hover rounded-[3px] cursor-pointer transition-colors w-full text-left group"
      title={`Active session — click to focus. ${agentId}:${sessionId}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span
        className="font-mono font-semibold shrink-0 max-w-[110px] truncate"
        style={{ color }}
      >
        {agentId}
      </span>
      <span className="font-medium text-fg-secondary max-w-[160px] truncate shrink min-w-0 group-hover:text-fg-primary transition-colors">
        {title}
      </span>
      <span className="shrink-0 inline-flex items-center gap-1 text-fg-muted">
        <StatusIcon status={status} size="sm" />
        <span className="whitespace-nowrap">
          {statusLabel[status] ?? status}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-fg-muted/60 text-[9px] uppercase tracking-wider hidden sm:inline">
        Active
      </span>
    </button>
  );
}

export { sessionKeyOf };
