import React, { useRef, memo, useCallback, useEffect, useState } from "react";
import { DisplayItemView } from "../message/DisplayItemView";
import { useMessages } from "../../hooks/useMessages";
import { useMessagePipeline } from "../../hooks/useMessagePipeline";
import { useScrollController } from "../../hooks/useScrollController";
import { useSessionUnreadCount } from "../../hooks/useSessionUnreadCount";
import { useScrollStateStore } from "../../store/scrollStateStore";
import { useMessageStore } from "../../store/messageStore";

// ── Constants ───────────────────────────────────────────────────────────────

const SCROLL_BOTTOM_THRESHOLD = 100;

// ── Props ───────────────────────────────────────────────────────────────────

export interface SessionChatContainerProps {
  sessionKey: string | null;
  sessionId?: string;
  agentId?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled" | "warning";
  isActive?: boolean;
  color?: string;

  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<
    ((firstUnreadId: string) => void) | undefined
  >;
  /** Called on scroll events with raw DOM metrics. */
  onScroll?: (metrics: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    isAtBottom: boolean;
  }) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export const SessionChatContainer = memo(function SessionChatContainer({
  sessionKey,
  sessionId,
  agentId,
  status,
  isActive,
  color,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
  onScroll,
}: SessionChatContainerProps): React.ReactElement {
  const { messages: rawMessages, isStreaming } = useMessages(
    sessionKey ?? null
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  // Unread count for badge
  const unreadCount = useSessionUnreadCount(sessionKey);

  // Local isAtBottom state for scroll button visibility
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  // Process raw messages through the pipeline
  const items = useMessagePipeline(rawMessages, sessionId ?? "", agentId ?? "");

  const { scrollToMessage, scrollToUnread, forceScrollToBottom } =
    useScrollController(
      sessionKey ?? null,
      containerRef,
      bottomRef,
      isAtBottom,
      items.length
    );

  // ── Expose imperative refs ─────────────────────────────────────────
  useEffect(() => {
    if (scrollToMessageRef) scrollToMessageRef.current = scrollToMessage;
  }, [scrollToMessageRef, scrollToMessage]);

  useEffect(() => {
    if (forceScrollToBottomRef)
      forceScrollToBottomRef.current = forceScrollToBottom;
  }, [forceScrollToBottomRef, forceScrollToBottom]);

  useEffect(() => {
    if (scrollToUnreadRef) scrollToUnreadRef.current = scrollToUnread;
  }, [scrollToUnreadRef, scrollToUnread]);

  // ── Save scroll position on unmount (session switch / close) ───────
  useEffect(() => {
    const el = containerRef.current;
    return () => {
      const key = sessionKeyRef.current;
      if (key && el) {
        const { scrollTop, scrollHeight, clientHeight } = el;
        const distance = scrollHeight - scrollTop - clientHeight;
        useScrollStateStore.getState().setScrollTop(key, scrollTop);
        useScrollStateStore
          .getState()
          .setIsAtBottom(key, distance < SCROLL_BOTTOM_THRESHOLD);
      }
    };
  }, []);

  // ── Scroll handler with read-up-to tracking ────────────────────────
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distance = scrollHeight - scrollTop - clientHeight;
    const atBottom = distance < SCROLL_BOTTOM_THRESHOLD;

    // Update local isAtBottom state
    if (isAtBottomRef.current !== atBottom) {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }

    // Update scroll state store
    const key = sessionKeyRef.current;
    if (key) {
      const store = useScrollStateStore.getState();
      store.setScrollTop(key, scrollTop);
      store.setIsAtBottom(key, atBottom);
      if (atBottom) {
        // At bottom → mark all as read
        const ids = useMessageStore.getState().perSession[key];
        const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
        store.setReadUpTo(key, newestId);
      }
    }

    onScrollRef.current?.({
      scrollTop,
      scrollHeight,
      clientHeight,
      isAtBottom: atBottom,
    });
  }, []);

  // ── Auto-advance readUpTo when at bottom and new messages arrive ───
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

  // ── Scroll to bottom handler (for button click) ────────────────────
  const handleScrollToBottom = useCallback(() => {
    const wrapper = wrapperRef.current?.querySelector(
      ".chat-container"
    ) as HTMLDivElement | null;
    if (wrapper) {
      wrapper.scrollTop = wrapper.scrollHeight;
    } else {
      forceScrollToBottomRef?.current?.();
    }
  }, [forceScrollToBottomRef]);

  // ── Render ──────────────────────────────────────────────────────────
  const isEmpty = items.length === 0;
  const showScrollButton = !isAtBottom;

  return (
    <div className="section-chat-container-wrapper" ref={wrapperRef}>
      <div
        className="chat-container"
        ref={containerRef}
        onScroll={handleScroll}
        data-messages-scroll-container="true"
      >
        {isEmpty ? (
          <div className="empty-state">
            <p className="empty-title">ACP Chat</p>
            <p className="empty-hint">
              {sessionId
                ? "Send a message to start the conversation."
                : "Connect to an agent and create a session to start."}
            </p>
          </div>
        ) : (
          <div className="message-list">
            {items.map((item, idx) => (
              <DisplayItemView
                key={item.key}
                item={item}
                idx={idx}
                items={items}
                sessionId={sessionId}
              />
            ))}
            {isStreaming && (
              <div className="streaming-cursor">
                <span className="cursor-blink">▋</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} data-bottom-anchor="true" />
      </div>
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
