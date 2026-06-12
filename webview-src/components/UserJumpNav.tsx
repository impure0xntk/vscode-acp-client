import React, { useState, useEffect, useCallback } from "react";
import type { ChatMessage } from "../types";

export interface UserJumpNavProps {
  messages: ChatMessage[];
  onJumpTo: (messageId: string) => void;
}

export function UserJumpNav({ messages, onJumpTo }: UserJumpNavProps): React.ReactElement {
  const userMessages = messages.filter((m) => m.role === "user");
  const total = userMessages.length;

  const [currentIdx, setCurrentIdx] = useState(0);

  // Clamp index when total changes (e.g. new message arrives)
  useEffect(() => {
    setCurrentIdx((prev) => Math.min(Math.max(0, prev), Math.max(0, total - 1)));
  }, [total]);

  // Always enabled when there is at least one user message — wraps around.
  const hasPrev = total > 0;
  const hasNext = total > 0;

  const goPrev = useCallback(() => {
    if (total === 0) return;
    const nextIdx = (currentIdx - 1 + total) % total;
    setCurrentIdx(nextIdx);
    onJumpTo(userMessages[nextIdx].id);
  }, [currentIdx, total, onJumpTo, userMessages]);

  const goNext = useCallback(() => {
    if (total === 0) return;
    const nextIdx = (currentIdx + 1) % total;
    setCurrentIdx(nextIdx);
    onJumpTo(userMessages[nextIdx].id);
  }, [currentIdx, total, onJumpTo, userMessages]);

  if (total === 0) {
    return <></>;
  }

  const displayIdx = currentIdx + 1;

  return (
    <div className="user-jump-nav">
      <button
        className="user-jump-btn"
        onClick={goPrev}
        disabled={!hasPrev}
        title="Previous user message"
        aria-label="Jump to previous user message"
      >
        ◀
      </button>
      <span className="user-jump-counter" title="User message navigation">
        {displayIdx}/{total}
      </span>
      <button
        className="user-jump-btn"
        onClick={goNext}
        disabled={!hasNext}
        title="Next user message"
        aria-label="Jump to next user message"
      >
        ▶
      </button>
    </div>
  );
}
