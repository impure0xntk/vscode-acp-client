import { create } from "zustand";
import type {
  SessionOverviewState,
  SessionOverviewItem,
  SessionProgress,
  ResponsePreview,
  QueuedPrompt,
} from "../types";
import type {
  SessionTabState,
  SessionInfoSnapshot,
  ConnectedAgentInfo,
  AgentInfo,
  WorkspaceFolder,
  SlashCommand,
} from "../hooks/useSessionContext";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Session key = `${agentId}:${sessionId}` */
export function sessionKeyOf(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

/**
 * SessionInfoSnapshot から SessionOverviewItem を導出する。
 * `titleHint` が渡されればそれを使い、なければ sessionId を fallback にする。
 */
export function snapshotToOverviewItem(
  info: SessionInfoSnapshot,
  titleHint?: string,
): SessionOverviewItem {
  const status = info.status;
  const createdAt = info.createdAt ?? new Date().toISOString();

  const elapsedMs =
    (status === "running" && info.lastResponseAt)
      ? Date.now() - new Date(info.lastResponseAt).getTime()
      : 0;

  const progress: SessionProgress = {
    elapsedMs,
    tokenUsage: {
      input: info.tokenUsage?.inputTokens ?? 0,
      output: info.tokenUsage?.outputTokens ?? 0,
      total: info.tokenUsage?.totalTokens ?? 0,
    },
    contextWindow:
      info.contextWindowMax != null
        ? {
            used: info.tokenUsage?.totalTokens ?? 0,
            max: info.contextWindowMax,
            percentage: Math.round(
              ((info.tokenUsage?.totalTokens ?? 0) / info.contextWindowMax) * 100,
            ),
          }
        : undefined,
    messageCount: info.messageCount ?? 0,
    toolCallCount: info.toolCallCount ?? 0,
    toolCallsCompleted: info.toolCallsCompleted ?? 0,
  };

  const recentResponses: ResponsePreview[] = [];

  return {
    sessionId: info.sessionId,
    agentId: info.agentId,
    title: titleHint ?? info.sessionId,
    status,
    model: info.model,
    mode: info.mode,
    progress,
    recentResponses,
    cwd: info.cwd,
    createdAt,
    lastResponseAt: info.lastResponseAt,
  };
}

// ── Store shape ──────────────────────────────────────────────────────────────

export interface SessionState {
  // ── Core session data ──────────────────────────────────────────────────
  /** sessionKey → full snapshot (single source of truth for session data) */
  sessionInfoMap: Record<string, SessionInfoSnapshot>;
  /** Ordered list of session keys for tab bar ordering */
  tabOrder: string[];
  /** Currently active session key */
  activeSessionKey: string | null;

  // ── Tab UI state ──────────────────────────────────────────────────────
  /** User-renamed or auto-generated tab titles, keyed by sessionKey */
  tabTitles: Record<string, string>;
  /** sessionKey → agentIcon (per-tab UI decoration) */
  tabIcons: Record<string, string>;

  // ── Agent / workspace ─────────────────────────────────────────────────
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

  // ── Session Overview panel chrome ─────────────────────────────────────
  sessionOverviewVisible: boolean;
  sessionOverviewWidth: number;
  sessionOverviewPosition: "right" | "left";
  sessionOverviewState: SessionOverviewState;

  // ── Prompt Queue ──────────────────────────────────────────────────────
  /** sessionKey → QueuedPrompt[] */
  promptQueue: Record<string, QueuedPrompt[]>;

  // ── Actions ───────────────────────────────────────────────────────────

  // Session info
  setSessionInfoMap: (map: Record<string, SessionInfoSnapshot>) => void;
  setSessionInfo: (agentId: string, sessionId: string, info: SessionInfoSnapshot) => void;

  // Tabs (order + titles + icons only — no duplicated session data)
  setTabOrder: (order: string[]) => void;
  setTabTitle: (sessionKey: string, title: string) => void;
  setTabIcon: (sessionKey: string, icon: string) => void;
  addTab: (agentId: string, sessionId: string, title?: string) => void;
  removeTab: (sessionKey: string) => void;
  setActiveSession: (sessionKey: string | null) => void;

  // Agent / workspace
  setWorkspaceRoot: (root?: string) => void;
  setAgentInfo: (agentId: string, info: AgentInfo) => void;
  setConnectedAgents: (agents: ConnectedAgentInfo[]) => void;
  setWorkspaceFolders: (folders: WorkspaceFolder[]) => void;
  setSessionCommands: (agentId: string, sessionId: string, commands: SlashCommand[]) => void;
  setStatusline: (statusline: SessionState["statusline"]) => void;

  // Prompt Queue
  setPromptQueue: (sessionKey: string, queue: QueuedPrompt[]) => void;
  addQueuedPrompt: (sessionKey: string, entry: QueuedPrompt) => void;
  removeQueuedPrompt: (sessionKey: string, promptId: string) => void;
  reorderQueuedPrompts: (sessionKey: string, orderedIds: string[]) => void;

  // Overview chrome
  setSessionOverviewVisible: (visible: boolean) => void;
  setSessionOverviewPosition: (position: "right" | "left") => void;
  setSessionOverviewFilter: (filter: SessionOverviewState["filter"]) => void;
  setSessionOverviewExpanded: (sessions: string[]) => void;
  setSessionOverviewWidth: (width: number) => void;
  setSessionOverviewSelected: (sessionIds: string[]) => void;
  toggleSessionOverviewSelected: (sessionId: string) => void;
  setSessionOverviewSelectionMode: (enabled: boolean) => void;
  toggleSessionOverviewSelection: (sessionId: string) => void;

  // Derived
  getOverviewItems: () => SessionOverviewItem[];
  getTabs: () => SessionTabState[];
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionInfoMap: {},
  tabOrder: [],
  activeSessionKey: null,
  tabTitles: {},
  tabIcons: {},
  workspaceRoot: undefined,
  connectedAgents: [],
  agentInfoMap: {},
  workspaceFolders: [],
  sessionCommands: {},
  statusline: { hostname: "", repoName: "", branch: "" },
  promptQueue: {},
  sessionOverviewVisible: false,
  sessionOverviewWidth: 280,
  sessionOverviewPosition: "right",
  sessionOverviewState: {
    filter: "all",
    expandedSessions: [],
    selectedSessionIds: [],
    selectionMode: false,
  },

  // ── Session info ─────────────────────────────────────────────────────────

  setSessionInfoMap: (map) => {
    set((s) => {
      // Merge: keep existing entries that are not in the new map,
      // add new entries from the map. This prevents extension-side
      // re-registration from resurrecting sessions that were already
      // removed on the webview side (e.g. via close button).
      const merged = { ...s.sessionInfoMap };
      for (const [k, v] of Object.entries(map)) {
        merged[k] = v;
      }
      const validKeys = new Set(Object.keys(merged));
      const newOrder = s.tabOrder.filter((k) => validKeys.has(k));
      // Append any new keys not yet in tabOrder
      for (const k of Object.keys(merged)) {
        if (!newOrder.includes(k)) {
          newOrder.push(k);
        }
      }
      return { sessionInfoMap: merged, tabOrder: newOrder };
    });
  },

  setSessionInfo: (agentId, sessionId, info) =>
    set((s) => ({
      sessionInfoMap: { ...s.sessionInfoMap, [sessionKeyOf(agentId, sessionId)]: info },
    })),

  // ── Tabs (order + titles + icons only) ──────────────────────────────────

  setTabOrder: (order) => set({ tabOrder: order }),

  setTabTitle: (key, title) =>
    set((s) => ({ tabTitles: { ...s.tabTitles, [key]: title } })),

  setTabIcon: (key, icon) =>
    set((s) => ({ tabIcons: { ...s.tabIcons, [key]: icon } })),

  addTab: (agentId, sessionId, title) => {
    const key = sessionKeyOf(agentId, sessionId);
    set((s) => {
      const order = s.tabOrder.includes(key) ? s.tabOrder : [...s.tabOrder, key];
      const titles = title ? { ...s.tabTitles, [key]: title } : s.tabTitles;
      return { tabOrder: order, tabTitles: titles, activeSessionKey: key };
    });
  },

  removeTab: (targetKey) =>
    set((s) => {
      const idx = s.tabOrder.indexOf(targetKey);
      if (idx < 0) return {};
      const newOrder = s.tabOrder.filter((k) => k !== targetKey);
      let newActive = s.activeSessionKey;
      if (s.activeSessionKey === targetKey) {
        newActive = newOrder.length > 0
          ? newOrder[Math.min(idx, newOrder.length - 1)]
          : null;
      }
      // Also remove from sessionInfoMap so the session disappears from overview immediately
      const newMap = { ...s.sessionInfoMap };
      delete newMap[targetKey];
      // Clear prompt queue for the removed session
      const newQueue = { ...s.promptQueue };
      delete newQueue[targetKey];
      return { tabOrder: newOrder, activeSessionKey: newActive, sessionInfoMap: newMap, promptQueue: newQueue };
    }),

  setActiveSession: (sessionKey) => set({ activeSessionKey: sessionKey }),

  // ── Agent / workspace ───────────────────────────────────────────────────

  setWorkspaceRoot: (root) => set({ workspaceRoot: root }),
  setAgentInfo: (agentId, info) =>
    set((s) => ({ agentInfoMap: { ...s.agentInfoMap, [agentId]: info } })),
  setConnectedAgents: (agents) => set({ connectedAgents: agents }),
  setWorkspaceFolders: (folders) => set({ workspaceFolders: folders }),
  setSessionCommands: (agentId, sessionId, commands) =>
    set((s) => ({
      sessionCommands: {
        ...s.sessionCommands,
        [sessionKeyOf(agentId, sessionId)]: commands,
      },
    })),
  setStatusline: (statusline) => set({ statusline }),

  // ── Prompt Queue ──────────────────────────────────────────────────────────

  setPromptQueue: (sessionKey, queue) =>
    set((s) => ({ promptQueue: { ...s.promptQueue, [sessionKey]: queue } })),

  addQueuedPrompt: (sessionKey, entry) =>
    set((s) => ({
      promptQueue: {
        ...s.promptQueue,
        [sessionKey]: [...(s.promptQueue[sessionKey] ?? []), entry],
      },
    })),

  removeQueuedPrompt: (sessionKey, promptId) =>
    set((s) => {
      const q = s.promptQueue[sessionKey] ?? [];
      const next = q.filter((e) => e.id !== promptId);
      return { promptQueue: { ...s.promptQueue, [sessionKey]: next } };
    }),

  reorderQueuedPrompts: (sessionKey, orderedIds) =>
    set((s) => {
      const q = s.promptQueue[sessionKey] ?? [];
      const pending = q.filter((e) => e.status === "pending");
      const sending = q.filter((e) => e.status !== "pending");
      const reordered = orderedIds
        .map((id) => pending.find((e) => e.id === id))
        .filter((e): e is QueuedPrompt => e !== undefined);
      for (const e of pending) {
        if (!orderedIds.includes(e.id)) reordered.push(e);
      }
      return {
        promptQueue: { ...s.promptQueue, [sessionKey]: [...reordered, ...sending] },
      };
    }),

  // ── Overview chrome ─────────────────────────────────────────────────────

  setSessionOverviewVisible: (visible) => set({ sessionOverviewVisible: visible }),
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

  // ── Derived getters ─────────────────────────────────────────────────────

  getOverviewItems: () => {
    const { sessionInfoMap, tabOrder, tabTitles } = useSessionStore.getState();
    const orderedKeys = tabOrder.length > 0
      ? tabOrder
      : Object.keys(sessionInfoMap);

    return orderedKeys
      .filter((key) => sessionInfoMap[key])
      .map((key) => {
        const info = sessionInfoMap[key]!;
        const title = tabTitles[key];
        return snapshotToOverviewItem(info, title);
      });
  },

  getTabs: () => {
    const { sessionInfoMap, tabOrder, tabTitles, tabIcons } = useSessionStore.getState();
    const orderedKeys = tabOrder.length > 0
      ? tabOrder
      : Object.keys(sessionInfoMap);

    return orderedKeys
      .filter((key) => sessionInfoMap[key])
      .map((key): SessionTabState => {
        const [agentId, sessionId] = key.split(":");
        return {
          sessionId,
          agentId,
          title: tabTitles[key] ?? sessionId,
          agentIcon: tabIcons[key],
        };
      });
  },
}));
