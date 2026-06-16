import { useCallback, useEffect, useRef } from "react";
import { useScrollStateStore } from "../store/scrollStateStore";

/**
 * Scroll controller hook — provides imperative scroll helpers.
 *
 * Handles:
 * - scroll-to-message (for links)
 * - force scroll-to-bottom (on send)
 * - scroll-to-first-unread (on badge click)
 * - session-switch scroll restore (via sessionKey change)
 * - auto-scroll on new messages when isAtBottom is true
 */
export function useScrollController(
  sessionKey: string | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>,
  isAtBottom?: boolean,
  messageCount?: number,
) {
  const key = sessionKey ?? "__nosession__";

  // ── Scroll restore on session key change ──────────────────────────────
  // ChatContainer is remounted on key change (key={activeKey} in ChatArea),
  // so this effect runs on every session switch.
  useEffect(() => {
    // Double rAF: wait for React paint + layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (!el) return;

        const state = useScrollStateStore.getState().perSession[key];
        if (state && !state.isAtBottom && state.scrollTop > 0) {
          el.scrollTop = state.scrollTop;
        } else {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }, [key, containerRef]);

  // ── Auto-scroll when isAtBottom changes to true ──────────────────────
  const prevIsAtBottom = useRef(isAtBottom);
  useEffect(() => {
    if (isAtBottom && !prevIsAtBottom.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevIsAtBottom.current = isAtBottom;
  }, [isAtBottom, containerRef]);

  // ── Auto-scroll on new messages when already at bottom ──────────────
  // The ChatArea-level effect only fires when isAtBottom transitions,
  // so we also watch messageCount here to catch the case where the user
  // is already at the bottom and new content streams in.
  const prevMessageCount = useRef(messageCount ?? 0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const count = messageCount ?? 0;
    if (count > prevMessageCount.current && isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCount.current = count;
  }, [messageCount, isAtBottom, containerRef]);

  // ── Scroll-to-message (for message links) ───────────────────────────
  const scrollToMessage = useCallback(
    (messageId: string) => {
      const el = containerRef.current;
      if (!el) return;
      const msgEl = el.querySelector(
        `[data-message-id="${messageId}"]`,
      ) as HTMLElement | null;
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [containerRef],
  );

  // ── Force scroll to bottom (on send) ────────────────────────────────
  const forceScrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [containerRef]);

  // ── Scroll to first unread or bottom (on badge click) ───────────────
  const scrollToUnread = useCallback(
    (firstUnreadId: string) => {
      const el = containerRef.current;
      if (!el) return;
      const msgEl = el.querySelector(
        `[data-message-id="${firstUnreadId}"]`,
      ) as HTMLElement | null;
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    },
    [containerRef],
  );

  // ── Scroll-to-bottom on badge click ─────────────────────────────────
  const handleScrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [containerRef]);

  return {
    scrollToMessage,
    scrollToUnread,
    forceScrollToBottom,
    handleScrollToBottom,
  };
}
