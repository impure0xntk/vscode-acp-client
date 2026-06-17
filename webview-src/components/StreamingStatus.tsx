import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { elapsedColor } from "../shared/elapsedColor";
import { useSessionInfo } from "../hooks/useSessionInfo";

export interface StreamingStatusProps {
  /** Human-readable action label, e.g. "Reading src/auth.ts" */
  action?: string;
  /** Whether the turn is still active */
  active?: boolean;
  /**
   * ISO timestamp of when the current turn was started by the user.
   * Used as the elapsed-time anchor so the timer always starts from 0
   * when a new message is sent, regardless of lastResponseAt staleness.
   */
  turnStartedAt?: string;
  /**
   * Whether the message has been sent but the agent hasn't acknowledged
   * yet (status still idle). Shows a distinct "Sending…" state so the
   * user knows the message is in-flight.
   */
  pending?: boolean;
  /**
   * Session key (${agentId}:${sessionId}). When provided, the component
   * reads streaming state from sessionInfoMap for that specific session
   * instead of using the active session. This keeps the timer alive across
   * tab switches.
   */
  sessionKey?: string;
}

/**
 * StreamingStatus — shows the current agent action + elapsed time while streaming.
 *
 * Three visual states:
 * 1. pending=true  → "Sending…" with message-send animation (gap between
 *    user send and extension acknowledging status=running)
 * 2. active + recent turnStartedAt → "Waiting for {agent}… · Xs" with timer
 * 3. active + no turnStartedAt (legacy) → falls back to lastResponseAt anchor
 */
export function StreamingStatus({
  action,
  active = false,
  turnStartedAt,
  pending = false,
  sessionKey,
}: StreamingStatusProps): React.ReactElement | null {
  const sessionInfo = useSessionInfo(sessionKey ?? null);

  const storedActive = sessionInfo?.status === "running";

  const effectiveActive = active || (sessionKey ? storedActive : false);

  // Determine the action label.
  const effectiveAction = effectiveActive
    ? (action || (sessionKey ? `Waiting for ${sessionKey.split(":")[0]}…` : "Waiting…"))
    : null;

  // Timer anchor: turnStartedAt (fresh) → sessionInfo.lastResponseAt (stale) → now.
  const anchorMs = turnStartedAt
    ? new Date(turnStartedAt).getTime()
    : (sessionInfo?.lastResponseAt
      ? new Date(sessionInfo.lastResponseAt).getTime()
      : Date.now());

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

  // Pending state: message sent, waiting for agent to acknowledge
  if (pending && !effectiveActive) {
    return (
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
    );
  }

  // Active streaming state
  if (!effectiveAction) return null;

  const tierColour = elapsedColor(elapsedSec * 1000);

  return (
    <div
      className={`streaming-status streaming-status--${tierColour}`}
      role="status"
      aria-live="polite"
    >
      <Icon name="loading" size="sm" className="streaming-status-spinner" />
      <span className="streaming-status-text">
        {effectiveAction} · {formatElapsed(elapsedSec)}
      </span>
    </div>
  );
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}
