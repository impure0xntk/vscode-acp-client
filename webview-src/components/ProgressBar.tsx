import React from "react";
import type { SessionTabStatus } from "../hooks/useSessionContext";
import { type ElapsedColor, elapsedColor } from "../shared/elapsedColor";

export type ProgressColor = "idle" | ElapsedColor;

interface ProgressBarProps {
  status: SessionTabStatus | undefined;
  /**
   * Last activity timestamp (ms since epoch) for this session.
   * When running, elapsed time is measured from this point so that
   * each new activity resets the color back to "normal".
   */
  lastActivityMs?: number;
}

/**
 * Elapsed-time color driven by time since the last activity.
 * While the session is "running", every new message or tool call
 * bumps `lastActivityMs`, which resets the elapsed timer to 0
 * and therefore keeps the bar "normal" (blue).
 * Only when no activity occurs for a sustained period does the
 * color decay through warning → critical.
 *
 * This is a pure component — no internal state, no intervals.
 * Elapsed time is computed at render time from Date.now().
 */
function colorForElapsed(elapsed: number): ProgressColor {
  return elapsedColor(elapsed);
}

export function ProgressBar({ status, lastActivityMs }: ProgressBarProps): React.ReactElement {
  const isRunning = status === "running";

  // Compute elapsed at render time — no state, no interval
  const elapsed = isRunning && lastActivityMs
    ? Date.now() - lastActivityMs
    : 0;

  const color = isRunning ? colorForElapsed(elapsed) : "idle";

  // When idle, apply styles directly to avoid a flash of the running color
  // during the CSS class transition from running → idle.
  const idleStyle: React.CSSProperties = { animation: "none", width: "100%", opacity: 0.12 };

  return (
    <div
      className={`progress-bar progress-bar--${color}`}
      role="progressbar"
      aria-label={isRunning ? "Session running" : "Session idle"}
      aria-busy={isRunning}
    >
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={isRunning ? undefined : idleStyle}
        />
      </div>
    </div>
  );
}
