import React, { useEffect, useRef, memo, useState, useCallback } from "react";
import { Message } from "./Message";
import type { ChatMessage } from "../types";

// Threshold in px from bottom to consider "at bottom"
const SCROLL_BOTTOM_THRESHOLD = 100;

export interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
  /** Whether this container's session is currently active (visible tab) */
  isActive?: boolean;
  /** Ref setter that receives the internal scrollToMessage function */
  scrollToMessageRef?: React.MutableRefObject<((id: string) => void) | undefined>;
  /** Ref that exposes { isAtBottom, unreadCount, scrollToBottom } to parent */
  scrollStateRef?: React.MutableRefObject<{
    isAtBottom: boolean;
    unreadCount: number;
    scrollToBottom: () => void;
  }>;
}

function sessionIdFrom(msg: ChatMessage): string {
  return msg.sessionId ?? "__nosession__";
}

/**
 * Merge consecutive adjacent tool messages that share the same sessionId
 * into a single entry whose `toolCalls` is the concatenation of all
 * original toolCalls and whose content is joined with "\n".
 *
 * A non-tool message or a sessionId boundary breaks the merge, so tool
 * messages from different sessions are never combined.
 *
 * The returned array has the same length or fewer entries than `messages`.
 */
function mergeSameSessionTools(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== "tool") {
      result.push(msg);
      continue;
    }
    const last = result[result.length - 1];
    // Only merge when both sides have an explicit (non-placeholder) sessionId
    const sid = sessionIdFrom(msg);
    if (
      last !== undefined &&
      last.role === "tool" &&
      sid !== "__nosession__" &&
      sessionIdFrom(last) === sid
    ) {
      result[result.length - 1] = {
        ...last,
        toolCalls: [...(last.toolCalls ?? []), ...(msg.toolCalls ?? [])],
        content: [last.content, msg.content].filter(Boolean).join("\n"),
      };
    } else {
      result.push(msg);
    }
  }
  return result;
}

/**
 * Build an array aligned to `messages` that carries the inherited
 * "run key" for each slot.  Adjacent messages with the same run key
 * belong to the same consecutive run and the later one hides its header.
 *
 * The run key is `"sessionId::agentId"` where:
 *   - non-tool messages:  sessionId = msg.sessionId, agentId = msg.agentId
 *   - tool messages:      sessionId and agentId are inherited from the most
 *                         recent non-tool message before them
 *
 * After merging same-session tools this means:
 *   agent(id:A,sess:X) → [merged tool+sess:X] → agent(id:A,sess:X)
 * produces the same run key for every slot, so only the first shows a header.
 *
 * `undefined` means the slot cannot participate in any run (no agentId).
 */
function buildRunKeys(messages: ChatMessage[]): (string | undefined)[] {
  const result: (string | undefined)[] = [];
  // Track the last known agentId and sessionId from non-tool messages.
  // Tool messages inherit both so that agent→tool→tool→agent is one run.
  let lastAgentId: string | undefined = undefined;
  let lastSessionId: string | undefined = undefined;
  for (const msg of messages) {
    if (msg.role === "tool") {
      // Inherit from the preceding non-tool message
      result.push(
        lastAgentId !== undefined && lastSessionId !== undefined
          ? `${lastSessionId}::${lastAgentId}`
          : undefined,
      );
    } else {
      lastAgentId = msg.agentId;
      lastSessionId = sessionIdFrom(msg);
      result.push(
        msg.agentId !== undefined && lastSessionId !== undefined
          ? `${lastSessionId}::${msg.agentId}`
          : undefined,
      );
    }
  }
  return result;
}

// Memoize to skip re-render when isStreaming toggles but messages reference is same
/** Per-session last-seen message count (persists across tab switches) */
const sessionMsgCounts = new Map<string, number>();

