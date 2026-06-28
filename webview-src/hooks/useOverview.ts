import { useCallback } from "react";
import { useUiStateStore } from "../store/uiStateStore";
import type { SessionOverviewFilter } from "../types";

export function useOverview() {
  const s = useUiStateStore.getState();
  const visible = s.overviewVisible;
  const width = s.overviewWidth;
  const position = s.overviewPosition;
  const filter = s.overviewFilter;
  const expandedSessions = s.overviewExpandedSessions;
  const selectedSessionIds = s.overviewSelectedSessionIds;
  const selectionMode = s.overviewSelectionMode;
  const setVisible = s.setOverviewVisible;
  const setWidth = s.setOverviewWidth;
  const setPosition = s.setOverviewPosition;
  const setFilter = s.setOverviewFilter;
  const setExpanded = s.setOverviewExpandedSessions;
  const setSelected = s.setOverviewSelectedSessionIds;
  const toggleSelected = s.toggleOverviewSelected;
  const setSelectionMode = s.setOverviewSelectionMode;
  const toggleSelection = s.toggleOverviewSelection;

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
