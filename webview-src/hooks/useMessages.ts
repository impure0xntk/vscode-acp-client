import { useSyncExternalStore, useCallback, useRef } from "react";
import { useMessageStore } from "../store/messageStore";
import type { ChatMessage } from "../types";

export interface MessagesSnapshot {
  messages: ChatMessage[];
  isStreaming: boolean;
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_SNAPSHOT: MessagesSnapshot = {
  messages: EMPTY_MESSAGES,
  isStreaming: false,
};

interface Cache {
  key: string | null;
  msgs: ChatMessage[] | undefined;
  streaming: boolean;
  snapshot: MessagesSnapshot;
}

/**
 * Subscribe to messages and streaming state for a given session key.
 *
 * getSnapshot is referentially stable: it returns the same object reference
 * until the underlying store data identity actually changes.  This prevents
 * downstream re-renders when nothing has changed.
 */
export function useMessages(sessionKey: string | null): MessagesSnapshot {
  const cacheRef = useRef<Cache>({
    key: null,
    msgs: undefined,
    streaming: false,
    snapshot: EMPTY_SNAPSHOT,
  });

  const cache = cacheRef.current;
  if (cache.key !== sessionKey) {
    cache.key = sessionKey;
    cache.msgs = undefined;
    cache.streaming = false;
    cache.snapshot = EMPTY_SNAPSHOT;
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!sessionKey) return () => {};
      return useMessageStore.subscribe((state, prev) => {
        if (
          state.perSession[sessionKey] !== prev.perSession[sessionKey] ||
          state.streaming[sessionKey] !== prev.streaming[sessionKey]
        ) {
          onChange();
        }
      });
    },
    [sessionKey]
  );

  const getSnapshot = useCallback((): MessagesSnapshot => {
    if (!sessionKey) return EMPTY_SNAPSHOT;
    const s = useMessageStore.getState();
    const msgs = s.perSession[sessionKey] ?? EMPTY_MESSAGES;
    const streaming = s.streaming[sessionKey] ?? false;
    if (cache.msgs === msgs && cache.streaming === streaming) {
      return cache.snapshot;
    }
    const snapshot: MessagesSnapshot = {
      messages: msgs,
      isStreaming: streaming,
    };
    cache.msgs = msgs;
    cache.streaming = streaming;
    cache.snapshot = snapshot;
    return snapshot;
  }, [sessionKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
