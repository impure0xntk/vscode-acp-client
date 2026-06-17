import React, { useEffect, useState, useCallback, useRef } from "react";
import { useLogger } from "../../hooks/useLogger";
import { useSessionUnreadCount } from "../../hooks/useSessionUnreadCount";
import { useScrollStateStore } from "../../store/scrollStateStore";
import { useMessageStore } from "../../store/messageStore";
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
  const containerRef = useRef<HTMLDivElement>(null);

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
      // Update scroll state store — mirrors ChatArea's handleScroll
      const store = useScrollStateStore.getState();
      store.setScrollTop(sessionKey, metrics.scrollTop);
      store.setIsAtBottom(sessionKey, metrics.isAtBottom);
      if (metrics.isAtBottom) {
        // At bottom → mark all as read
        const ids = useMessageStore.getState().perSession[sessionKey];
        const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
        store.setReadUpTo(sessionKey, newestId);
      }
    },
    [sessionKey],
  );

  // When messages arrive and isAtBottom is true, advance readUpTo
  const msgCountRef = useRef(0);
  useEffect(() => {
    if (!sessionKey || !isAtBottom) return;
    const ids = useMessageStore.getState().perSession[sessionKey];
    const len = ids?.length ?? 0;
    if (len <= msgCountRef.current) return;
    msgCountRef.current = len;
    const store = useScrollStateStore.getState();
    const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
    store.setReadUpTo(sessionKey, newestId);
  }, [sessionKey, isAtBottom, unreadCount]);

  const handleScrollToBottom = useCallback(() => {
    // Direct DOM scroll — bypasses the ref chain which can be stale
    // when ChatContainer is memoized and its useEffect hasn't fired yet.
    const wrapper = containerRef.current?.querySelector(".chat-container") as HTMLDivElement | null;
    if (wrapper) {
      wrapper.scrollTop = wrapper.scrollHeight;
    } else {
      // Fallback to ref chain
      forceScrollToBottomRef?.current?.();
    }
  }, [forceScrollToBottomRef]);

  const showScrollButton = !isAtBottom;

  return (
    <div className="section-chat-container-wrapper" ref={containerRef}>
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
