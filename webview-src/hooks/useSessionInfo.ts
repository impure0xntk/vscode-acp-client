import { useSyncExternalStore, useCallback, useRef } from "react";
import { useSessionStore } from "../store/sessionStore";
import type { SessionInfoDTO } from "../store/sessionStore";

/**
 * Subscribe to a single session's info from sessionInfoMap via
 * `useSyncExternalStore`.  Only re-renders when the specific key's
 * value actually changes (referential equality on the DTO).
 *
 * @param sessionKey - `"agentId:sessionId"` key, or `null` to skip.
 * @returns The current `SessionInfoDTO`, or `undefined` if not found.
 */
export function useSessionInfo(
  sessionKey: string | null
): SessionInfoDTO | undefined {
  const cacheRef = useRef<SessionInfoDTO | undefined>(undefined);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionKey) return () => {};
      return useSessionStore.subscribe((state) => {
        const next = state.sessionInfoMap[sessionKey];
        if (next !== cacheRef.current) {
          cacheRef.current = next;
          onStoreChange();
        }
      });
    },
    [sessionKey]
  );

  const getSnapshot = useCallback((): SessionInfoDTO | undefined => {
    if (!sessionKey) return undefined;
    return useSessionStore.getState().sessionInfoMap[sessionKey];
  }, [sessionKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
