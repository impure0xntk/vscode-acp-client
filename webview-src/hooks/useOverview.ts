import { useCallback } from "react";
import { useSessionStore } from "../store/sessionStore";
import type { SessionOverviewFilter } from "../types";

// ── Overview hooks ──────────────────────────────────────────────────────────

export function useOverview() {
  // Read via getState() to avoid useSyncExternalStore subscription.
  // sessionOverviewState is an object that gets a new reference on every mutation,
  // which would cause infinite re-renders via useSyncExternalStore's Object.is check.
  const s = useSessionStore.getState();
  const visible = s.sessionOverviewVisible;
  const width = s.sessionOverviewWidth;
  const position = s.sessionOverviewPosition;
  // state object is destructured to primitives to avoid reference equality issues
  const filter = s.sessionOverviewState.filter;
  const expandedSessions = s.sessionOverviewState.expandedSessions;
  const selectedSessionIds = s.sessionOverviewState.selectedSessionIds;
  const selectionMode = s.sessionOverviewState.selectionMode;
  const setVisible = s.setSessionOverviewVisible;
  const setWidth = s.setSessionOverviewWidth;
  const setPosition = s.setSessionOverviewPosition;
  const setFilter = s.setSessionOverviewFilter;
  const setExpanded = s.setSessionOverviewExpanded;
  const setSelected = s.setSessionOverviewSelected;
  const toggleSelected = s.toggleSessionOverviewSelected;
  const setSelectionMode = s.setSessionOverviewSelectionMode;
  const toggleSelection = s.toggleSessionOverviewSelection;

  const toggle = useCallback(() => {
    setVisible(!visible);
  }, [visible, setVisible]);

  return {
    visible,
    width,
    position,
    filter,
    expandedSessions,
    selectedSessionIds,
    selectionMode,
    setVisible,
    setWidth,
    setPosition,
    setFilter,
    setExpanded,
    setSelected,
    toggleSelected,
    setSelectionMode,
    toggleSelection,
    toggle,
  };
}
