import { useSyncExternalStore, useCallback, useRef } from "react";
import { useScrollStateStore } from "../store/scrollStateStore";
import { useMessageStore } from "../store/messageStore";

// ── Cache for referential stability ─────────────────────────────────────────

interface UnreadCache {
  count: number;
  firstId: string | null;
  /** Last inputs used to compute the result. */
  readUpToId: string | null;
  msgCount: number;
}

const EMPTY_CACHE: UnreadCache = {
  count: 0,
  firstId: null,
  readUpToId: null,
  msgCount: 0,
};

/**
 * Compute unread count and first-unread message ID from scroll state + messages.
 */
function computeUnread(
  readUpToId: string | null,
  msgCount: number,
): { count: number; firstId: string | null } {
  if (!readUpToId || msgCount === 0) return { count: 0, firstId: null };
  // We need the message ID array to find the index, but to avoid subscribing
  // to the full message list we use messageCount from the store.
  // The actual firstUnreadId is resolved lazily in the component.
  return { count: msgCount, firstId: null };
}

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * Return the unread message count for a session.
 *
 * Subscribes to both scrollStateStore (readUpToMessageId) and
 * messageStore (message count for this session), but only triggers
 * re-render when the computed count actually changes.
 */
export function useSessionUnreadCount(sessionKey: string | null): number {
  const cacheRef = useRef<UnreadCache>({ ...EMPTY_CACHE });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionKey) return () => {};
      const unsubScroll = useScrollStateStore.subscribe((state, prevState) => {
        const cur = state.perSession[sessionKey];
        const prev = prevState.perSession[sessionKey];
        if (cur !== prev) onStoreChange();
      });
      const unsubMsg = useMessageStore.subscribe((state, prevState) => {
        if (
          state.perSession[sessionKey] !== prevState.perSession[sessionKey]
        ) {
          onStoreChange();
        }
      });
      return () => {
        unsubScroll();
        unsubMsg();
      };
    },
    [sessionKey],
  );

  const getSnapshot = useCallback((): number => {
    if (!sessionKey) return 0;
    const scrollState = useScrollStateStore.getState().perSession[sessionKey];
    const readUpToId = scrollState?.readUpToMessageId ?? null;
    const msgs = useMessageStore.getState().perSession[sessionKey];
    const msgCount = msgs?.length ?? 0;
    const cache = cacheRef.current;

    if (
      cache.readUpToId === readUpToId &&
      cache.msgCount === msgCount
    ) {
      return cache.count;
    }

    let count: number;
    if (!readUpToId || msgCount === 0) {
      count = 0;
    } else {
      const idx = msgs ? msgs.findIndex((m) => m.id === readUpToId) : -1;
      count = idx < 0 ? msgCount : Math.max(0, msgCount - idx - 1);
    }

    cacheRef.current = { ...cache, count, readUpToId, msgCount };
    return count;
  }, [sessionKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
