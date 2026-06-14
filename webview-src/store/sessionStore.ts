import { create } from "zustand";
import { produce } from "immer";
import { getLogger } from "../lib/logger";

const log = getLogger("sessionStore");
import type {
  SessionOverviewItem,
  SessionProgress,
  ResponsePreview,
} from "../types";
import type { QueuedPrompt } from "../types.d";

// ── Re-exported types (previously from useSessionContext) ──────────────────

export interface SessionTabState {
  sessionId: string;
  agentId: string;
  title: string;
  agentIcon?: string;
}

export interface SessionInfoSnapshot {
  sessionId: string;
  agentId: string;
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  isTurnActive: boolean;
  isStreaming: boolean;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  messageCount?: number;
  toolCallCount?: number;
  toolCallsCompleted?: number;
  createdAt?: string;
  lastResponseAt?: string | null;
}

export interface AgentInfo {
  name: string;
  version?: string;
  capabilities?: string[];
}

export interface ConnectedAgentInfo extends AgentInfo {
  agentId: string;
  color?: string;
}

export interface WorkspaceFolder {
  name: string;
  uri: string;
}

export interface SlashCommand {
  name: string;
  description?: string;
  agentId?: string;
}

export type SessionTabStatus = "idle" | "running" | "completed" | "error" | "cancelled";

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
    lastResponseAt: info.lastResponseAt ?? null,
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

  // ── Prompt Queue ──────────────────────────────────────────────────────
  /** sessionKey → QueuedPrompt[] */
  promptQueue: Record<string, QueuedPrompt[]>;

  // ── Actions ───────────────────────────────────────────────────────────

  // Session info
  setSessionInfoMap: (map: Record<string, SessionInfoSnapshot>) => void;
  setSessionInfo: (agentId: string, sessionId: string, info: SessionInfoSnapshot) => void;
  updateMessageCount: (agentId: string, sessionId: string, count: number) => void;

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

  // Bulk operations
  bulkSetTabs: (params: {
    tabs: SessionTabState[];
    workspaceRoot?: string;
    connectedAgents?: ConnectedAgentInfo[];
    workspaceFolders?: WorkspaceFolder[];
    agentInfoMap?: Record<string, AgentInfo>;
    sessionInfoMap?: Record<string, SessionInfoSnapshot>;
  }) => void;

  // Derived
  // Note: these create new objects each call — only call inside useMemo/useCallback
  // with stable upstream dependencies (sessionInfoMap, tabOrder, tabTitles).
  // DO NOT use directly in useShallow — use selectSessionInfoMap + selectTabOrder + selectTabTitles instead.
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

  // ── Session info ─────────────────────────────────────────────────────────

  setSessionInfoMap: (map) => {
    log.debug("setSessionInfoMap", { count: Object.keys(map).length });
    set(produce((draft: SessionState) => {
      for (const [k, v] of Object.entries(map)) {
        draft.sessionInfoMap[k] = v;
      }
      const validKeys = new Set(Object.keys(draft.sessionInfoMap));
      const newOrder = draft.tabOrder.filter((k) => validKeys.has(k));
      for (const k of Object.keys(draft.sessionInfoMap)) {
        if (!newOrder.includes(k)) {
          newOrder.push(k);
        }
      }
      draft.tabOrder = newOrder;
    }));
  },

  setSessionInfo: (agentId, sessionId, info) =>
    set(produce((draft: SessionState) => {
      const key = sessionKeyOf(agentId, sessionId);
      log.debug("setSessionInfo", { agentId, sessionId, status: info.status, isTurnActive: info.isTurnActive });
      draft.sessionInfoMap[key] = info;
    })),

  updateMessageCount: (agentId, sessionId, count) =>
    set(produce((draft: SessionState) => {
      const key = sessionKeyOf(agentId, sessionId);
      const existing = draft.sessionInfoMap[key];
      if (existing) existing.messageCount = count;
    })),

  // ── Tabs (order + titles + icons only) ──────────────────────────────────

  setTabOrder: (order) => set({ tabOrder: order }),

  setTabTitle: (key, title) =>
    set(produce((draft: SessionState) => {
      draft.tabTitles[key] = title;
    })),

  setTabIcon: (key, icon) =>
    set(produce((draft: SessionState) => {
      draft.tabIcons[key] = icon;
    })),

  addTab: (agentId, sessionId, title) => {
    const key = sessionKeyOf(agentId, sessionId);
    set(produce((draft: SessionState) => {
      if (!draft.tabOrder.includes(key)) draft.tabOrder.push(key);
      if (title) draft.tabTitles[key] = title;
      draft.activeSessionKey = key;
    }));
  },

  removeTab: (targetKey) =>
    set(produce((draft: SessionState) => {
      const idx = draft.tabOrder.indexOf(targetKey);
      if (idx < 0) return;
      draft.tabOrder = draft.tabOrder.filter((k) => k !== targetKey);
      if (draft.activeSessionKey === targetKey) {
        draft.activeSessionKey = draft.tabOrder.length > 0
          ? draft.tabOrder[Math.min(idx, draft.tabOrder.length - 1)]
          : null;
      }
      delete draft.sessionInfoMap[targetKey];
      delete draft.promptQueue[targetKey];
    })),

  setActiveSession: (sessionKey) => set({ activeSessionKey: sessionKey }),

  // ── Agent / workspace ───────────────────────────────────────────────────

  setWorkspaceRoot: (root) => set({ workspaceRoot: root }),
  setAgentInfo: (agentId, info) =>
    set(produce((draft: SessionState) => {
      draft.agentInfoMap[agentId] = info;
    })),
  setConnectedAgents: (agents) => set({ connectedAgents: agents }),
  setWorkspaceFolders: (folders) => set({ workspaceFolders: folders }),
  setSessionCommands: (agentId, sessionId, commands) =>
    set(produce((draft: SessionState) => {
      draft.sessionCommands[sessionKeyOf(agentId, sessionId)] = commands;
    })),
  setStatusline: (statusline) => set({ statusline }),

  // ── Prompt Queue ──────────────────────────────────────────────────────────

  setPromptQueue: (sessionKey, queue) =>
    set(produce((draft: SessionState) => {
      draft.promptQueue[sessionKey] = queue;
    })),

  addQueuedPrompt: (sessionKey, entry) =>
    set(produce((draft: SessionState) => {
      if (!draft.promptQueue[sessionKey]) draft.promptQueue[sessionKey] = [];
      draft.promptQueue[sessionKey].push(entry);
    })),

  removeQueuedPrompt: (sessionKey, promptId) =>
    set(produce((draft: SessionState) => {
      const q = draft.promptQueue[sessionKey];
      if (q) draft.promptQueue[sessionKey] = q.filter((e) => e.id !== promptId);
    })),

  reorderQueuedPrompts: (sessionKey, orderedIds) =>
    set(produce((draft: SessionState) => {
      const q = draft.promptQueue[sessionKey] ?? [];
      const pending = q.filter((e) => e.status === "pending");
      const sending = q.filter((e) => e.status !== "pending");
      const reordered = orderedIds
        .map((id) => pending.find((e) => e.id === id))
        .filter((e): e is QueuedPrompt => e !== undefined);
      for (const e of pending) {
        if (!orderedIds.includes(e.id)) reordered.push(e);
      }
      draft.promptQueue[sessionKey] = [...reordered, ...sending];
    })),

  // ── Bulk operations ─────────────────────────────────────────────────────

  bulkSetTabs: (params) => {
    set(produce((draft: SessionState) => {
      const order: string[] = [];
      const titles: Record<string, string> = {};
      for (const t of params.tabs) {
        const key = sessionKeyOf(t.agentId, t.sessionId);
        order.push(key);
        if (t.title) titles[key] = t.title;
      }
      draft.tabOrder = order;
      Object.assign(draft.tabTitles, titles);
      if (params.workspaceRoot !== undefined) draft.workspaceRoot = params.workspaceRoot;
      if (params.connectedAgents) draft.connectedAgents = params.connectedAgents;
      if (params.workspaceFolders) draft.workspaceFolders = params.workspaceFolders;
      if (params.agentInfoMap) Object.assign(draft.agentInfoMap, params.agentInfoMap);
      if (params.sessionInfoMap) Object.assign(draft.sessionInfoMap, params.sessionInfoMap);
    }));
  },

  // ── Derived getters ─────────────────────────────────────────────────────

  getOverviewItems: (): SessionOverviewItem[] => {
    const state = useSessionStore.getState();
    const { sessionInfoMap, tabOrder, tabTitles } = state;
    const orderedKeys = tabOrder.length > 0
      ? tabOrder
      : Object.keys(sessionInfoMap);

    return orderedKeys
      .filter((key: string) => sessionInfoMap[key])
      .map((key: string) => {
        const info = sessionInfoMap[key]!;
        const title = tabTitles[key];
        return snapshotToOverviewItem(info, title);
      });
  },

  getTabs: (): SessionTabState[] => {
    const state = useSessionStore.getState();
    const { sessionInfoMap, tabOrder, tabTitles, tabIcons } = state;
    const orderedKeys = tabOrder.length > 0
      ? tabOrder
      : Object.keys(sessionInfoMap);

    return orderedKeys
      .filter((key: string) => sessionInfoMap[key])
      .map((key: string): SessionTabState => {
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
