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

  const getSnapshot = useCallback(() => {
    if (!sessionKey) return undefined;
    return useSessionStore.getState().sessionInfoMap[sessionKey];
  }, [sessionKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
