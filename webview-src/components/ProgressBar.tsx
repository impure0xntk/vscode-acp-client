import React, { useState, useEffect } from "react";
import type { SessionTabStatus } from "../hooks/useSessionContext";
import { type ElapsedColor, elapsedColor } from "../shared/elapsedColor";

export type ProgressColor = "idle" | ElapsedColor;

interface ProgressBarProps {
  status: SessionTabStatus | undefined;
  /**
   * Last activity timestamp (ms since epoch) for this session.
   * When running, elapsed time is measured from this point so that
   * each new activity resets the elapsed timer to 0
   * and therefore keeps the bar "normal" (blue).
   * Only when no activity occurs for a sustained period does the
   * color decay through warning → critical.
   * Pass undefined when the session has no prior activity yet
   * (e.g. just connected).
   */
  lastActivityMs?: number;
}

function colorForElapsed(elapsed: number): ProgressColor {
  return elapsedColor(elapsed);
}

export function ProgressBar({
  status,
  lastActivityMs,
}: ProgressBarProps): React.ReactElement {
  const isRunning = status === "running";
  const [elapsed, setElapsed] = useState(0);

  // Tick while running — update at 200ms so the color-tier logic
  // (normal → warning → critical) advances visibly.
  useEffect(() => {
    if (!isRunning) {
      setElapsed(0);
      return;
    }
    const baseline = lastActivityMs ?? Date.now();
    // Immediately compute so there is no 1-frame stale value
    setElapsed(Date.now() - baseline);
    const id = setInterval(() => {
      setElapsed(Date.now() - baseline);
    }, 200);
    return () => clearInterval(id);
  }, [isRunning, lastActivityMs]);

  const color = isRunning ? colorForElapsed(elapsed) : "idle";

  return (
    <div
      className={`progress-bar progress-bar--${color}`}
      role="progressbar"
      aria-label={isRunning ? "Session running" : "Session idle"}
      aria-busy={isRunning}
    >
      <div className="progress-bar-track">
        <div className="progress-bar-fill" />
      </div>
    </div>
  );
}