export const ChatContainer = memo(function ChatContainer({
  messages,
  isStreaming,
  sessionId,
  status,
  isActive = true,
  scrollToMessageRef,
  scrollStateRef,
}: ChatContainerProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const msgCountRef = useRef(0);
  const prevSessionIdRef = useRef<string | undefined>(undefined);

  // On session switch: restore last-seen count, reset scroll state
  if (sessionId !== prevSessionIdRef.current) {
    prevSessionIdRef.current = sessionId;
    const key = sessionId ?? "__nosession__";
    const saved = sessionMsgCounts.get(key);
    msgCountRef.current = saved ?? messages.length;
    // Reset scroll state for new session
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    setUnreadCount(0);
  }

  // Track whether the user is actively scrolling via scrollbar interaction
  const isUserScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recalculate isAtBottom on content size change (ResizeObserver handles
  // scrollbar appearance / layout shift).
  const recalcIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD;
    setIsAtBottom(atBottom);
    isAtBottomRef.current = atBottom;
    if (atBottom) setUnreadCount(0);
  }, []);

  // Internal scroll function — exposed to parent via ref prop
  const scrollToMessage = useCallback((messageId: string) => {
    const msgEl = containerRef.current?.querySelector(
      `[data-message-id="${messageId}"]`
    ) as HTMLElement | null;
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      const body = msgEl.querySelector(".message-body") as HTMLElement | null;
      const target = body ?? msgEl;
      // Remove existing highlight (re-triggerable)
      target.classList.remove("message-body--highlighted");
      // Force reflow so re-adding the class restarts the animation
      void target.offsetWidth;
      target.classList.add("message-body--highlighted");
      // Clean up after animation ends
      const onAnimEnd = () => {
        target.classList.remove("message-body--highlighted");
        target.removeEventListener("animationend", onAnimEnd);
      };
      target.addEventListener("animationend", onAnimEnd);
    }
  }, []);

  // Keep the parent's ref synced with the latest scrollToMessage
  const localRef = useRef(scrollToMessage);
  localRef.current = scrollToMessage;
  useEffect(() => {
    if (scrollToMessageRef) {
      scrollToMessageRef.current = (id: string) => {
        localRef.current(id);
      };
    }
  }, [scrollToMessageRef]);

  // Keep ref in sync so scroll handler doesn't need deps
  isAtBottomRef.current = isAtBottom;

  // Handle scroll events to detect user position
  const handleScroll = useCallback(() => {
    // While the user is interacting with the scrollbar, ignore programmatic
    // scroll events so auto-scroll doesn't fight them.
    if (isUserScrollingRef.current) return;

    recalcIsAtBottom();
  }, [recalcIsAtBottom]);

  // Tracks when user interacts with scrollbar (mousedown on scrollbar area).
  // We approximate this by detecting mousedown on the container; paired with
  // mouseup on window to detect the end of interaction.
  const handlePointerDown = useCallback(() => {
    isUserScrollingRef.current = true;
  }, []);

  const handleWindowPointerUp = useCallback(() => {
    if (!isUserScrollingRef.current) return;
    isUserScrollingRef.current = false;
    // After releasing scrollbar, recalc position after layout settles
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      recalcIsAtBottom();
    }, 50);
  }, [recalcIsAtBottom]);

  // Scroll-to-bottom button click
  const handleScrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnreadCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  }, []);

  // Update last-seen count only when tab is active AND user is at bottom
  useEffect(() => {
    if (!isActive) return;

    const newCount = messages.length;
    const seen = msgCountRef.current;
    const delta = newCount - seen;

    if (delta > 0 && isAtBottomRef.current) {
      // User is at bottom — mark everything up to newest as seen
      msgCountRef.current = newCount;
      sessionMsgCounts.set(sessionId ?? "__nosession__", newCount);
      setUnreadCount(0);
    }
  }, [messages.length, isActive, sessionId, isStreaming]);

  // Auto-scroll only when user is already at bottom AND tab is active
  useEffect(() => {
    if (!isActive) return;

    const newCount = messages.length;
    const delta = newCount - msgCountRef.current;

    if (delta <= 0) return;

    sessionMsgCounts.set(sessionId ?? "__nosession__", newCount);

    if (isAtBottomRef.current) {
      msgCountRef.current = newCount;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setUnreadCount((c) => c + delta);
    }
  }, [messages, isStreaming, isActive, sessionId]);

  // When tab becomes active: mark all as seen, scroll to bottom
  useEffect(() => {
    if (!isActive) return;
    const newCount = messages.length;
    sessionMsgCounts.set(sessionId ?? "__nosession__", newCount);
    msgCountRef.current = newCount;
    setUnreadCount(0);
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [isActive, sessionId]);

  // Expose scroll state to parent via ref (for fixed scroll-to-bottom button)
  useEffect(() => {
    if (scrollStateRef) {
      scrollStateRef.current = {
        isAtBottom,
        unreadCount,
        scrollToBottom: handleScrollToBottom,
      };
    }
  }, [isAtBottom, unreadCount, handleScrollToBottom, scrollStateRef]);

  // ResizeObserver: recalculate isAtBottom when container size changes
  // (e.g. scrollbar appears/disappears, layout shift)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      recalcIsAtBottom();
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, [recalcIsAtBottom]);

  // Bind pointer events for user-scroll detection
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handleWindowPointerUp);

    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    };
  }, [handlePointerDown, handleWindowPointerUp]);

  const isEmpty = messages.length === 0;

  // Merge same-session tool messages, then compute run keys
  const merged = mergeSameSessionTools(messages);
  const runKeys = buildRunKeys(merged);

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
          {merged.map((msg, idx) => {
            if (idx === 0) {
              return (
                <Message
                  key={msg.id}
                  id={msg.id}
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                  toolCalls={msg.toolCalls}
                  inlineFilePaths={msg.inlineFilePaths}
                  attachments={msg.attachments}
                  isConsecutive={false}
                />
              );
            }
            const key = runKeys[idx];
            const keyPrev = runKeys[idx - 1];
            const isConsecutive = key !== undefined && key === keyPrev;
            return (
              <Message
                key={msg.id}
                id={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
                toolCalls={msg.toolCalls}
                inlineFilePaths={msg.inlineFilePaths}
                attachments={msg.attachments}
                isConsecutive={isConsecutive}
              />
            );
          })}
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
