import React from "react";
import type { ToolCallInfo } from "../types";

interface Props {
  tool: ToolCallInfo | null;
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Extract basename from a file path */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function RunningToolOverlay({ tool }: Props): React.ReactElement | null {
  const [visible, setVisible] = React.useState(false);
  const [display, setDisplay] = React.useState<ToolCallInfo | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live elapsed-time ticker for in_progress tools
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!display || display.status !== "in_progress") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [display]);

  React.useEffect(() => {
    if (!tool) return;

    if (tool.status === "in_progress") {
      if (timer.current) clearTimeout(timer.current);
      setDisplay(tool);
      setVisible(true);
    } else {
      setDisplay(tool);
      setVisible(true);
      const delay = tool.status === "failed" ? 5000 : 3000;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { setVisible(false); timer.current = null; }, delay);
    }

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [tool]);

  if (!display) return null;

  const icon =
    display.status === "in_progress" ? <span className="running-tool-icon running-tool-icon--pulse">⚡</span> :
    display.status === "completed"  ? <span className="running-tool-icon running-tool-icon--success">✅</span> :
                                       <span className="running-tool-icon running-tool-icon--error">🔴</span>;

  // Compute elapsed for live display
  const elapsed = display.status === "in_progress" && display.elapsedMs !== undefined
    ? fmtDur(now - display.elapsedMs)
    : display.durationMs !== undefined
      ? fmtDur(display.durationMs)
      : null;

  // Build the detail line: filePath + summary
  const detailParts: string[] = [];
  if (display.filePath) {
    detailParts.push(basename(display.filePath));
  }
  if (display.summary) {
    detailParts.push(display.summary);
  }
  const detail = detailParts.length > 0 ? detailParts.join(" — ") : null;

  return (
    <div
      className={`running-tool-overlay${visible ? "" : " running-tool-overlay--fading"}`}
      role="status"
      aria-live="polite"
    >
      {icon}
      <span className="running-tool-title">{display.title}</span>
      {detail && <span className="running-tool-detail">{detail}</span>}
      {elapsed !== null && (
        <span className="running-tool-duration">[{elapsed}]</span>
      )}
    </div>
  );
}
