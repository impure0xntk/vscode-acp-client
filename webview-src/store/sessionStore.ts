import { create } from "zustand";
import type {
  SessionTabState,
  SessionInfoSnapshot,
  ConnectedAgentInfo,
  AgentInfo,
  WorkspaceFolder,
  SlashCommand,
  SessionOverviewState,
} from "../hooks/useSessionContext";

// ── Session / Tab store ─────────────────────────────────────────────────────

interface SessionState {
  tabs: SessionTabState[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  workspaceRoot?: string;
  connectedAgents: ConnectedAgentInfo[];
  agentInfoMap: Record<string, AgentInfo>;
  workspaceFolders: WorkspaceFolder[];
  /** sessionKey → SlashCommand[] */
  sessionCommands: Record<string, SlashCommand[]>;
  statusline: {
    hostname?: string;
    repoName?: string;
    branch?: string;
    tag?: string;
  };
  /** sessionKey → SessionInfoSnapshot */
  sessionInfoMap: Record<string, SessionInfoSnapshot>;

  // Session Overview state
  sessionOverviewVisible: boolean;
  sessionOverviewWidth: number;
  sessionOverviewPosition: "right" | "left";
  sessionOverviewState: SessionOverviewState;

  // Actions
  setTabs: (tabs: SessionTabState[]) => void;
  addTab: (tab: SessionTabState) => void;
  removeTab: (sessionId: string) => void;
  updateTab: (sessionId: string, updates: Partial<SessionTabState>) => void;
  setActiveSession: (sessionId: string, agentId: string) => void;
  reorderTabs: (tabs: SessionTabState[]) => void;
  incrementUnread: (sessionId: string, agentId: string) => void;
  setWorkspaceRoot: (root?: string) => void;
  setAgentInfo: (agentId: string, info: AgentInfo) => void;
  setConnectedAgents: (agents: ConnectedAgentInfo[]) => void;
  setWorkspaceFolders: (folders: WorkspaceFolder[]) => void;
  setSessionCommands: (agentId: string, sessionId: string, commands: SlashCommand[]) => void;
  setStatusline: (statusline: SessionState["statusline"]) => void;
  setSessionInfoMap: (map: Record<string, SessionInfoSnapshot>) => void;
  setSessionInfo: (agentId: string, sessionId: string, info: SessionInfoSnapshot) => void;

  // Overview actions
  setSessionOverviewVisible: (visible: boolean) => void;
  setSessionOverviewState: (state: SessionOverviewState) => void;
  setSessionOverviewPosition: (position: "right" | "left") => void;
  setSessionOverviewFilter: (filter: SessionOverviewState["filter"]) => void;
  setSessionOverviewExpanded: (sessions: string[]) => void;
  setSessionOverviewWidth: (width: number) => void;
  setSessionOverviewSelected: (sessionIds: string[]) => void;
  toggleSessionOverviewSelected: (sessionId: string) => void;
  setSessionOverviewSelectionMode: (enabled: boolean) => void;
  toggleSessionOverviewSelection: (sessionId: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  tabs: [],
  activeSessionId: null,
  activeAgentId: null,
  workspaceRoot: undefined,
  connectedAgents: [],
  agentInfoMap: {},
  workspaceFolders: [],
  sessionCommands: {},
  statusline: { hostname: "", repoName: "", branch: "" },
  sessionInfoMap: {},
  sessionOverviewVisible: false,
  sessionOverviewWidth: 280,
  sessionOverviewPosition: "right",
  sessionOverviewState: {
    sessions: [],
    lastUpdated: new Date().toISOString(),
    filter: "all",
    expandedSessions: [],
    selectedSessionIds: [],
    selectionMode: false,
  },

  setTabs: (tabs) =>
    set((s) => {
      if (tabs.length === 1 && !s.activeSessionId) {
        return {
          tabs,
          activeSessionId: tabs[0].sessionId,
          activeAgentId: tabs[0].agentId,
          sessionOverviewState: {
            ...s.sessionOverviewState,
            activeSessionId: tabs[0].sessionId,
            activeAgentId: tabs[0].agentId,
          },
        };
      }
      return { tabs };
    }),

  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeSessionId: tab.sessionId,
      activeAgentId: tab.agentId,
    })),

  removeTab: (sessionId) =>
    set((s) => {
      const removedTab = s.tabs.find(
        (t) => t.sessionId === sessionId && t.agentId === s.activeAgentId
      );
      const newTabs = removedTab
        ? s.tabs.filter(
            (t) => !(t.sessionId === sessionId && t.agentId === removedTab.agentId)
          )
        : s.tabs.filter((t) => t.sessionId !== sessionId);

      let newActiveSessionId = s.activeSessionId;
      let newActiveAgentId = s.activeAgentId;
      if (s.activeSessionId === sessionId && s.activeAgentId === removedTab?.agentId) {
        if (newTabs.length > 0) {
          newActiveSessionId = newTabs[newTabs.length - 1].sessionId;
          newActiveAgentId = newTabs[newTabs.length - 1].agentId;
        } else {
          newActiveSessionId = null;
          newActiveAgentId = null;
        }
      }
      return { tabs: newTabs, activeSessionId: newActiveSessionId, activeAgentId: newActiveAgentId };
    }),

  updateTab: (sessionId, updates) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === sessionId ? { ...t, ...updates } : t
      ),
    })),

  setActiveSession: (sessionId, agentId) =>
    set(() => ({ activeSessionId: sessionId, activeAgentId: agentId })),

  reorderTabs: (tabs) => set({ tabs }),

  incrementUnread: (sessionId, agentId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === sessionId && t.agentId === agentId
          ? { ...t, unreadCount: t.unreadCount + 1 }
          : t
      ),
    })),

  setWorkspaceRoot: (root) => set({ workspaceRoot: root }),

  setAgentInfo: (agentId, info) =>
    set((s) => ({ agentInfoMap: { ...s.agentInfoMap, [agentId]: info } })),

  setConnectedAgents: (agents) => set({ connectedAgents: agents }),

  setWorkspaceFolders: (folders) => set({ workspaceFolders: folders }),

  setSessionCommands: (agentId, sessionId, commands) =>
    set((s) => ({
      sessionCommands: {
        ...s.sessionCommands,
        [`${agentId}:${sessionId}`]: commands,
      },
    })),

  setStatusline: (statusline) => set({ statusline }),

  setSessionInfoMap: (map) => set({ sessionInfoMap: map }),

  setSessionInfo: (agentId, sessionId, info) =>
    set((s) => ({
      sessionInfoMap: { ...s.sessionInfoMap, [`${agentId}:${sessionId}`]: info },
    })),

  // Overview
  setSessionOverviewVisible: (visible) => set({ sessionOverviewVisible: visible }),
  setSessionOverviewState: (state) =>
    set((s) => ({
      sessionOverviewState: {
        filter: s.sessionOverviewState.filter,
        selectionMode: s.sessionOverviewState.selectionMode,
        selectedSessionIds: s.sessionOverviewState.selectedSessionIds,
        ...state,
        activeSessionId: state.activeSessionId ?? s.activeSessionId,
        activeAgentId: state.activeAgentId ?? s.activeAgentId,
      },
    })),
  setSessionOverviewPosition: (position) => set({ sessionOverviewPosition: position }),
  setSessionOverviewFilter: (filter) =>
    set((s) => ({
      sessionOverviewState: { ...s.sessionOverviewState, filter },
    })),
  setSessionOverviewExpanded: (sessions) =>
    set((s) => ({
      sessionOverviewState: { ...s.sessionOverviewState, expandedSessions: sessions },
    })),
  setSessionOverviewWidth: (width) => set({ sessionOverviewWidth: width }),
  setSessionOverviewSelected: (sessionIds) =>
    set((s) => ({
      sessionOverviewState: { ...s.sessionOverviewState, selectedSessionIds: sessionIds },
    })),
  toggleSessionOverviewSelected: (sessionId) =>
    set((s) => {
      const current = s.sessionOverviewState.selectedSessionIds ?? [];
      const idx = current.indexOf(sessionId);
      const next = idx >= 0
        ? [...current.slice(0, idx), ...current.slice(idx + 1)]
        : [...current, sessionId];
      return {
        sessionOverviewState: { ...s.sessionOverviewState, selectedSessionIds: next },
      };
    }),
  setSessionOverviewSelectionMode: (enabled) =>
    set((s) => ({
      sessionOverviewState: { ...s.sessionOverviewState, selectionMode: enabled },
    })),
  toggleSessionOverviewSelection: (sessionId) =>
    set((s) => {
      const current = s.sessionOverviewState.selectedSessionIds ?? [];
      const idx = current.indexOf(sessionId);
      const next = idx >= 0
        ? [...current.slice(0, idx), ...current.slice(idx + 1)]
        : [...current, sessionId];
      return {
        sessionOverviewState: {
          ...s.sessionOverviewState,
          selectionMode: true,
          selectedSessionIds: next,
        },
      };
    }),
}));
