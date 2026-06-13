import React, {
  useEffect,
  useRef,
  memo,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Message } from "./Message";
import type { ChatMessage } from "../types";
import { useSessionUiStateStore } from "../store/sessionUiStateStore";

// Threshold in px from bottom to consider "at bottom"
const SCROLL_BOTTOM_THRESHOLD = 100;

export interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId?: string;
  /** Full session key "agentId:sessionId" — used for UI state persistence */
  sessionKey?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
  /** Whether this container's session is currently active (visible tab) */
  isActive?: boolean;
  /** Ref setter that receives the internal scrollToMessage function */
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  /** Ref setter that receives the internal forceScrollToBottom function */
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  /** Ref that exposes { isAtBottom, unreadCount, scrollToBottom } to parent */
  scrollStateRef?: React.MutableRefObject<{
    isAtBottom: boolean;
    unreadCount: number;
    scrollToBottom: () => void;
  }>;
  /** Callback fired when scroll state changes (for button visibility) */
  onScrollStateChange?: (state: { isAtBottom: boolean; unreadCount: number }) => void;
}

function sessionIdFrom(msg: ChatMessage): string {
  return msg.sessionId ?? "__nosession__";
}

/**
 * Merge consecutive adjacent tool messages that share the same sessionId
 * into a single entry whose `toolCalls` is the concatenation of all
 * original toolCalls and whose content is joined with "\n".
 */
function mergeSameSessionTools(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== "tool") {
      result.push(msg);
      continue;
    }
    const last = result[result.length - 1];
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
 * "run key" for each slot.
 */
