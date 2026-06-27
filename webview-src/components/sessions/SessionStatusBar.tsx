import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../../lib/icons";
import { elapsedColorValue } from "../../shared/elapsedColor";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import type { QueuedPrompt } from "../../types";

// ── Props ──────────────────────────────────────────────────────────

export interface SessionStatusBarProps {
  /** Session key (${agentId}:${sessionId}) for context-aware streaming state */
  sessionKey: string | null;
  /** Whether the turn is still active */
  active?: boolean;
  /** Human-readable action label, e.g. "Reading src/auth.ts" */
  action?: string;
  /** ISO timestamp of when the current turn was started by the user */
  turnStartedAt?: string;
  /** Whether the message has been sent but the agent hasn't acknowledged yet */
  pending?: boolean;
  /** Queue of pending prompts for this session */
  queue: QueuedPrompt[];
  /** Cancel a queued prompt by ID */
  onCancelQueue: (promptId: string) => void;
}

// ── Status badge (from QueuedPromptList) ───────────────────────────

function StatusBadge({ status }: { status: QueuedPrompt["status"] }) {
  const label =
    status === "pending"
      ? "Queued"
      : status === "sending"
        ? "Sending\u2026"
        : status === "sent"
          ? "Sent"
          : "Cancelled";

  const statusClasses: Record<string, string> = {
    pending: "text-fg-muted",
    sending: "text-accent",
    sent: "text-fg-secondary",
    cancelled: "text-fg-muted line-through",
  };
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wider ${statusClasses[status] ?? "text-fg-muted"}`}>
      {label}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────

export const SessionStatusBar = React.memo(function SessionStatusBar({
  sessionKey,
  active = false,
  action,
  turnStartedAt,
  pending = false,
  queue,
  onCancelQueue,
}: SessionStatusBarProps): React.ReactElement | null {
  const sessionInfo = useSessionInfo(sessionKey);

  const storedActive = sessionInfo?.status === "running";
  const isCancelling = sessionInfo?.status === "cancelling";
  const effectiveActive = active || (sessionKey ? storedActive : false);

  // Determine the action label
  const effectiveAction = isCancelling
    ? "Cancelling…"
    : effectiveActive
      ? action ||
        (sessionKey ? `Waiting for ${sessionKey.split(":")[0]}…` : "Waiting…")
      : null;

  // Timer anchor: turnStartedAt (set by UnifiedMode when the user sends).
  // Do NOT fall back to sessionInfo.lastResponseAt — it stores the
  // PREVIOUS response timestamp and would make the second turn's timer
  // start from the first response (showing tens of seconds of phantom
  // wait time).
  // null means "no anchor yet" — the rAF loop won't start until
  // effectiveAction is truthy AND anchorMs is non-null.
  const anchorMs = turnStartedAt
    ? new Date(turnStartedAt).getTime()
    : null;

  const [elapsedSec, setElapsedSec] = useState(0);
  const rafRef = useRef<number | null>(null);
  const anchorRef = useRef<number | null>(null);

  // Keep anchorRef in sync without tearing down the rAF loop
  useEffect(() => {
    anchorRef.current = anchorMs;
  }, [anchorMs]);

  useEffect(() => {
    if (!effectiveAction || !anchorRef.current) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (!effectiveAction) setElapsedSec(0);
      return;
    }
    const tick = () => {
      if (anchorRef.current !== null) {
        setElapsedSec((Date.now() - anchorRef.current) / 1000);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    setElapsedSec((Date.now() - anchorRef.current!) / 1000);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [effectiveAction, isCancelling, anchorMs]);

  // Show "Sending…" when the user has sent a message (pending) and
  // turnStartedAt is recorded.  Do NOT gate on !effectiveActive — the
  // session/turnActive message can arrive almost simultaneously with the
  // send, causing effectiveActive to be true before the component ever
  // renders with pending=true.  SingleSessionLayout clears pending after
  // a short delay once isTurnActive becomes true, which hides this state.
  const showSending = pending && turnStartedAt && !isCancelling;

  // Render nothing if idle and no queue
  if (!effectiveAction && !showSending && queue.length === 0) return null;

  return (
    <div className="bg-bg-secondary border-b border-border shrink-0">
      {/* Streaming status section */}
      {showSending ? (
        <div
          className="flex items-center gap-[6px] px-3 py-0.5 text-[11px] font-mono bg-bg-secondary border-b border-border shrink-0 text-fg-muted"
          role="status"
          aria-live="polite"
        >
          <span className="shrink-0 flex items-center gap-[3px]" aria-hidden="true">
            <span className="inline-block w-1 h-1 rounded-full bg-fg-muted animate-streaming-dot-bounce" style={{ animationDelay: "0s" }} />
            <span className="inline-block w-1 h-1 rounded-full bg-fg-muted animate-streaming-dot-bounce" style={{ animationDelay: "0.2s" }} />
            <span className="inline-block w-1 h-1 rounded-full bg-fg-muted animate-streaming-dot-bounce" style={{ animationDelay: "0.4s" }} />
          </span>
          <span className="whitespace-nowrap overflow-hidden text-ellipsis">Sending…</span>
        </div>
      ) : isCancelling ? (
        <div
          className="flex items-center gap-[6px] px-3 py-0.5 text-[11px] font-mono bg-bg-secondary border-b border-border shrink-0 text-error"
          role="status"
          aria-live="polite"
        >
          <Icon name="loading" size="sm" className="shrink-0 animate-spin" />
          <span className="whitespace-nowrap overflow-hidden text-ellipsis">Cancelling…</span>
        </div>
      ) : effectiveAction ? (
        (() => {
          const color = elapsedColorValue(elapsedSec * 1000);
          return (
            <div
              className="flex items-center gap-[6px] px-3 py-0.5 text-[11px] font-mono bg-bg-secondary border-b border-border shrink-0"
              style={{ color }}
              role="status"
              aria-live="polite"
            >
              <Icon
                name="loading"
                size="sm"
                className="shrink-0 animate-streaming-spin"
              />
              <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                {effectiveAction} · {formatElapsed(elapsedSec)}
              </span>
            </div>
          );
        })()
      ) : null}

      {/* Queued prompt list section */}
      {queue.length > 0 && (
        <div className="bg-bg-secondary border-b border-border">
          <div className="flex items-center justify-between px-3 py-0.5 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]">
            <span className="text-[10px] font-semibold text-fg-secondary font-mono uppercase tracking-wider">
              {queue.length} queued message{queue.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ul className="list-none m-0 p-0 max-h-[120px] overflow-y-auto">
            {queue.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-1 px-2 py-[3px] border-b border-[color-mix(in_srgb,var(--border)_30%,transparent)] last:border-b-0">
                <div className="flex flex-1 items-center gap-1.5 min-w-0 overflow-hidden">
                  <StatusBadge status={entry.status} />
                  <span className="text-[11px] text-fg-secondary whitespace-nowrap overflow-hidden text-ellipsis block" title={entry.text}>
                    {entry.text.length > 60
                      ? entry.text.slice(0, 60) + "\u2026"
                      : entry.text}
                  </span>
                </div>
                {entry.status === "pending" && (
                  <button
                    className="inline-flex items-center justify-center w-[18px] h-[18px] p-0 rounded-[3px] bg-transparent text-fg-muted text-[10px] cursor-pointer border-none hover:bg-error hover:text-user-fg transition-all flex-shrink-0"
                    onClick={() => onCancelQueue(entry.id)}
                    title="Remove from queue"
                    aria-label="Remove from queue"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

// ── Helpers ────────────────────────────────────────────────────────

function formatElapsed(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

// ── Exported pure logic for testing ────────────────────────────────

export type StreamingPhase = "idle" | "sending" | "waiting" | "cancelling";

export interface StreamingState {
  phase: StreamingPhase;
  actionLabel: string | null;
  anchorMs: number | null;
}

/**
 * Derive the streaming display phase from component inputs.
 * Pure function — no hooks, no side effects.
 * Mirrors the logic inside SessionStatusBar's render body.
 */
export function deriveStreamingState(props: {
  sessionKey: string | null;
  active: boolean;
  action: string | undefined;
  turnStartedAt: string | undefined;
  pending: boolean;
  sessionStatus: string | undefined;
}): StreamingState {
  const { sessionKey, active, action, turnStartedAt, pending, sessionStatus } =
    props;

  const storedActive = sessionStatus === "running";
  const isCancelling = sessionStatus === "cancelling";
  const effectiveActive = active || (sessionKey ? storedActive : false);

  const effectiveAction = isCancelling
    ? "Cancelling\u2026"
    : effectiveActive
      ? action ||
        (sessionKey
          ? `Waiting for ${sessionKey.split(":")[0]}\u2026`
          : "Waiting\u2026")
      : null;

  const showSending = pending && turnStartedAt && !isCancelling;

  if (showSending) {
    return {
      phase: "sending",
      actionLabel: null,
      anchorMs: turnStartedAt ? new Date(turnStartedAt).getTime() : null,
    };
  }
  if (isCancelling) {
    return { phase: "cancelling", actionLabel: null, anchorMs: null };
  }
  if (effectiveAction) {
    return { phase: "waiting", actionLabel: effectiveAction, anchorMs: null };
  }
  return { phase: "idle", actionLabel: null, anchorMs: null };
}
