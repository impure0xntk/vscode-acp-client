import { useCallback, useMemo } from "react";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { useSessionStore } from "../../store/sessionStore";
import { useUiStateStore } from "../../store/uiStateStore";
import type { SessionOverviewItem } from "../../types";

interface OverviewHandlerDeps {
  switchTab: (agentId: string, sessionId: string) => void;
  closeSession: (agentId: string, sessionId: string) => void;
  sessionOverviewState: { selectedSessionIds?: string[] };
}

export function useOverviewHandlers(deps: OverviewHandlerDeps) {
  const { switchTab, closeSession, sessionOverviewState } = deps;

  const handleFocus = useCallback(
    (sessionId: string, agentId: string) => switchTab(agentId, sessionId),
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
      useUiStateStore.getState().toggleOverviewSelected(sessionId);
    },
    [],
  );

  const handleLongPress = useCallback(
    (sessionId: string) => {
      useUiStateStore.getState().setOverviewSelectionMode(true);
      useUiStateStore.getState().toggleOverviewSelected(sessionId);
    },
    [],
  );

  const handleCloseSelected = useCallback(() => {
    const selectedIds = sessionOverviewState.selectedSessionIds ?? [];
    const sessionInfoMap = useSessionStore.getState().sessionInfoMap;
    for (const sessionId of selectedIds) {
      const entry = Object.entries(sessionInfoMap).find(
        ([, info]) => info.sessionId === sessionId,
      );
      if (entry) {
        const [fullKey] = entry;
        const agentId = fullKey.split(":")[0];
        closeSession(agentId, sessionId);
      }
    }
    useUiStateStore.getState().setOverviewSelectionMode(false);
    useUiStateStore.getState().setOverviewSelectedSessionIds([]);
  }, [sessionOverviewState.selectedSessionIds, closeSession]);

  const handleExitSelectionMode = useCallback(() => {
    useUiStateStore.getState().setOverviewSelectionMode(false);
    useUiStateStore.getState().setOverviewSelectedSessionIds([]);
  }, []);

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
