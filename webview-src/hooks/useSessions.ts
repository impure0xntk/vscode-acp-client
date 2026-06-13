import { useSessionStore } from "../store/sessionStore";
import type { SessionTabState, SessionInfoSnapshot } from "./useSessionContext";

// ── Session / Tab hooks ─────────────────────────────────────────────────────

/**
 * Subscribe to tab/session state and actions.
 */
export function useSessions() {
  const tabs = useSessionStore((s) => s.tabs);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeAgentId = useSessionStore((s) => s.activeAgentId);
  const workspaceRoot = useSessionStore((s) => s.workspaceRoot);
  const connectedAgents = useSessionStore((s) => s.connectedAgents);
  const agentInfoMap = useSessionStore((s) => s.agentInfoMap);
  const workspaceFolders = useSessionStore((s) => s.workspaceFolders);
  const sessionInfoMap = useSessionStore((s) => s.sessionInfoMap);
  const statusline = useSessionStore((s) => s.statusline);

  const setTabs = useSessionStore((s) => s.setTabs);
  const addTab = useSessionStore((s) => s.addTab);
  const removeTab = useSessionStore((s) => s.removeTab);
  const updateTab = useSessionStore((s) => s.updateTab);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const reorderTabs = useSessionStore((s) => s.reorderTabs);
  const incrementUnread = useSessionStore((s) => s.incrementUnread);
  const setWorkspaceRoot = useSessionStore((s) => s.setWorkspaceRoot);
  const setAgentInfo = useSessionStore((s) => s.setAgentInfo);
  const setConnectedAgents = useSessionStore((s) => s.setConnectedAgents);
  const setWorkspaceFolders = useSessionStore((s) => s.setWorkspaceFolders);
  const setSessionCommands = useSessionStore((s) => s.setSessionCommands);
  const setStatusline = useSessionStore((s) => s.setStatusline);
  const setSessionInfoMap = useSessionStore((s) => s.setSessionInfoMap);
  const setSessionInfo = useSessionStore((s) => s.setSessionInfo);

  return {
    // State
    tabs,
    activeSessionId,
    activeAgentId,
    workspaceRoot,
    connectedAgents,
    agentInfoMap,
    workspaceFolders,
    sessionInfoMap,
    statusline,
    // Actions
    setTabs,
    addTab,
    removeTab,
    updateTab,
    setActiveSession,
    reorderTabs,
    incrementUnread,
    setWorkspaceRoot,
    setAgentInfo,
    setConnectedAgents,
    setWorkspaceFolders,
    setSessionCommands,
    setStatusline,
    setSessionInfoMap,
    setSessionInfo,
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
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeAgentId = useSessionStore((s) => s.activeAgentId);
  const sessionInfoMap = useSessionStore((s) => s.sessionInfoMap);

  if (activeAgentId && activeSessionId) {
    return sessionInfoMap[`${activeAgentId}:${activeSessionId}`];
  }
  return undefined;
}

/**
 * Get available slash commands for the active session.
 */
export function useActiveCommands() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeAgentId = useSessionStore((s) => s.activeAgentId);
  const sessionCommands = useSessionStore((s) => s.sessionCommands);

  if (activeAgentId && activeSessionId) {
    return sessionCommands[`${activeAgentId}:${activeSessionId}`] ?? [];
  }
  return [];
}
