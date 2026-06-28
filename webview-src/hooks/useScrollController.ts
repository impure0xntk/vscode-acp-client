import { useCallback, useEffect, useRef } from "react";
import { useScrollStateStore } from "../store/scrollStateStore";

export function useScrollController(
  sessionKey: string | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  bottomRef: React.RefObject<HTMLDivElement | null>,
  isAtBottom?: boolean,
  messageCount?: number
) {
  const key = sessionKey ?? "__nosession__";

  useEffect(() => {
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

  const prevMessageCount = useRef(messageCount ?? 0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const count = messageCount ?? 0;
    if (count > prevMessageCount.current) {
      const currentKey = sessionKey ?? "__nosession__";
      const freshIsAtBottom =
        useScrollStateStore.getState().perSession[currentKey]?.isAtBottom ??
        true;
      if (freshIsAtBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevMessageCount.current = count;
  }, [messageCount, sessionKey, containerRef]);

  const scrollToMessage = useCallback(
    (messageId: string) => {
      const el = containerRef.current;
      if (!el) return;
      const msgEl = el.querySelector(
        `[data-message-id="${messageId}"]`
      ) as HTMLElement | null;
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [containerRef]
  );

  const forceScrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }, [containerRef]);

  const scrollToUnread = useCallback(
    (firstUnreadId: string) => {
      const el = containerRef.current;
      if (!el) return;
      const msgEl = el.querySelector(
        `[data-message-id="${firstUnreadId}"]`
      ) as HTMLElement | null;
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    },
    [containerRef]
  );

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
