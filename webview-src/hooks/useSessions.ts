import { useSyncExternalStore, useCallback } from "react";
import { useSessionStore } from "../store/sessionStore";
import type { SessionInfoSnapshot, SessionTabState } from "../store/sessionStore";

// ── Session / Tab hooks ─────────────────────────────────────────────────────

/**
 * Subscribe to tab/session structural state and actions.
 * Does NOT include sessionInfoMap — use useSessionInfo(sessionKey) for
 * per-session live fields instead.
 */
export function useSessions() {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return useSessionStore.subscribe((state, prevState) => {
        if (
          state.activeSessionKey !== prevState.activeSessionKey ||
          state.tabOrder !== prevState.tabOrder ||
          state.tabTitles !== prevState.tabTitles ||
          state.tabIcons !== prevState.tabIcons ||
          state.workspaceRoot !== prevState.workspaceRoot ||
          state.connectedAgents !== prevState.connectedAgents ||
          state.agentInfoMap !== prevState.agentInfoMap ||
          state.workspaceFolders !== prevState.workspaceFolders ||
          state.statusline !== prevState.statusline
        ) {
          onStoreChange();
        }
      });
    },
    [],
  );

  const getSnapshot = useCallback(() => {
    const s = useSessionStore.getState();
    return {
      tabs: s.getTabs(),
      activeSessionId: s.activeSessionKey?.split(":")[1] ?? null,
      activeAgentId: s.activeSessionKey?.split(":")[0] ?? null,
      workspaceRoot: s.workspaceRoot,
      connectedAgents: s.connectedAgents,
      agentInfoMap: s.agentInfoMap,
      workspaceFolders: s.workspaceFolders,
      statusline: s.statusline,
      // Actions
      setTabOrder: s.setTabOrder,
      addTab: s.addTab,
      removeTab: s.removeTab,
      setTabTitle: s.setTabTitle,
      setActiveSession: s.setActiveSession,
      setWorkspaceRoot: s.setWorkspaceRoot,
      setAgentInfo: s.setAgentInfo,
      setConnectedAgents: s.setConnectedAgents,
      setWorkspaceFolders: s.setWorkspaceFolders,
      setSessionCommands: s.setSessionCommands,
      setStatusline: s.setStatusline,
      setSessionInfo: s.setSessionInfo,
    };
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Derive the active session key string.
 */
export function computeActiveSessionKey(
  activeAgentId: string | null,
  activeSessionId: string | null
): string | null {
  if (activeAgentId && activeSessionId) {
    return `${activeAgentId}:${activeSessionId}`;
  }
  return null;
}

/**
 * Get the SessionInfoSnapshot for the active session.
 */
export function useActiveSessionInfo(): SessionInfoSnapshot | undefined {
  const s = useSessionStore.getState();
  const activeSessionId = s.activeSessionKey?.split(":")[1] ?? null;
  const activeAgentId = s.activeSessionKey?.split(":")[0] ?? null;
  const sessionInfoMap = s.sessionInfoMap;

  if (activeAgentId && activeSessionId) {
    return sessionInfoMap[`${activeAgentId}:${activeSessionId}`];
  }
  return undefined;
}

/**
 * Get available slash commands for the active session.
 */
export function useActiveCommands() {
  const s = useSessionStore.getState();
  const activeSessionId = s.activeSessionKey?.split(":")[1] ?? null;
  const activeAgentId = s.activeSessionKey?.split(":")[0] ?? null;
  const sessionCommands = s.sessionCommands;

  if (activeAgentId && activeSessionId) {
    return sessionCommands[`${activeAgentId}:${activeSessionId}`] ?? [];
  }
  return [];
}
