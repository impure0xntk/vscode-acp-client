import React, { useRef, memo, useMemo, useCallback, useEffect } from "react";
import { Message } from "./Message";
import type { ChatMessage } from "../types";
import { useMessages } from "../hooks/useMessages";
import { useScrollController } from "../hooks/useScrollController";

// ── Constants ───────────────────────────────────────────────────────────────

const SCROLL_BOTTOM_THRESHOLD = 100;

// ── Props ───────────────────────────────────────────────────────────────────

export interface ChatContainerProps {
  sessionId?: string;
  sessionKey?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled" | "warning";
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function sessionIdFrom(msg: ChatMessage): string {
  return msg.sessionId ?? "__nosession__";
}

function mergeToolBatches(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "tool") {
      // Look back at the last non-tool message in result to decide behavior.
      const lastNonTool = findLastNonTool(result);
      if (lastNonTool && lastNonTool.role === "agent") {
        // Agent → Tool → … : merge tool calls into the preceding agent message.
        const merged: ChatMessage = {
          ...lastNonTool,
          toolCalls: [
            ...(lastNonTool.toolCalls ?? []),
            ...(msg.toolCalls ?? []),
          ],
        };
        result[result.indexOf(lastNonTool)] = merged;
      } else {
        // User → Tool → … (no preceding agent): treat as new agent message.
        result.push({ ...msg, role: "agent" });
      }
    } else {
      result.push(msg);
    }
  }

  return result;
}

function findLastNonTool(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "tool") return messages[i];
  }
  return null;
}

function buildRunKeys(messages: ChatMessage[]): (string | undefined)[] {
  const result: (string | undefined)[] = [];
  let lastKey: string | undefined = undefined;
  for (const msg of messages) {
    if (msg.role === "agent" && msg.agentId !== undefined) {
      const sid = sessionIdFrom(msg);
      if (sid !== "__nosession__") {
        lastKey = `${sid}::${msg.agentId}`;
      }
    }
    result.push(lastKey);
  }
  return result;
}

// ── Component ──────────────────────────────────────────────────────────────

export const ChatContainer = memo(function ChatContainer({
  sessionId,
  sessionKey,
  status,
  scrollToMessageRef,
  onScroll,
  forceScrollToBottomRef,
  scrollToUnreadRef,
}: ChatContainerProps): React.ReactElement {
  const { messages, isStreaming } = useMessages(sessionKey ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // ── Render helpers ──────────────────────────────────────────────────
  const isEmpty = messages.length === 0;
  const merged = useMemo(() => mergeToolBatches(messages), [messages]);
  const runKeys = useMemo(() => buildRunKeys(merged), [merged]);

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
          {merged.map((msg, idx) => (
            <React.Fragment key={msg.id}>
              <Message
                id={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
                toolCalls={msg.toolCalls}
                inlineFilePaths={msg.inlineFilePaths}
                attachments={msg.attachments}
                isConsecutive={
                  idx > 0 &&
                  runKeys[idx] !== undefined &&
                  runKeys[idx] === runKeys[idx - 1]
                }
                sessionId={sessionId}
                compressionInfo={msg.compressionInfo}
              />
            </React.Fragment>
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