function buildRunKeys(messages: ChatMessage[]): (string | undefined)[] {
  const result: (string | undefined)[] = [];
  let lastAgentId: string | undefined = undefined;
  let lastSessionId: string | undefined = undefined;
  for (const msg of messages) {
    if (msg.role === "tool") {
      result.push(
        lastAgentId !== undefined && lastSessionId !== undefined
          ? `${lastSessionId}::${lastAgentId}`
          : undefined
      );
    } else {
      lastAgentId = msg.agentId;
      lastSessionId = sessionIdFrom(msg);
      result.push(
        msg.agentId !== undefined && lastSessionId !== undefined
          ? `${lastSessionId}::${msg.agentId}`
          : undefined
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Throttled rAF-based persist of scrollTop to the UI state store */
function useScrollPersist(containerRef: React.RefObject<HTMLDivElement | null>, k: string) {
  const rafRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef<number>(-1);
  const persist = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!containerRef.current) return;
      const st = containerRef.current.scrollTop;
      // Skip if scrollTop hasn't actually changed — avoid unnecessary store writes
      if (st === lastScrollTopRef.current) return;
      lastScrollTopRef.current = st;
      const current = useSessionUiStateStore.getState().states[k]?.scrollTop;
      if (current === st) return; // no-op if already persisted
      useSessionUiStateStore.getState().save(k, { scrollTop: st });
    });
  }, [containerRef, k]);
  return { persist, rafRef };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ChatContainer = memo(function ChatContainer({
  messages,
  isStreaming,
  sessionId,
  sessionKey,
  status,
  isActive = true,
  scrollToMessageRef,
  scrollStateRef,
  onScrollStateChange,
  forceScrollToBottomRef,
}: ChatContainerProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const isAtBottomRef = useRef(true);

  const k = sessionKey ?? "__nosession__";
  const { save, restore } = useSessionUiStateStore.getState();

  // ── Restore scrollTop on first mount / session key change ──────────
  const prevKeyRef = useRef(k);
  const didInit = useRef(false);
  if (prevKeyRef.current !== k) {
    prevKeyRef.current = k;
    didInit.current = false;
  }
  if (!didInit.current) {
    didInit.current = true;
    const st = restore(k).scrollTop;
    if (st > 0 && containerRef.current) {
      containerRef.current.scrollTop = st;
    }
  }

  // ── Compute unread count from lastSeenMessageId (store) ───────────
  // "Last seen" = the last message the user explicitly scrolled to and
  // paused on (persisted on scroll idle). Does NOT change during active
  // scrolling — only when the user stops and the idle timer fires.
  const msgIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const lastSeenId = useSessionUiStateStore((s) => s.states[k]?.lastSeenMessageId ?? null);

  const computedUnread = useMemo(() => {
    if (!lastSeenId) return 0;
    const idx = msgIds.indexOf(lastSeenId);
    if (idx < 0) return 0;
    return msgIds.length - idx - 1;
  }, [lastSeenId, msgIds]);

  useEffect(() => { setUnreadCount(computedUnread); }, [computedUnread]);

  // ── Scroll persistence (throttled rAF) ─────────────────────────────
  const { persist: persistScroll, rafRef } = useScrollPersist(containerRef, k);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [rafRef]);

  // ── User-scroll detection ─────────────────────────────────────────
  const isUserScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recalcIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    const at = d < SCROLL_BOTTOM_THRESHOLD;
    setIsAtBottom(at);
    isAtBottomRef.current = at;
    if (at) setUnreadCount(0);
  }, []);

  // ── scrollIntoView for message links ──────────────────────────────
  const scrollToMessage = useCallback((messageId: string) => {
    const msgEl = containerRef.current?.querySelector(
      `[data-message-id="${messageId}"]`
    ) as HTMLElement | null;
    if (!msgEl) return;
    msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
    const body = msgEl.querySelector(".message-body") as HTMLElement | null;
    const target = body ?? msgEl;
    target.classList.remove("message-body--highlighted");
    void target.offsetWidth; // reflow
    target.classList.add("message-body--highlighted");
    const onEnd = () => {
      target.classList.remove("message-body--highlighted");
      target.removeEventListener("animationend", onEnd);
    };
    target.addEventListener("animationend", onEnd);
  }, []);

  useEffect(() => {
    if (scrollToMessageRef) scrollToMessageRef.current = scrollToMessage;
  }, [scrollToMessageRef, scrollToMessage]);

  isAtBottomRef.current = isAtBottom;

  // ── Scroll handler ─────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    const at = d < SCROLL_BOTTOM_THRESHOLD;

    if (isUserScrollingRef.current) {
      if (at) {
        setIsAtBottom(true);
        isAtBottomRef.current = true;
        setUnreadCount(0);
        isUserScrollingRef.current = false;
      }
      return;
    }

    setIsAtBottom(at);
    isAtBottomRef.current = at;
    if (at) setUnreadCount(0);
    persistScroll();
  }, [persistScroll]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target === containerRef.current) isUserScrollingRef.current = true;
  }, []);

  const handleWindowPointerUp = useCallback(() => {
    if (!isUserScrollingRef.current) return;
    isUserScrollingRef.current = false;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(recalcIsAtBottom, 50);
  }, [recalcIsAtBottom]);

  // ── Scroll-to-bottom button ───────────────────────────────────────
  const handleScrollToBottom = useCallback(() => {
    isUserScrollingRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnreadCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      recalcIsAtBottom();
    }, 400);
  }, [recalcIsAtBottom]);

  // ── Force scroll to bottom (on send) ──────────────────────────────
  const newestMsgId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const forceScroll = useCallback(() => {
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    isUserScrollingRef.current = false;
    if (newestMsgId) {
      const current = useSessionUiStateStore.getState().states[k]?.lastSeenMessageId;
      if (current !== newestMsgId) {
        save(k, { lastSeenMessageId: newestMsgId, scrollTop: 0 });
      }
    }
    setUnreadCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [k, newestMsgId, save]);

  useEffect(() => {
    if (forceScrollToBottomRef) forceScrollToBottomRef.current = forceScroll;
  }, [forceScrollToBottomRef, forceScroll]);

  // ── IntersectionObserver: track visible messages ──────────────────
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const lastVisibleIdRef = useRef<string | null>(null);
  const ioScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    if (!container) return;

    const updateLastVisible = () => {
      const ids = messagesRef.current.map((m) => m.id);
      let lastVisible: string | null = null;
      for (let i = ids.length - 1; i >= 0; i--) {
        if (visibleIdsRef.current.has(ids[i])) {
          lastVisible = ids[i];
          break;
        }
      }
      lastVisibleIdRef.current = lastVisible;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId;
          if (!id) continue;
          if (entry.isIntersecting) {
            visibleIdsRef.current.add(id);
          } else {
            visibleIdsRef.current.delete(id);
          }
        }
        updateLastVisible();
      },
      { root: container, threshold: 0 }
    );

    // Observe all current message elements
    const msgEls = container.querySelectorAll("[data-message-id]");
    for (const el of msgEls) observer.observe(el);

    // MutationObserver: observe newly added message elements (streaming)
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.dataset.messageId) observer.observe(node);
          const descendants = node.querySelectorAll("[data-message-id]");
          for (const desc of descendants) observer.observe(desc);
        }
      }
    });
    mo.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mo.disconnect();
      visibleIdsRef.current.clear();
      lastVisibleIdRef.current = null;
    };
  }, [isActive, messages.length]);

  // ── Persist scroll position on scroll idle ────────────────────────
  // Only persists scrollTop — NOT lastSeenMessageId.
  // lastSeenMessageId is only updated when:
  //   (a) user scrolls to bottom (isAtBottom → true transition)
  //   (b) new messages arrive while at bottom
  //   (c) tab becomes active (isActive → true)
  //   (d) user sends a message (forceScroll)
  const persistScrollOnly = useCallback(() => {
    if (!isActive) return;
    const el = containerRef.current;
    if (!el) return;
    const st = el.scrollTop;
    const current = useSessionUiStateStore.getState().states[k]?.scrollTop;
    if (current === st) return;
    save(k, { scrollTop: st });
  }, [isActive, k, save]);

  // Hook into scroll handler to detect scroll idle
  const handleScrollWithPersist = useCallback(() => {
    handleScroll();
    if (ioScrollTimeoutRef.current) clearTimeout(ioScrollTimeoutRef.current);
    ioScrollTimeoutRef.current = setTimeout(persistScrollOnly, 200);
  }, [handleScroll, persistScrollOnly]);

  // Cleanup scroll idle timer on unmount
  useEffect(() => {
    return () => {
      if (ioScrollTimeoutRef.current) clearTimeout(ioScrollTimeoutRef.current);
    };
  }, []);

  // ── Update lastSeenMessageId when at bottom ───────────────────────
  // (a) isAtBottom transitions to true — user scrolled to bottom
  const prevIsAtBottom = useRef(false);
  useEffect(() => {
    if (!isActive) { prevIsAtBottom.current = false; return; }
    if (isAtBottom && !prevIsAtBottom.current) {
      const newest = messagesRef.current[messagesRef.current.length - 1]?.id;
      if (newest) {
        save(k, { lastSeenMessageId: newest });
      }
    }
    prevIsAtBottom.current = isAtBottom;
  }, [isActive, isAtBottom, k, save]);

  // (b) new messages arrive while at bottom
  const prevMsgLen = useRef(messages.length);
  useEffect(() => {
    if (!isActive) { prevMsgLen.current = messages.length; return; }
    if (messages.length > prevMsgLen.current && isAtBottomRef.current) {
      const newest = messages[messages.length - 1];
      if (newest) {
        save(k, { lastSeenMessageId: newest.id });
      }
    }
    prevMsgLen.current = messages.length;
  }, [isActive, messages.length, k, save]);

  // (c) tab becomes active — mark all as read
  useEffect(() => {
    if (!isActive) return;
    const newest = messages[messages.length - 1]?.id;
    if (newest) {
      save(k, { lastSeenMessageId: newest });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, k]);

  // ── Auto-scroll ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    bottomRef.current?.scrollIntoView({ behavior: isAtBottomRef.current ? "smooth" : "instant" });
  }, [isActive, messages.length === 0]); // only when going from empty→non-empty

  // ── Reset on tab activate ─────────────────────────────────────────
  // When switching TO this tab, scroll to bottom and clear unread.
  // lastSeenMessageId is NOT set here — it is only updated by scroll
  // position (IntersectionObserver + scroll idle, or isAtBottom effect).
  useEffect(() => {
    if (!isActive) return;
    setUnreadCount(0);
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, k]);

  // ── Expose scroll state to parent ─────────────────────────────────
  useEffect(() => {
    if (scrollStateRef) {
      scrollStateRef.current = { isAtBottom, unreadCount, scrollToBottom: handleScrollToBottom };
    }
    onScrollStateChange?.({ isAtBottom, unreadCount });
  }, [isAtBottom, unreadCount, handleScrollToBottom, scrollStateRef, onScrollStateChange]);

  // ── ResizeObserver ────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(recalcIsAtBottom);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recalcIsAtBottom]);

  // ── Pointer event listeners ───────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("pointerdown", handlePointerDown as any);
    window.addEventListener("pointerup", handleWindowPointerUp);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown as any);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    };
  }, [handlePointerDown, handleWindowPointerUp]);

  // ── Render ────────────────────────────────────────────────────────
  const isEmpty = messages.length === 0;
  const merged = useMemo(() => mergeSameSessionTools(messages), [messages]);
  const runKeys = useMemo(() => buildRunKeys(merged), [merged]);

  return (
    <div
      className="chat-container"
      ref={containerRef}
      onScroll={handleScrollWithPersist}
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
            <Message
              key={msg.id}
              id={msg.id}
              role={msg.role}
              content={msg.content}
              timestamp={msg.timestamp}
              toolCalls={msg.toolCalls}
              inlineFilePaths={msg.inlineFilePaths}
              attachments={msg.attachments}
              isConsecutive={idx > 0 && runKeys[idx] !== undefined && runKeys[idx] === runKeys[idx - 1]}
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
