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
 * Compact banner pinned above the Composer input that shows which session a
 * plain message will be sent to.
 *
 * Mirrors patterns from Claude Code (status-line session context),
 * Continue (active-session chip in the chat header), and Cursor
 * (composer "target" label): make the *destination* of the next send
 * always visible, not just the tab bar far above.
 *
 * - Single active session → colored dot + agentId + title + status.
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
      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-secondary border border-border text-[11px] text-fg-muted">
        <Icon name="circle-slash" size="sm" />
        <span>No active session — connect an agent</span>
      </div>
    );
  }

  if (!activeSessionKey) return null;

  // Multi-@ mode: the message goes to the selected targets, not the tab's
  // active session. Show a summary rather than a single-session label.
  if (isMultiMode) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] text-[11px] text-fg-secondary cursor-default"
        title={`Message will be sent to ${sendTargets.length} selected session(s)`}
      >
        <Icon name="arrow-right" size="sm" className="text-accent" />
        <span className="font-medium text-fg-primary">
          {sendTargets.length} selected
        </span>
        <span className="text-fg-muted">· message fans out to targets above</span>
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
      className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-secondary border border-border text-[11px] text-fg-secondary hover:bg-accent-hover cursor-pointer transition-colors w-full text-left"
      title={`Active session — click to focus. ${agentId}:${sessionId}`}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span
        className="font-mono font-semibold shrink-0 max-w-[120px] truncate"
        style={{ color }}
      >
        {agentId}
      </span>
      <span className="font-medium text-fg-primary max-w-[160px] truncate shrink min-w-0">
        {title}
      </span>
      <span className="ml-1 shrink-0 inline-flex items-center gap-1 text-fg-muted">
        <StatusIcon status={status} size="sm" />
        <span className="whitespace-nowrap">{statusLabel[status] ?? status}</span>
      </span>
      <span className="ml-auto shrink-0 text-fg-muted text-[10px] uppercase tracking-wider hidden sm:inline">
        Active
      </span>
    </button>
  );
}

export { sessionKeyOf };
