import React from "react";
import type { SessionTabStatus } from "../hooks/useSessionContext";

interface ProgressBarProps {
  status: SessionTabStatus | undefined;
}

export function ProgressBar({ status }: ProgressBarProps): React.ReactElement | null {
  if (status !== "running") return null;

  return (
    <div className="progress-bar" role="progressbar" aria-label="Session running" aria-busy="true">
      <div className="progress-bar-track">
        <div className="progress-bar-fill" />
      </div>
    </div>
  );
}
