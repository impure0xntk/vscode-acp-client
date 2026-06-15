import { create } from "zustand";
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

export type SessionState = "idle" | "running" | "completed" | "error" | "cancelled";
export type TurnOutcome = "completed" | "error" | "cancelled";

export interface SessionInfoSnapshot {
  sessionId: string;
  agentId: string;
  status: SessionState;
  lastTurnOutcome: TurnOutcome | null;
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
// Note: SessionTabStatus includes turn outcome values for backward compatibility
// with existing UI code. New code should use SessionState + TurnOutcome separately.

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Session key = `${agentId}:${sessionId}` */
export function sessionKeyOf(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

// ── Selectors (reactive, for use inside components) ────────────────────────

export function selectOverviewItems(state: SessionStoreState): SessionOverviewItem[] {
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

export function selectOverviewItemsMap(state: SessionStoreState): Record<string, SessionOverviewItem> {
  const items = selectOverviewItems(state);
  const acc: Record<string, SessionOverviewItem> = {};
  for (const item of items) {
    acc[`${item.agentId}:${item.sessionId}`] = item;
  }
  return acc;
}

export function selectTabs(state: SessionStoreState): SessionTabState[] {
  const { tabOrder, tabTitles, tabIcons } = state;

  return tabOrder
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

/**
 * Compare two SessionInfoSnapshot for referential equality.
 *
 * The store must only create a new object when data actually changes.
 * If every write produces a new object (even with the same data),
 * this function would short-circuit — so the callers are responsible
 * for avoiding unnecessary writes.
 *
 * We use strict reference-equality on tokenUsage as a fast-path: if the
 * store reuses the same object when token counts haven't changed, this
 * avoids deep comparison on every field.
 */
function sessionInfoEquals(a: SessionInfoSnapshot, b: SessionInfoSnapshot): boolean {
  if (a === b) return true;
  return (
    a.status === b.status &&
    a.lastTurnOutcome === b.lastTurnOutcome &&
    a.status === b.status &&
    a.isStreaming === b.isStreaming &&
    a.tokenUsage === b.tokenUsage &&
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
    lastTurnOutcome: info.lastTurnOutcome,
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

export interface SessionStoreState {
  sessionInfoMap: Record<string, SessionInfoSnapshot>;
  tabOrder: string[];
  activeSessionKey: string | null;
  tabTitles: Record<string, string>;
  tabIcons: Record<string, string>;
  workspaceRoot?: string;
  connectedAgents: ConnectedAgentInfo[];
  agentInfoMap: Record<string, AgentInfo>;
  workspaceFolders: WorkspaceFolder[];
  sessionCommands: Record<string, SlashCommand[]>;
  statusline: {
    hostname?: string;
    repoName?: string;
    branch?: string;
    tag?: string;
  };
  promptQueue: Record<string, QueuedPrompt[]>;

  // ── Actions ───────────────────────────────────────────────────────────
  setSessionInfoMap: (map: Record<string, SessionInfoSnapshot>) => void;
  setSessionInfo: (agentId: string, sessionId: string, info: SessionInfoSnapshot) => void;
  updateMessageCount: (agentId: string, sessionId: string, count: number) => void;

  setTabOrder: (order: string[]) => void;
  setTabTitle: (sessionKey: string, title: string) => void;
  setTabIcon: (sessionKey: string, icon: string) => void;
  addTab: (agentId: string, sessionId: string, title?: string) => void;
  removeTab: (sessionKey: string) => void;
  setActiveSession: (sessionKey: string | null) => void;

  setWorkspaceRoot: (root?: string) => void;
  setAgentInfo: (agentId: string, info: AgentInfo) => void;
  setConnectedAgents: (agents: ConnectedAgentInfo[]) => void;
  setWorkspaceFolders: (folders: WorkspaceFolder[]) => void;
  setSessionCommands: (agentId: string, sessionId: string, commands: SlashCommand[]) => void;
  setStatusline: (statusline: SessionStoreState["statusline"]) => void;

  setPromptQueue: (sessionKey: string, queue: QueuedPrompt[]) => void;
  addQueuedPrompt: (sessionKey: string, entry: QueuedPrompt) => void;
  removeQueuedPrompt: (sessionKey: string, promptId: string) => void;
  reorderQueuedPrompts: (sessionKey: string, orderedIds: string[]) => void;

  bulkSetTabs: (params: {
    tabs: SessionTabState[];
    workspaceRoot?: string;
    connectedAgents?: ConnectedAgentInfo[];
    workspaceFolders?: WorkspaceFolder[];
    agentInfoMap?: Record<string, AgentInfo>;
    sessionInfoMap?: Record<string, SessionInfoSnapshot>;
  }) => void;

  getOverviewItems: () => SessionOverviewItem[];
  getTabs: () => SessionTabState[];
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
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
    set((state) => {
      let changed = false;
      const nextInfoMap = { ...state.sessionInfoMap };
      for (const [k, v] of Object.entries(map)) {
        const prev = state.sessionInfoMap[k];
        if (!prev || !sessionInfoEquals(prev, v)) {
          nextInfoMap[k] = v;
          changed = true;
        }
      }
      if (!changed) return state;
      const validKeys = new Set(Object.keys(nextInfoMap));
      const newOrder = state.tabOrder.filter((k) => validKeys.has(k));
      for (const k of Object.keys(nextInfoMap)) {
        if (!newOrder.includes(k)) newOrder.push(k);
      }
      return { ...state, sessionInfoMap: nextInfoMap, tabOrder: newOrder };
    });
  },

  setSessionInfo: (agentId, sessionId, info) =>
    set((state) => {
      const key = sessionKeyOf(agentId, sessionId);
      const prev = state.sessionInfoMap[key];
      if (prev && sessionInfoEquals(prev, info)) return state;
      log.debug("setSessionInfo", { agentId, sessionId, status: info.status });
      return {
        ...state,
        sessionInfoMap: { ...state.sessionInfoMap, [key]: info },
      };
    }),

  updateMessageCount: (agentId, sessionId, count) =>
    set((state) => {
      const key = sessionKeyOf(agentId, sessionId);
      const existing = state.sessionInfoMap[key];
      if (!existing || existing.messageCount === count) return state;
      return {
        ...state,
        sessionInfoMap: {
          ...state.sessionInfoMap,
          [key]: { ...existing, messageCount: count },
        },
      };
    }),

  // ── Tabs ────────────────────────────────────────────────────────────────

  setTabOrder: (order) => set((s) => s.tabOrder === order ? s : { tabOrder: order }),

  setTabTitle: (key, title) =>
    set((state) => {
      if (state.tabTitles[key] === title) return state;
      return { ...state, tabTitles: { ...state.tabTitles, [key]: title } };
    }),

  setTabIcon: (key, icon) =>
    set((state) => {
      if (state.tabIcons[key] === icon) return state;
      return { ...state, tabIcons: { ...state.tabIcons, [key]: icon } };
    }),

  addTab: (agentId, sessionId, title) => {
    const key = sessionKeyOf(agentId, sessionId);
    set((state) => {
      const nextOrder = state.tabOrder.includes(key)
        ? state.tabOrder
        : [...state.tabOrder, key];
      const nextTitles = title
        ? { ...state.tabTitles, [key]: title }
        : state.tabTitles;
      return { ...state, tabOrder: nextOrder, tabTitles: nextTitles, activeSessionKey: key };
    });
  },

  removeTab: (targetKey) =>
    set((state) => {
      if (!state.tabOrder.includes(targetKey)) return state;
      const idx = state.tabOrder.indexOf(targetKey);
      const nextOrder = state.tabOrder.filter((k) => k !== targetKey);
      const nextInfoMap = { ...state.sessionInfoMap };
      delete nextInfoMap[targetKey];
      const nextQueue = { ...state.promptQueue };
      delete nextQueue[targetKey];
      const nextActive = state.activeSessionKey === targetKey
        ? (nextOrder.length > 0 ? nextOrder[Math.min(idx, nextOrder.length - 1)] : null)
        : state.activeSessionKey;
      return {
        ...state,
        tabOrder: nextOrder,
        sessionInfoMap: nextInfoMap,
        promptQueue: nextQueue,
        activeSessionKey: nextActive,
      };
    }),

  setActiveSession: (sessionKey) => set((s) => s.activeSessionKey === sessionKey ? s : { activeSessionKey: sessionKey }),

  // ── Agent / workspace ───────────────────────────────────────────────────

  setWorkspaceRoot: (root) => set((s) => s.workspaceRoot === root ? s : { workspaceRoot: root }),

  setAgentInfo: (agentId, info) =>
    set((state) => {
      if (state.agentInfoMap[agentId] === info) return state;
      return { ...state, agentInfoMap: { ...state.agentInfoMap, [agentId]: info } };
    }),

  setConnectedAgents: (agents) => set((s) => s.connectedAgents === agents ? s : { connectedAgents: agents }),
  setWorkspaceFolders: (folders) => set((s) => s.workspaceFolders === folders ? s : { workspaceFolders: folders }),

  setSessionCommands: (agentId, sessionId, commands) =>
    set((state) => {
      const key = sessionKeyOf(agentId, sessionId);
      if (state.sessionCommands[key] === commands) return state;
      return { ...state, sessionCommands: { ...state.sessionCommands, [key]: commands } };
    }),

  setStatusline: (statusline) => set((s) => s.statusline === statusline ? s : { statusline }),

  // ── Prompt Queue ──────────────────────────────────────────────────────────

  setPromptQueue: (sessionKey, queue) =>
    set((state) => {
      if (state.promptQueue[sessionKey] === queue) return state;
      return { ...state, promptQueue: { ...state.promptQueue, [sessionKey]: queue } };
    }),

  addQueuedPrompt: (sessionKey, entry) =>
    set((state) => {
      const existing = state.promptQueue[sessionKey] ?? [];
      return {
        ...state,
        promptQueue: { ...state.promptQueue, [sessionKey]: [...existing, entry] },
      };
    }),

  removeQueuedPrompt: (sessionKey, promptId) =>
    set((state) => {
      const q = state.promptQueue[sessionKey];
      if (!q) return state;
      const filtered = q.filter((e) => e.id !== promptId);
      if (filtered.length === q.length) return state;
      return { ...state, promptQueue: { ...state.promptQueue, [sessionKey]: filtered } };
    }),

  reorderQueuedPrompts: (sessionKey, orderedIds) =>
    set((state) => {
      const q = state.promptQueue[sessionKey] ?? [];
      const pending = q.filter((e) => e.status === "pending");
      const sending = q.filter((e) => e.status !== "pending");
      const reordered = orderedIds
        .map((id) => pending.find((e) => e.id === id))
        .filter((e): e is QueuedPrompt => e !== undefined);
      for (const e of pending) {
        if (!orderedIds.includes(e.id)) reordered.push(e);
      }
      return {
        ...state,
        promptQueue: { ...state.promptQueue, [sessionKey]: [...reordered, ...sending] },
      };
    }),

  // ── Bulk operations ─────────────────────────────────────────────────────

  bulkSetTabs: (params) => {
    set((state) => {
      const order: string[] = [];
      const titles: Record<string, string> = {};
      for (const t of params.tabs) {
        const key = sessionKeyOf(t.agentId, t.sessionId);
        order.push(key);
        if (t.title) titles[key] = t.title;
      }
      let changed = false;
      const nextState = { ...state };

      if (state.tabOrder.length !== order.length || state.tabOrder.some((k, i) => k !== order[i])) {
        nextState.tabOrder = order;
        changed = true;
      }
      if (Object.keys(titles).length > 0) {
        const nextTitles = { ...state.tabTitles };
        for (const [k, v] of Object.entries(titles)) {
          if (nextTitles[k] !== v) { nextTitles[k] = v; changed = true; }
        }
        nextState.tabTitles = nextTitles;
      }
      if (params.workspaceRoot !== undefined && state.workspaceRoot !== params.workspaceRoot) {
        nextState.workspaceRoot = params.workspaceRoot; changed = true;
      }
      if (params.connectedAgents && state.connectedAgents !== params.connectedAgents) {
        nextState.connectedAgents = params.connectedAgents; changed = true;
      }
      if (params.workspaceFolders && state.workspaceFolders !== params.workspaceFolders) {
        nextState.workspaceFolders = params.workspaceFolders; changed = true;
      }
      if (params.agentInfoMap) {
        const nextAgentInfo = { ...state.agentInfoMap };
        for (const [k, v] of Object.entries(params.agentInfoMap)) {
          if (nextAgentInfo[k] !== v) { nextAgentInfo[k] = v; changed = true; }
        }
        nextState.agentInfoMap = nextAgentInfo;
      }
      if (params.sessionInfoMap) {
        const nextInfoMap = { ...state.sessionInfoMap };
        for (const [k, v] of Object.entries(params.sessionInfoMap)) {
          const prev = state.sessionInfoMap[k];
          if (!prev || !sessionInfoEquals(prev, v)) {
            nextInfoMap[k] = v; changed = true;
          }
        }
        nextState.sessionInfoMap = nextInfoMap;
      }
      return changed ? nextState : state;
    });
  },

  // ── Derived ──────────────────────────────────────────────────────────────

  getOverviewItems: (): SessionOverviewItem[] => selectOverviewItems(get()),
  getTabs: (): SessionTabState[] => selectTabs(get()),
}));
