import { useSyncExternalStore, useCallback, useRef } from "react";
import { useIntermediateStepsStore } from "../store/intermediateStepsStore";

const EMPTY: Record<string, boolean> = {};

interface CacheEntry {
  sessionKey: string | null;
  map: Record<string, boolean>;
}

/**
 * Subscribe to the per-session intermediate-steps collapse map via
 * `useSyncExternalStore` with a cached getSnapshot.
 *
 * The returned object reference is stable across renders as long as the
 * underlying data has not changed — exactly the same pattern used by
 * `useSessionUnreadCount` for scroll/read-up-to state.
 */
export function useIntermediateStepsCollapseMap(
  sessionKey: string | null
): Record<string, boolean> {
  const cacheRef = useRef<CacheEntry>({ sessionKey: null, map: EMPTY });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionKey) return () => {};
      return useIntermediateStepsStore.subscribe((state, prevState) => {
        const cur = state.collapseMap[sessionKey];
        const prev = prevState.collapseMap[sessionKey];
        if (cur !== prev) onStoreChange();
      });
    },
    [sessionKey]
  );

  const getSnapshot = useCallback((): Record<string, boolean> => {
    if (!sessionKey) return EMPTY;
    const fresh =
      useIntermediateStepsStore.getState().collapseMap[sessionKey] ?? EMPTY;
    const cache = cacheRef.current;
    if (cache.sessionKey === sessionKey && cache.map === fresh) {
      return cache.map;
    }
    cacheRef.current = { sessionKey, map: fresh };
    return fresh;
  }, [sessionKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Return a stable reference to the toggle action.
 */
export function useToggleIntermediateSteps(): (
  sessionKey: string,
  groupId: string
) => void {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return useIntermediateStepsStore.subscribe(() => onStoreChange());
  }, []);

  const getSnapshot = useCallback(() => {
    return useIntermediateStepsStore.getState().toggle;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
