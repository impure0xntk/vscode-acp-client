import { useSyncExternalStore, useCallback, useRef } from "react";
import { useMessageStore } from "../store/messageStore";
import type { ChatMessage } from "../types";

const EMPTY: ChatMessage[] = [];

interface Cache {
  key: string | null;
  msgsRef: unknown;
  maxItems: number;
  result: ChatMessage[];
}

/**
 * Subscribe to the last N messages for a single session.
 *
 * Returns a stable reference until the session's message array identity
 * changes, so the SessionOverviewCard only re-renders on new messages.
 * User, agent, and system messages are included; tool-only messages are
 * skipped to keep the preview focused on conversational history.
 */
export function useRecentMessages(
  sessionKey: string | null,
  maxItems: number = 4
): ChatMessage[] {
  const cacheRef = useRef<Cache>({
    key: null,
    msgsRef: undefined,
    maxItems,
    result: EMPTY,
  });

  const cache = cacheRef.current;
  if (cache.key !== sessionKey || cache.maxItems !== maxItems) {
    cache.key = sessionKey;
    cache.maxItems = maxItems;
    cache.msgsRef = undefined;
    cache.result = EMPTY;
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!sessionKey) return () => {};
      return useMessageStore.subscribe((state, prev) => {
        if (state.perSession[sessionKey] !== prev.perSession[sessionKey]) {
          onChange();
        }
      });
    },
    [sessionKey]
  );

  const getSnapshot = useCallback((): ChatMessage[] => {
    if (!sessionKey) return EMPTY;
    const s = useMessageStore.getState();
    const msgs = s.perSession[sessionKey];
    if (!msgs || msgs.length === 0) {
      if (cache.result !== EMPTY) cache.result = EMPTY;
      return EMPTY;
    }
    if (cache.msgsRef === msgs) return cache.result;
    // Skip tool-only messages; keep user/agent/system for conversational preview.
    const filtered = msgs.filter(
      (m) => m.role !== "tool" || (m.content && m.content.trim().length > 0)
    );
    const next = filtered.slice(-maxItems);
    cache.msgsRef = msgs;
    cache.result = next;
    return next;
  }, [sessionKey, maxItems]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
