import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../../lib/icons";
import { elapsedColor } from "../../shared/elapsedColor";
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

  return (
    <span className={`queued-prompt-status queued-prompt-status--${status}`}>
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
  const effectiveActive = active || (sessionKey ? storedActive : false);

  // Determine the action label
  const effectiveAction = effectiveActive
    ? action ||
      (sessionKey ? `Waiting for ${sessionKey.split(":")[0]}…` : "Waiting…")
    : null;

  // Timer anchor: turnStartedAt (fresh) → sessionInfo.lastResponseAt (stale) → now
  const anchorMs = turnStartedAt
    ? new Date(turnStartedAt).getTime()
    : sessionInfo?.lastResponseAt
      ? new Date(sessionInfo.lastResponseAt).getTime()
      : Date.now();

  const [elapsedSec, setElapsedSec] = useState(0);
  const rafRef = useRef<number | null>(null);
  const anchorRef = useRef(anchorMs);
  anchorRef.current = anchorMs;

  useEffect(() => {
    if (!effectiveAction) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setElapsedSec(0);
      return;
    }
    const tick = () => {
      setElapsedSec((Date.now() - anchorRef.current) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    setElapsedSec((Date.now() - anchorRef.current) / 1000);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [effectiveAction, anchorMs]);

  // Render nothing if idle and no queue
  if (!effectiveAction && queue.length === 0) return null;

  return (
    <div className="session-status-bar">
      {/* Streaming status section */}
      {pending && !effectiveActive ? (
        <div
          className="streaming-status streaming-status--pending"
          role="status"
          aria-live="polite"
        >
          <span className="streaming-status-spinner" aria-hidden="true">
            <span className="streaming-status-dot" />
            <span className="streaming-status-dot" />
            <span className="streaming-status-dot" />
          </span>
          <span className="streaming-status-text">Sending…</span>
        </div>
      ) : effectiveAction ? (
        (() => {
          const tierColour = elapsedColor(elapsedSec * 1000);
          return (
            <div
              className={`streaming-status streaming-status--${tierColour}`}
              role="status"
              aria-live="polite"
            >
              <Icon
                name="loading"
                size="sm"
                className="streaming-status-spinner"
              />
              <span className="streaming-status-text">
                {effectiveAction} · {formatElapsed(elapsedSec)}
              </span>
            </div>
          );
        })()
      ) : null}

      {/* Queued prompt list section */}
      {queue.length > 0 && (
        <div className="queued-prompt-list">
          <div className="queued-prompt-list-header">
            <span className="queued-prompt-list-title">
              {queue.length} queued message{queue.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ul className="queued-prompt-list-items">
            {queue.map((entry) => (
              <li key={entry.id} className="queued-prompt-item">
                <div className="queued-prompt-item-content">
                  <StatusBadge status={entry.status} />
                  <span className="queued-prompt-item-text" title={entry.text}>
                    {entry.text.length > 60
                      ? entry.text.slice(0, 60) + "\u2026"
                      : entry.text}
                  </span>
                </div>
                {entry.status === "pending" && (
                  <button
                    className="queued-prompt-item-cancel"
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
