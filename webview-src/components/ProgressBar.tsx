import React, { useState, useEffect, useRef } from "react";
import type { SessionTabStatus } from "../hooks/useSessionContext";

// Thresholds for color transitions (ms)
const THRESHOLD_WARNING = 10_000;  // 10s → yellow
const THRESHOLD_CRITICAL = 30_000; // 30s → red

export type ProgressColor = "idle" | "normal" | "warning" | "critical";

interface ProgressBarProps {
  status: SessionTabStatus | undefined;
}

/**
 * Elapsed-time color: mirrors the context-usage color logic
 * (normal → warning → critical) but driven by how long the
 * current turn has been running.
 */
function colorForElapsed(elapsed: number): ProgressColor {
  if (elapsed >= THRESHOLD_CRITICAL) return "critical";
  if (elapsed >= THRESHOLD_WARNING) return "warning";
  return "normal";
}

export function ProgressBar({ status }: ProgressBarProps): React.ReactElement {
  const isRunning = status === "running";
  const startMsRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  // Reset timer reference every time we enter "running" state
  useEffect(() => {
    if (isRunning) {
      startMsRef.current = Date.now();
      setElapsed(0);
    }
  }, [isRunning]);

  // Tick while running — update at the same cadence as the CSS bar
  // sweeps across the track (1.6s). No need to update faster.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - startMsRef.current);
    }, 1500);
    return () => clearInterval(id);
  }, [isRunning]);

  const color = isRunning ? colorForElapsed(elapsed) : "idle";

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
          style={
            isRunning
              ? undefined               /* uses CSS animation */
              : { animation: "none", width: "100%", opacity: 0.12 }
          }
        />
      </div>
    </div>
  );
}
