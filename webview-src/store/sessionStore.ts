import { create } from "zustand";
import { produce } from "immer";
import { getLogger } from "../lib/logger";

const log = getLogger("sessionStore");
import type {
  SessionOverviewItem,
  SessionProgress,
  ResponsePreview,
  QueuedPrompt,
} from "../types";

// ── Re-exported types (previously from useSessionContext) ──────────────────

export interface SessionTabState {
  sessionId: string;
  agentId: string;
  title: string;
  agentIcon?: string;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
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
  title?: string;
  version?: string;
  protocolVersion?: string | number;
  capabilities?: {
    loadSession?: boolean;
    sessionCapabilities?: {
      fork?: boolean;
      list?: boolean;
      resume?: boolean;
      delete?: boolean;
      close?: boolean;
      additionalDirectories?: boolean;
    };
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
  };
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

// ── Selectors (reactive, for use inside components) ────────────────────────
//
// These are plain selector functions compatible with Zustand's `use(selector)`.
// They memoize based on Zustand's built-in shallow comparison of the selected
// slice, which means overview items won't recompute unless sessionInfoMap,
// tabOrder, or tabTitles actually change.

export function selectOverviewItems(state: SessionState): SessionOverviewItem[] {
  const { sessionInfoMap, tabOrder, tabTitles } = state;
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
}

export function selectOverviewItemsMap(state: SessionState): Record<string, SessionOverviewItem> {
  const items = selectOverviewItems(state);
  const acc: Record<string, SessionOverviewItem> = {};
  for (const item of items) {
    acc[`${item.agentId}:${item.sessionId}`] = item;
  }
  return acc;
}

export function selectTabs(state: SessionState): SessionTabState[] {
  const { sessionInfoMap, tabOrder, tabTitles, tabIcons } = state;
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
}

/** Compare two SessionInfoSnapshot for equality (shallow field comparison). */
function sessionInfoEquals(a: SessionInfoSnapshot, b: SessionInfoSnapshot): boolean {
  return (
    a.status === b.status &&
    a.isTurnActive === b.isTurnActive &&
    a.isStreaming === b.isStreaming &&
    a.tokenUsage?.inputTokens === b.tokenUsage?.inputTokens &&
    a.tokenUsage?.outputTokens === b.tokenUsage?.outputTokens &&
    a.tokenUsage?.totalTokens === b.tokenUsage?.totalTokens &&
    a.contextWindowMax === b.contextWindowMax &&
    a.model === b.model &&
    a.mode === b.mode &&
    a.cwd === b.cwd &&
    a.messageCount === b.messageCount &&
    a.toolCallCount === b.toolCallCount &&
    a.toolCallsCompleted === b.toolCallsCompleted &&
    a.createdAt === b.createdAt &&
    a.lastResponseAt === b.lastResponseAt
  );
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
      let changed = false;
      for (const [k, v] of Object.entries(map)) {
        const prev = draft.sessionInfoMap[k];
        if (!prev || !sessionInfoEquals(prev, v)) {
          draft.sessionInfoMap[k] = v;
          changed = true;
        }
      }
      if (!changed) return;
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
      const prev = draft.sessionInfoMap[key];
      if (prev && sessionInfoEquals(prev, info)) return;
      log.debug("setSessionInfo", { agentId, sessionId, status: info.status, isTurnActive: info.isTurnActive });
      // Mutate in-place via immer; only the changed entry is replaced
      draft.sessionInfoMap[key] = info;
    })),

  /**
   * Update a single field on a session info entry without replacing the
   * entire sessionInfoMap reference. Uses immer produce so the change is
   * structural-shared with the previous state.
   */
  updateSessionField: <K extends keyof SessionInfoSnapshot>(
    agentId: string,
    sessionId: string,
    field: K,
    value: SessionInfoSnapshot[K],
  ) =>
    set(produce((draft: SessionState) => {
      const key = sessionKeyOf(agentId, sessionId);
      const prev = draft.sessionInfoMap[key];
      if (prev && prev[field] === value) return;
      if (prev) {
        prev[field] = value;
      }
    })),

  updateMessageCount: (agentId, sessionId, count) =>
    set(produce((draft: SessionState) => {
      const key = sessionKeyOf(agentId, sessionId);
      const existing = draft.sessionInfoMap[key];
      if (existing && existing.messageCount !== count) {
        existing.messageCount = count;
      }
    })),

  // ── Tabs (order + titles + icons only) ──────────────────────────────────

  setTabOrder: (order) => set((s) => s.tabOrder === order ? s : { tabOrder: order }),

  setTabTitle: (key, title) =>
    set(produce((draft: SessionState) => {
      if (draft.tabTitles[key] === title) return;
      draft.tabTitles[key] = title;
    })),

  setTabIcon: (key, icon) =>
    set(produce((draft: SessionState) => {
      if (draft.tabIcons[key] === icon) return;
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

  setActiveSession: (sessionKey) => set((s) => s.activeSessionKey === sessionKey ? s : { activeSessionKey: sessionKey }),

  // ── Agent / workspace ───────────────────────────────────────────────────

  setWorkspaceRoot: (root) => set((s) => s.workspaceRoot === root ? s : { workspaceRoot: root }),
  setAgentInfo: (agentId, info) =>
    set(produce((draft: SessionState) => {
      const prev = draft.agentInfoMap[agentId];
      if (prev === info) return;
      draft.agentInfoMap[agentId] = info;
    })),
  setConnectedAgents: (agents) => set((s) => s.connectedAgents === agents ? s : { connectedAgents: agents }),
  setWorkspaceFolders: (folders) => set((s) => s.workspaceFolders === folders ? s : { workspaceFolders: folders }),
  setSessionCommands: (agentId, sessionId, commands) =>
    set(produce((draft: SessionState) => {
      const key = sessionKeyOf(agentId, sessionId);
      if (draft.sessionCommands[key] === commands) return;
      draft.sessionCommands[key] = commands;
    })),
  setStatusline: (statusline) =>
    set((s) => s.statusline === statusline ? s : { statusline }),

  // ── Prompt Queue ──────────────────────────────────────────────────────────

  setPromptQueue: (sessionKey, queue) =>
    set(produce((draft: SessionState) => {
      if (draft.promptQueue[sessionKey] === queue) return;
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
      if (!q) return;
      const filtered = q.filter((e) => e.id !== promptId);
      if (filtered.length === q.length) return;
      draft.promptQueue[sessionKey] = filtered;
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
      let changed = false;
      if (draft.tabOrder.length !== order.length || draft.tabOrder.some((k, i) => k !== order[i])) {
        draft.tabOrder = order;
        changed = true;
      }
      for (const [k, v] of Object.entries(titles)) {
        if (draft.tabTitles[k] !== v) { draft.tabTitles[k] = v; changed = true; }
      }
      if (params.workspaceRoot !== undefined && draft.workspaceRoot !== params.workspaceRoot) {
        draft.workspaceRoot = params.workspaceRoot; changed = true;
      }
      if (params.connectedAgents && draft.connectedAgents !== params.connectedAgents) {
        draft.connectedAgents = params.connectedAgents; changed = true;
      }
      if (params.workspaceFolders && draft.workspaceFolders !== params.workspaceFolders) {
        draft.workspaceFolders = params.workspaceFolders; changed = true;
      }
      if (params.agentInfoMap) {
        for (const [k, v] of Object.entries(params.agentInfoMap)) {
          if (draft.agentInfoMap[k] !== v) { draft.agentInfoMap[k] = v; changed = true; }
        }
      }
      if (params.sessionInfoMap) {
        for (const [k, v] of Object.entries(params.sessionInfoMap)) {
          const prev = draft.sessionInfoMap[k];
          if (!prev || !sessionInfoEquals(prev, v)) {
            draft.sessionInfoMap[k] = v; changed = true;
          }
        }
      }
      // If nothing changed, return current state to avoid triggering subscribers
      if (!changed) return;
    }));
  },

  // ── Derived (deprecated: use selectors instead) ──────────────────────────

  getOverviewItems: (): SessionOverviewItem[] => selectOverviewItems(
    useSessionStore.getState(),
  ),
  getTabs: (): SessionTabState[] => selectTabs(useSessionStore.getState()),

}));
