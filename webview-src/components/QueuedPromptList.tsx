import React from "react";
import type { QueuedPrompt } from "../types";
import { sessionKeyOf } from "../store/sessionStore";

// ── Props ──────────────────────────────────────────────────────────

export interface QueuedPromptListProps {
  /** Queue for the currently active session */
  queue: QueuedPrompt[];
  /** Current session key for context */
  sessionKey: string;
  /** Cancel a queued prompt by ID */
  onCancel: (promptId: string) => void;
}

// ── Status badge ───────────────────────────────────────────────────

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

export function QueuedPromptList({
  queue,
  sessionKey,
  onCancel,
}: QueuedPromptListProps): React.ReactElement | null {
  if (queue.length === 0) return null;

  return (
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
                onClick={() => onCancel(entry.id)}
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
  );
}
