import { useSyncExternalStore, useCallback } from "react";
import { useSessionStore } from "../store/sessionStore";
import type { SessionInfoSnapshot } from "../store/sessionStore";

/**
 * Subscribe to a single session's info from sessionInfoMap via
 * `useSyncExternalStore`.  Only re-renders when the specific key's
 * value changes (structural equality is handled by Zustand's immer).
 *
 * @param sessionKey - `"agentId:sessionId"` key, or `null` to skip.
 * @returns The current `SessionInfoSnapshot`, or `undefined` if not found.
 */
export function useSessionInfo(
  sessionKey: string | null,
): SessionInfoSnapshot | undefined {
  const cacheRef = useRef<{ key: string | null; snapshot: SessionInfoSnapshot | undefined }>({
    key: null,
    snapshot: undefined,
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionKey) return () => {};
      return useSessionStore.subscribe((state, prevState) => {
        if (state.sessionInfoMap[sessionKey] !== prevState.sessionInfoMap[sessionKey]) {
          onStoreChange();
        }
      });
    },
    [sessionKey],
  );

  const getSnapshot = useCallback((): SessionInfoSnapshot | undefined => {
    if (!sessionKey) return undefined;
    const current = useSessionStore.getState().sessionInfoMap[sessionKey];
    const cache = cacheRef.current;
    if (cache.key === sessionKey && cache.snapshot === current) {
      return cache.snapshot;
    }
    cache.key = sessionKey;
    cache.snapshot = current;
    return current;
  }, [sessionKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
