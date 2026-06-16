import React, { useEffect, useState, useCallback, useRef } from "react";
import { useLogger } from "../../hooks/useLogger";
import { useSessionUnreadCount } from "../../hooks/useSessionUnreadCount";
import { ChatContainer } from "../ChatContainer";

// ── Props ───────────────────────────────────────────────────────────────────

export interface SectionChatContainerProps {
  sessionKey: string;
  agentId: string;
  sessionId: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
  isActive: boolean;
  color: string;

  scrollToMessageRef?: React.MutableRefObject<((id: string) => void) | undefined>;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
}

// ── Component ──────────────────────────────────────────────────────────────

export const SectionChatContainer = React.memo(function SectionChatContainer({
  sessionKey,
  agentId,
  sessionId,
  status,
  isActive,
  color,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
}: SectionChatContainerProps): React.ReactElement {
  const log = useLogger("SectionChatContainer");
  const unreadCount = useSessionUnreadCount(sessionKey);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    log.trace("mount", { sessionKey, sessionId, agentId });
    return () => {
      log.trace("unmount", { sessionKey });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, sessionId, agentId]);

  const handleScroll = useCallback(
    (metrics: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      isAtBottom: boolean;
    }) => {
      if (isAtBottomRef.current !== metrics.isAtBottom) {
        isAtBottomRef.current = metrics.isAtBottom;
        setIsAtBottom(metrics.isAtBottom);
      }
    },
    [],
  );

  const handleScrollToBottom = useCallback(() => {
    forceScrollToBottomRef?.current?.();
  }, [forceScrollToBottomRef]);

  const showScrollButton = !isAtBottom;

  return (
    <div className="section-chat-container-wrapper">
      <ChatContainer
        sessionId={sessionId}
        sessionKey={sessionKey}
        status={status}
        isActive={isActive}
        isAtBottom={isAtBottom}
        onScroll={handleScroll}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
      />
      {showScrollButton && (
        <button
          className="scroll-to-bottom-button"
          onClick={handleScrollToBottom}
          type="button"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <span className="scroll-to-bottom-icon">↓</span>
          {unreadCount > 0 && (
            <span className="scroll-to-bottom-badge">{unreadCount}</span>
          )}
        </button>
      )}
    </div>
  );
});
