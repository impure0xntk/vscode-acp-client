import { useCallback, useEffect, useRef } from "react";
import { useScrollStateStore } from "../store/scrollStateStore";

/**
 * Scroll controller hook — provides imperative scroll helpers.
 *
 * Scroll position persistence on unmount is handled by ChatContainer's
 * cleanup effect. This hook only handles:
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
  // ChatContainer unmounts on key change and saves scroll position in its
  // cleanup effect. When the new ChatContainer mounts, this effect runs
  // to restore the saved position.
  const prevKeyRef = useRef(key);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    const isKeyChange = prevKeyRef.current !== key;
    prevKeyRef.current = key;

    // Skip restore on initial mount — content hasn't been rendered yet
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      // Still scroll to bottom on first mount
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
      return;
    }

    if (!isKeyChange) return;

    // Restore scroll position for the new session.
    // Use rAF to ensure the DOM has been painted with new session content.
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;

      const state = useScrollStateStore.getState().perSession[key];
      if (state && !state.isAtBottom && state.scrollTop > 0) {
        // Restore saved scroll position
        el.scrollTop = state.scrollTop;
      } else {
        // No saved state or was at bottom → scroll to bottom
        el.scrollTop = el.scrollHeight;
      }
    });
  }, [key, containerRef]);

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
