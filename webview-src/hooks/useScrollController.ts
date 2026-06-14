import { useCallback, useRef } from "react";

/**
 * Scroll controller hook — provides imperative scroll helpers.
 *
 * Scroll position persistence and unread tracking are managed by
 * `useScrollStateStore` in the parent component. This hook only handles:
 * - scroll-to-message (for links)
 * - force scroll-to-bottom (on send)
 * - scroll-to-first-unread (on badge click)
 * - session-switch scroll restore
 */
export function useScrollController(
  sessionKey: string | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>,
) {
  const key = sessionKey ?? "__nosession__";

  // ── Scroll restore on session key change ──────────────────────────────
  const prevKeyRef = useRef(key);
  if (prevKeyRef.current !== key) {
    prevKeyRef.current = key;
    // Scroll to bottom by default when switching sessions
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    });
  }

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
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [bottomRef]);

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
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    },
    [containerRef, bottomRef],
  );

  // ── Scroll-to-bottom on badge click ─────────────────────────────────
  const handleScrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bottomRef]);

  return {
    scrollToMessage,
    scrollToUnread,
    forceScrollToBottom,
    handleScrollToBottom,
  };
}
