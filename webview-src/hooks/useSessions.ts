import { useSessionStore } from "../store/sessionStore";
import type { SessionTabState, SessionInfoSnapshot } from "../store/sessionStore";

// ── Session / Tab hooks ─────────────────────────────────────────────────────

/**
 * Subscribe to tab/session state and actions.
 */
export function useSessions() {
  // Read via getState() to avoid useSyncExternalStore subscription.
  // useSessionStore(selector) would subscribe and trigger infinite re-renders
  // because every store write creates new object/array references.
  const s = useSessionStore.getState();

  return {
    // State — tabs is derived, not a direct property
    tabs: s.getTabs(),
    activeSessionId: s.activeSessionKey?.split(":")[1] ?? null,
    activeAgentId: s.activeSessionKey?.split(":")[0] ?? null,
    workspaceRoot: s.workspaceRoot,
    connectedAgents: s.connectedAgents,
    agentInfoMap: s.agentInfoMap,
    workspaceFolders: s.workspaceFolders,
    sessionInfoMap: s.sessionInfoMap,
    statusline: s.statusline,
    // Actions
    setTabs: s.setTabOrder,
    addTab: s.addTab,
    removeTab: s.removeTab,
    updateTab: s.setTabTitle,
    setActiveSession: s.setActiveSession,
    reorderTabs: s.setTabOrder,
    setWorkspaceRoot: s.setWorkspaceRoot,
    setAgentInfo: s.setAgentInfo,
    setConnectedAgents: s.setConnectedAgents,
    setWorkspaceFolders: s.setWorkspaceFolders,
    setSessionCommands: s.setSessionCommands,
    setStatusline: s.setStatusline,
    setSessionInfoMap: s.setSessionInfoMap,
    setSessionInfo: s.setSessionInfo,
  };
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
