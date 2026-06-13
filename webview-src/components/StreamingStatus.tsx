import React, { useState, useEffect, useRef } from "react";
import { Icon } from "../lib/icons";
import { elapsedColor } from "../shared/elapsedColor";

export interface StreamingStatusProps {
  /** Human-readable action label, e.g. "Reading src/auth.ts" */
  action?: string;
  /** Start timestamp (ms since epoch). Monotonic; unused when elapsed ≤ 0. */
  startMs?: number;
  /** Whether the turn is still active */
  active?: boolean;
}

/**
 * StreamingStatus — shows the current agent action + elapsed time while streaming.
 * Hidden when idle (active=false or no action).
 *
 * Colour tiers mirror StatusIcon / ProgressBar thresholds:
 *   < 10 s  → normal  (blue)
 *   10–30 s → warning (yellow)
 *   > 30 s  → critical (red)
 */
export function StreamingStatus({
  action,
  startMs,
  active = false,
}: StreamingStatusProps): React.ReactElement | null {
  const [elapsedSec, setElapsedSec] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(startMs ?? null);

  useEffect(() => {
    startRef.current = startMs ?? null;
  }, [startMs]);

  useEffect(() => {
    if (!active || !action) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      setElapsedSec(0);
      return;
    }

    const tick = () => {
      if (startRef.current !== null) {
        setElapsedSec((Date.now() - startRef.current) / 1000);
      } else {
        setElapsedSec(0);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, action]);

  if (!active || !action) return null;

  const tier = elapsedColor(elapsedSec * 1000);
  const label = elapsedSec > 0
    ? `${action}  ${elapsedSec.toFixed(1)}s`
    : action;

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
