import React, {
  useEffect,
  useRef,
  memo,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Message } from "./Message";
import type { ChatMessage, ToolCall } from "../types";
import { useUiStateStore } from "../store/uiStateStore";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.ChatContainer");

// Threshold in px from bottom to consider "at bottom"
const SCROLL_BOTTOM_THRESHOLD = 100;

export interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId?: string;
  /** Full session key "agentId:sessionId" — used for UI state persistence */
  sessionKey?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled" | "warning";
  /** Whether this container's session is currently active (visible tab) */
  isActive?: boolean;
  /** Ref setter that receives the internal scrollToMessage function */
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  /** Ref setter that receives the internal forceScrollToBottom function */
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  /** Ref setter that receives the internal scrollToUnread function */
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
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
 * Pass messages through, but also attach pending tool calls to the
 * preceding *agent* message so both inline-summary and standalone
 * tool-card rendering have the data they need.
 *
 * - tool-role messages are kept as independent messages in the list
 *   (they carry their own timestamp and agentId).
 * - When a tool message is encountered, its toolCalls are also appended
 *   to the most recent agent message's toolCalls so the inline summary
 *   at the bottom of that agent message can render them.
 * - Consecutive tool messages before any agent message are collected and
 *   will be attached once an agent message appears.
 */
function mergeToolBatches(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let pendingCalls: ToolCall[] = [];
  let lastAgentIdx = -1; // index into result[] of the most recent agent message

  for (const msg of messages) {
    if (msg.role === "tool") {
      const calls: ChatMessage["toolCalls"] = msg.toolCalls ?? [];
      // Deduplicate by id — same tool call may appear in multiple tool messages
      const existingIds = new Set<string>(pendingCalls.map((c) => c.id));
      const newCalls = calls.filter((c) => !existingIds.has(c.id));
      pendingCalls = [...pendingCalls, ...newCalls];
      // Emit the tool message without toolCalls to avoid duplicate rendering
      // (toolCalls are merged into the preceding agent message instead)
      result.push({ ...msg, toolCalls: undefined });
      continue;
    }

    // Non-tool message
    if (msg.role === "agent" || msg.role === "user" || msg.role === "system") {
      // Flush pending tool calls onto the last agent message (if any)
      if (pendingCalls.length > 0 && lastAgentIdx >= 0) {
        const prev = result[lastAgentIdx];
        result[lastAgentIdx] = {
          ...prev,
          toolCalls: [...(prev.toolCalls ?? []), ...pendingCalls],
        };
        pendingCalls = [];
      }
      if (msg.role === "agent") lastAgentIdx = result.length;
      result.push(msg);
    }
  }

  // Trailing tool calls with no following agent message — attach to last agent
  if (pendingCalls.length > 0 && lastAgentIdx >= 0) {
    const prev = result[lastAgentIdx];
    result[lastAgentIdx] = {
      ...prev,
      toolCalls: [...(prev.toolCalls ?? []), ...pendingCalls],
    };
  }

  return result;
}

