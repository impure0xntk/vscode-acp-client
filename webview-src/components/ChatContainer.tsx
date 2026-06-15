import React, { useRef, memo, useCallback, useEffect } from "react";
import { DisplayItemView } from "./DisplayItemView";
import { useMessages } from "../hooks/useMessages";
import { useMessagePipeline } from "../hooks/useMessagePipeline";
import { useScrollController } from "../hooks/useScrollController";

// ── Constants ───────────────────────────────────────────────────────────────

const SCROLL_BOTTOM_THRESHOLD = 100;

// ── Props ───────────────────────────────────────────────────────────────────

export interface ChatContainerProps {
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled" | "warning";
  isActive?: boolean;
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

export const ChatContainer = memo(function ChatContainer({
  sessionId,
  sessionKey,
  agentId,
  status,
  scrollToMessageRef,
  onScroll,
  forceScrollToBottomRef,
  scrollToUnreadRef,
}: ChatContainerProps): React.ReactElement {
  const { messages: rawMessages, isStreaming } = useMessages(sessionKey ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Process raw messages through the pipeline
  const items = useMessagePipeline(
    rawMessages,
    sessionId ?? "",
    agentId ?? "",
  );

  const {
    scrollToMessage,
    scrollToUnread,
    forceScrollToBottom,
  } = useScrollController(
    sessionKey ?? null,
    containerRef,
    bottomRef,
  );

  // ── Expose imperative refs ─────────────────────────────────────────
  useEffect(() => {
    if (scrollToMessageRef) scrollToMessageRef.current = scrollToMessage;
  }, [scrollToMessageRef, scrollToMessage]);

  useEffect(() => {
    if (forceScrollToBottomRef) forceScrollToBottomRef.current = forceScrollToBottom;
  }, [forceScrollToBottomRef, forceScrollToBottom]);

  useEffect(() => {
    if (scrollToUnreadRef) scrollToUnreadRef.current = scrollToUnread;
  }, [scrollToUnreadRef, scrollToUnread]);

  // ── Scroll handler — stable callback via ref to avoid dependency ────
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distance = scrollHeight - scrollTop - clientHeight;
    onScrollRef.current?.({
      scrollTop,
      scrollHeight,
      clientHeight,
      isAtBottom: distance < SCROLL_BOTTOM_THRESHOLD,
    });
  }, []); // intentionally empty — reads onScroll via ref

  // ── Render ──────────────────────────────────────────────────────────
  const isEmpty = items.length === 0;

  return (
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
      <div ref={bottomRef} />
    </div>
  );
});
