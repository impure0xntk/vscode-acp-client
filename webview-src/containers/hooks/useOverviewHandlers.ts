import { useCallback, useMemo } from "react";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { useSessionStore } from "../../store/sessionStore";
import type { SessionOverviewItem } from "../../types";
import type { SessionAction } from "../../hooks/useSessionContext";

interface OverviewHandlerDeps {
  switchTab: (sessionId: string, agentId: string) => void;
  closeSession: (agentId: string, sessionId: string) => void;
  sessionOverviewState: { selectedSessionIds?: string[] };
  dispatch: (action: SessionAction) => void;
}

export function useOverviewHandlers(deps: OverviewHandlerDeps) {
  const { switchTab, closeSession, sessionOverviewState, dispatch } = deps;

  const handleFocus = useCallback(
    (sessionId: string, agentId: string) => switchTab(sessionId, agentId),
    [switchTab],
  );

  const handleCancel = useCallback((sessionId: string, agentId: string) => {
    getVsCodeApi().postMessage({
      type: "sessionOverview:cancel",
      payload: { sessionId, agentId },
    });
  }, []);

  const handleClose = useCallback(
    (sessionId: string, agentId: string) => closeSession(agentId, sessionId),
    [closeSession],
  );

  const handleToggleExpand = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({ type: "sessionOverview:expand", payload: { sessionId } });
  }, []);

  const handleToggleCollapse = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({ type: "sessionOverview:collapse", payload: { sessionId } });
  }, []);

  const handleResizeEnd = useCallback((w: number) => {
    getVsCodeApi().postMessage({ type: "sessionOverview:setWidth", payload: { width: w } });
  }, []);

  const handleToggleSelect = useCallback(
    (sessionId: string) => {
      dispatch({ type: "TOGGLE_SESSION_OVERVIEW_SELECTED", sessionId });
    },
    [dispatch],
  );

  const handleLongPress = useCallback(
    (sessionId: string) => {
      dispatch({ type: "TOGGLE_SESSION_OVERVIEW_SELECTION", sessionId });
    },
    [dispatch],
  );

  const handleCloseSelected = useCallback(() => {
    const selectedIds = sessionOverviewState.selectedSessionIds ?? [];
    const sessionInfoMap = useSessionStore.getState().sessionInfoMap;
    for (const sessionId of selectedIds) {
      // Find the full key "agentId:sessionId" from sessionInfoMap
      const entry = Object.entries(sessionInfoMap).find(
        ([, info]) => info.sessionId === sessionId,
      );
      if (entry) {
        const [fullKey] = entry;
        const agentId = fullKey.split(":")[0];
        closeSession(agentId, sessionId);
      }
    }
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTION_MODE", enabled: false });
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTED", sessionIds: [] });
  }, [sessionOverviewState.selectedSessionIds, closeSession, dispatch]);

  const handleExitSelectionMode = useCallback(() => {
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTION_MODE", enabled: false });
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTED", sessionIds: [] });
  }, [dispatch]);

  return useMemo(
    () => ({
      handleFocus,
      handleCancel,
      handleClose,
      handleToggleExpand,
      handleToggleCollapse,
      handleResizeEnd,
      handleToggleSelect,
      handleLongPress,
      handleCloseSelected,
      handleExitSelectionMode,
    }),
    [
      handleFocus,
      handleCancel,
      handleClose,
      handleToggleExpand,
      handleToggleCollapse,
      handleResizeEnd,
      handleToggleSelect,
      handleLongPress,
      handleCloseSelected,
      handleExitSelectionMode,
    ],
  );
}
