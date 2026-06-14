import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { elapsedColor } from "../shared/elapsedColor";
import { useSessionUiStateStore } from "../store/sessionUiStateStore";

export interface StreamingStatusProps {
  /** Human-readable action label, e.g. "Reading src/auth.ts" */
  action?: string;
  /** Whether the turn is still active */
  active?: boolean;
  /**
   * ISO timestamp of the last agent response.
   * Used for both elapsed-time anchoring and freshness-based colour tiering.
   * If omitted, falls back to the store's streamingStartedAt.
   */
  lastResponseAt?: string;
  /**
   * Session key (${agentId}:${sessionId}). When provided, the component
   * reads streaming state from the store for that specific session instead
   * of using the active session. This keeps the timer alive across tab
   * switches.
   */
  sessionKey?: string;
}

/**
 * StreamingStatus — shows the current agent action + elapsed time while streaming.
 *
 * Streaming state (active/action/startedAt) is persisted to sessionUiStateStore
 * so that the timer and colour tier survive tab switches. Each session key
 * carries its own independent streaming state.
 */
export function StreamingStatus({
  action,
  active = false,
  lastResponseAt,
  sessionKey,
}: StreamingStatusProps): React.ReactElement | null {
  const storeState = useSessionUiStateStore((s) =>
    sessionKey ? (s.states[sessionKey] ?? null) : null,
  );

  // Determine effective streaming state.
  // Priority: store (for background sessions) > direct props (for active).
  const storedActive = storeState?.streamingActive ?? false;
  const storedAction = storeState?.streamingAction ?? null;
  const storedStartedAt = storeState?.streamingStartedAt ?? null;

  const effectiveActive = active || (sessionKey ? storedActive : false);
  const effectiveAction = action || (sessionKey ? storedAction : null);
  // Anchor time: explicit lastResponseAt > stored start > now
  const anchorMs = lastResponseAt
    ? new Date(lastResponseAt).getTime()
    : storedStartedAt
      ? new Date(storedStartedAt).getTime()
      : Date.now();

  const [elapsedSec, setElapsedSec] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!effectiveActive || !effectiveAction) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setElapsedSec(0);
      return;
    }
    const tick = () => {
      setElapsedSec((Date.now() - anchorMs) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    setElapsedSec((Date.now() - anchorMs) / 1000);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [effectiveActive, effectiveAction, anchorMs]);

  if (!effectiveActive || !effectiveAction) return null;

  const tier = elapsedColor(elapsedSec * 1000);
  const label = elapsedSec > 0
    ? `${effectiveAction}  ${elapsedSec.toFixed(1)}s`
    : effectiveAction;

  return (
    <div
      className={`streaming-status streaming-status--${tier}`}
      role="status"
      aria-live="polite"
    >
      <Icon name="loading" size="sm" className="streaming-status-spinner" />
      <span className="streaming-status-text">{label}</span>
    </div>
  );
}
