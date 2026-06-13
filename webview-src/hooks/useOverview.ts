import { useCallback } from "react";
import { useSessionStore } from "../store/sessionStore";
import type { SessionOverviewFilter } from "../types";

// ── Overview hooks ──────────────────────────────────────────────────────────

export function useOverview() {
  const visible = useSessionStore((s) => s.sessionOverviewVisible);
  const width = useSessionStore((s) => s.sessionOverviewWidth);
  const position = useSessionStore((s) => s.sessionOverviewPosition);
  const state = useSessionStore((s) => s.sessionOverviewState);

  const setVisible = useSessionStore((s) => s.setSessionOverviewVisible);
  const setWidth = useSessionStore((s) => s.setSessionOverviewWidth);
  const setPosition = useSessionStore((s) => s.setSessionOverviewPosition);
  const setState = useSessionStore((s) => s.setSessionOverviewState);
  const setFilter = useSessionStore((s) => s.setSessionOverviewFilter);
  const setExpanded = useSessionStore((s) => s.setSessionOverviewExpanded);
  const setSelected = useSessionStore((s) => s.setSessionOverviewSelected);
  const toggleSelected = useSessionStore((s) => s.toggleSessionOverviewSelected);
  const setSelectionMode = useSessionStore((s) => s.setSessionOverviewSelectionMode);
  const toggleSelection = useSessionStore((s) => s.toggleSessionOverviewSelection);

  const toggle = useCallback(() => {
    setVisible(!visible);
  }, [visible, setVisible]);

  return {
    visible,
    width,
    position,
    state,
    setVisible,
    setWidth,
    setPosition,
    setState,
    setFilter,
    setExpanded,
    setSelected,
    toggleSelected,
    setSelectionMode,
    toggleSelection,
    toggle,
  };
}