/**
 * Build an array aligned to `messages` that carries the inherited
 * "run key" for each slot.  Consecutive messages with the same run key
 * suppress the header (isConsecutive).
 *
 * Tool messages inherit the run key of the preceding agent message so
 * that consecutive tool messages (and agent→tool sequences) all share
 * the same key, suppressing redundant headers.
 */
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
      const current = useUiStateStore.getState().getScrollState(k).scrollTop;
      if (current === st) return; // no-op if already persisted
      useUiStateStore.getState().saveScrollState(k, { scrollTop: st });
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
  scrollToUnreadRef,
}: ChatContainerProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [unreadFlash, setUnreadFlash] = useState(false);
  const isAtBottomRef = useRef(true);

  const k = sessionKey ?? "__nosession__";
  const uiStateStore = useUiStateStore.getState();

  // ── Restore scrollTop on first mount / session key change ──────────
  const prevKeyRef = useRef(k);
  const didInit = useRef(false);
  if (prevKeyRef.current !== k) {
    prevKeyRef.current = k;
    didInit.current = false;
  }
  if (!didInit.current) {
    didInit.current = true;
    const st = uiStateStore.getScrollState(k).scrollTop;
    if (st > 0 && containerRef.current) {
      containerRef.current.scrollTop = st;
    }
  }

  // ── Compute unread count from lastSeenMessageId (store) ───────────
  // Read lastSeenId from store imperatively via ref to avoid useSyncExternalStore
  // subscription. Subscribing here would cause an infinite loop: effects below
  // call saveScrollState which triggers re-render → subscription fires → repeat.
  const lastSeenIdRef = useRef<string | null>(uiStateStore.getScrollState(k).lastSeenMessageId);
  lastSeenIdRef.current = uiStateStore.getScrollState(k).lastSeenMessageId;
  const lastSeenId = lastSeenIdRef.current;

  const msgIds = useMemo(() => messages.map((m) => m.id), [messages]);

  const computedUnread = useMemo(() => {
    if (!lastSeenId) return 0;
    const idx = msgIds.indexOf(lastSeenId);
    if (idx < 0) return 0;
    return msgIds.length - idx - 1;
  }, [lastSeenId, msgIds]);

  const computedFirstUnreadId = useMemo(() => {
    if (!lastSeenId) return null;
    const idx = msgIds.indexOf(lastSeenId);
    if (idx < 0 || idx + 1 >= msgIds.length) return null;
    return msgIds[idx + 1];
  }, [lastSeenId, msgIds]);

  useEffect(() => { setUnreadCount(computedUnread); }, [computedUnread]);
  useEffect(() => { setFirstUnreadId(computedFirstUnreadId); }, [computedFirstUnreadId]);

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
    // Flash the unread boundary line briefly
    if (firstUnreadId) {
      setUnreadFlash(true);
      setTimeout(() => setUnreadFlash(false), 1200);
    }
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      recalcIsAtBottom();
    }, 400);
  }, [recalcIsAtBottom, firstUnreadId]);

  // ── Scroll to first unread message ───────────────────────────────
  const scrollToUnread = useCallback(() => {
    if (!firstUnreadId) {
      // No unread — fall back to bottom
      handleScrollToBottom();
      return;
    }
    const msgEl = containerRef.current?.querySelector(
      `[data-message-id="${firstUnreadId}"]`
    ) as HTMLElement | null;
    if (!msgEl) {
      handleScrollToBottom();
      return;
    }
    isUserScrollingRef.current = true;
    msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
    setUnreadCount(0);
    setIsAtBottom(false);
    isAtBottomRef.current = false;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      recalcIsAtBottom();
    }, 400);
  }, [firstUnreadId, handleScrollToBottom, recalcIsAtBottom]);

  useEffect(() => {
    if (scrollToUnreadRef) scrollToUnreadRef.current = scrollToUnread;
  }, [scrollToUnreadRef, scrollToUnread]);

  // ── Force scroll to bottom (on send) ──────────────────────────────
  const newestMsgId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const forceScroll = useCallback(() => {
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    isUserScrollingRef.current = false;
    if (newestMsgId) {
      const current = useUiStateStore.getState().getScrollState(k).lastSeenMessageId;
      if (current !== newestMsgId) {
        uiStateStore.saveScrollState(k, { lastSeenMessageId: newestMsgId, scrollTop: 0 });
      }
    }
    setUnreadCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [k, newestMsgId, uiStateStore]);

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
    const msgEls = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"));
    for (const el of msgEls) observer.observe(el);

    // MutationObserver: observe newly added message elements (streaming)
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.dataset.messageId) observer.observe(node);
          const descendants = Array.from(node.querySelectorAll<HTMLElement>("[data-message-id]"));
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
  const persistScrollOnly = useCallback(() => {
    if (!isActive) return;
    const el = containerRef.current;
    if (!el) return;
    const st = el.scrollTop;
    const current = uiStateStore.getScrollState(k).scrollTop;
    if (current === st) return;
    uiStateStore.saveScrollState(k, { scrollTop: st });
  }, [isActive, k, uiStateStore]);

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
        uiStateStore.saveScrollState(k, { lastSeenMessageId: newest });
      }
    }
    prevIsAtBottom.current = isAtBottom;
  }, [isActive, isAtBottom, k, uiStateStore]);

  // (b) new messages arrive while at bottom
  const prevMsgLen = useRef(messages.length);
  useEffect(() => {
    if (!isActive) { prevMsgLen.current = messages.length; return; }
    if (messages.length > prevMsgLen.current && isAtBottomRef.current) {
      const newest = messages[messages.length - 1];
      if (newest) {
        uiStateStore.saveScrollState(k, { lastSeenMessageId: newest.id });
      }
    }
    prevMsgLen.current = messages.length;
  }, [isActive, messages.length, k, uiStateStore]);

  // (c) tab becomes active — mark all as read
  useEffect(() => {
    if (!isActive) return;
    const newest = messages[messages.length - 1]?.id;
    if (newest) {
      uiStateStore.saveScrollState(k, { lastSeenMessageId: newest });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, k, uiStateStore]);

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
  const merged = useMemo(() => mergeToolBatches(messages), [messages]);
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
            <React.Fragment key={msg.id}>
              {/* Unread boundary line — rendered between last-seen and first-unread */}
              {msg.id === firstUnreadId && (
                <div className={unreadFlash ? "unread-boundary-line unread-boundary-line--flash" : "unread-boundary-line"} />
              )}
              <Message
                id={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
                toolCalls={msg.toolCalls}
                inlineFilePaths={msg.inlineFilePaths}
                attachments={msg.attachments}
                isConsecutive={idx > 0 && runKeys[idx] !== undefined && runKeys[idx] === runKeys[idx - 1]}
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
