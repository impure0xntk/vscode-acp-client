import { useCallback, useMemo } from "react";
import { getVsCodeApi } from "../../lib/vscodeApi";

interface OverviewHandlerDeps {
  switchTab: (sessionId: string, agentId: string) => void;
  closeSession: (sessionId: string) => void;
  sessionOverviewState: { selectedSessionIds?: string[] };
  dispatch: (action: { type: string; [k: string]: unknown }) => void;
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
    (sessionId: string) => closeSession(sessionId),
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
    for (const sessionId of selectedIds) {
      closeSession(sessionId);
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
