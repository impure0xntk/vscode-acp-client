import { useSyncExternalStore, useCallback, useRef } from "react";
import { useMessageStore } from "../store/messageStore";
import type { ChatMessage } from "../types";

export interface MultipleMessagesSnapshot {
  messagesMap: Record<string, ChatMessage[]>;
  streamingMap: Record<string, boolean>;
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_SNAPSHOT: MultipleMessagesSnapshot = {
  messagesMap: {},
  streamingMap: {},
};

interface Cache {
  keys: string[];
  messagesMap: Record<string, ChatMessage[]>;
  streamingMap: Record<string, boolean>;
  snapshot: MultipleMessagesSnapshot;
}

/**
 * Subscribe to messages and streaming state for multiple session keys.
 * Returns a stable snapshot reference until the underlying data actually changes.
 */
export function useMultipleMessages(
  sessionKeys: string[]
): MultipleMessagesSnapshot {
  const cacheRef = useRef<Cache>({
    keys: [],
    messagesMap: {},
    streamingMap: {},
    snapshot: EMPTY_SNAPSHOT,
  });

  const cache = cacheRef.current;

  // Reset cache when keys change
  if (
    cache.keys.length !== sessionKeys.length ||
    cache.keys.some((k, i) => k !== sessionKeys[i])
  ) {
    cache.keys = [...sessionKeys];
    cache.messagesMap = {};
    cache.streamingMap = {};
    cache.snapshot = EMPTY_SNAPSHOT;
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (sessionKeys.length === 0) return () => {};
      return useMessageStore.subscribe((state, prev) => {
        for (const key of sessionKeys) {
          if (
            state.perSession[key] !== prev.perSession[key] ||
            state.streaming[key] !== prev.streaming[key]
          ) {
            onChange();
            return;
          }
        }
      });
    },
    [sessionKeys]
  );

  const getSnapshot = useCallback((): MultipleMessagesSnapshot => {
    if (sessionKeys.length === 0) return EMPTY_SNAPSHOT;

    const s = useMessageStore.getState();
    const messagesMap: Record<string, ChatMessage[]> = {};
    const streamingMap: Record<string, boolean> = {};

    for (const key of sessionKeys) {
      messagesMap[key] = s.perSession[key] ?? EMPTY_MESSAGES;
      streamingMap[key] = s.streaming[key] ?? false;
    }

    // Check if data actually changed (by reference)
    let changed = false;
    if (
      Object.keys(cache.messagesMap).length !== Object.keys(messagesMap).length
    ) {
      changed = true;
    } else {
      for (const key of sessionKeys) {
        if (
          cache.messagesMap[key] !== messagesMap[key] ||
          cache.streamingMap[key] !== streamingMap[key]
        ) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) {
      return cache.snapshot;
    }

    const snapshot: MultipleMessagesSnapshot = {
      messagesMap,
      streamingMap,
    };
    cache.messagesMap = messagesMap;
    cache.streamingMap = streamingMap;
    cache.snapshot = snapshot;
    return snapshot;
  }, [sessionKeys]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
