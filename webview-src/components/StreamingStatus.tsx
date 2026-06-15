import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../lib/icons";
import { elapsedColor } from "../shared/elapsedColor";
import { useSessionStore } from "../store/sessionStore";

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
   * reads streaming state from sessionInfoMap for that specific session
   * instead of using the active session. This keeps the timer alive across
   * tab switches.
   */
  sessionKey?: string;
}

/**
 * StreamingStatus — shows the current agent action + elapsed time while streaming.
 *
 * Streaming state (active/action/startedAt) is stored in sessionInfoMap
 * so that the timer and colour tier survive tab switches.
 */
export function StreamingStatus({
  action,
  active = false,
  lastResponseAt,
  sessionKey,
}: StreamingStatusProps): React.ReactElement | null {
  // Subscribe to sessionInfoMap so that lastResponseAt / isTurnActive updates
  // from the extension host trigger a re-render immediately.
  const sessionInfo = useSessionStore((s) =>
    sessionKey ? s.sessionInfoMap[sessionKey] : undefined,
  );

  const storedActive = sessionInfo?.isTurnActive ?? false;
  const storedLastResponseAt = sessionInfo?.lastResponseAt ?? null;

  const effectiveActive = active || (sessionKey ? storedActive : false);
  const effectiveAction =
    action || (sessionKey && storedActive
      ? `Waiting for ${sessionKey.split(":")[0]}…`
      : null);

  // Explicit lastResponseAt prop takes precedence, then store, then "now".
  const anchorRaw = lastResponseAt ?? storedLastResponseAt ?? null;
  const anchorMs = useMemo(
    () => (anchorRaw ? new Date(anchorRaw).getTime() : Date.now()),
    [anchorRaw],
  );

  const [elapsedSec, setElapsedSec] = useState(0);
  const rafRef = useRef<number | null>(null);
  const anchorRef = useRef(anchorMs);
  anchorRef.current = anchorMs;

  useEffect(() => {
    if (!effectiveActive || !effectiveAction) {
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
  }, [effectiveActive, effectiveAction, anchorMs]);

  if (!effectiveActive || !effectiveAction) return null;

  const tier = elapsedColor(elapsedSec * 1000);
  const label = effectiveAction;

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
