import { create } from "zustand";
import { getLogger } from "../lib/logger";
import { removePipelineCache } from "../hooks/useMessagePipeline";

const log = getLogger("sessionStore");
import type {
  SessionOverviewItem,
  SessionProgress,
  ResponsePreview,
  QueuedPrompt,
  Plan,
} from "../types";

// Re-exported types (previously from useSessionContext)

export interface SessionTabState {
  sessionId: string;
  agentId: string;
  title: string;
  agentIcon?: string;
  status?:
    | "idle"
    | "running"
    | "cancelling"
    | "completed"
    | "error"
    | "cancelled";
}

export type SessionState =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "error"
  | "cancelled";
export type TurnOutcome = "completed" | "error" | "cancelled";

export interface SessionInfoDTO {
  sessionId: string;
  agentId: string;
  title?: string;
  status: SessionState;
  lastTurnOutcome: TurnOutcome | null;
  isStreaming: boolean;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  createdAt: string;
  lastResponseAt: string | null;
  sessionColor?: string;
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

export type SessionTabStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "error"
  | "cancelled";
// Note: SessionTabStatus includes turn outcome values for backward compatibility
// with existing UI code. New code should use SessionState + TurnOutcome separately.

/** Session key = `${agentId}:${sessionId}` */
export function sessionKeyOf(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}



export function selectOverviewItems(
  state: SessionStoreState
): SessionOverviewItem[] {
  const { sessionInfoMap, tabOrder, tabTitles } = state;
  const orderedKeys =
    tabOrder.length > 0 ? tabOrder : Object.keys(sessionInfoMap);

  return orderedKeys
    .filter((key) => sessionInfoMap[key])
    .map((key) => {
      const info = sessionInfoMap[key]!;
      const title = tabTitles[key];
      return snapshotToOverviewItem(info, title);
    });
}

export function selectOverviewItemsMap(
  state: SessionStoreState
): Record<string, SessionOverviewItem> {
  const items = selectOverviewItems(state);
  const acc: Record<string, SessionOverviewItem> = {};
  for (const item of items) {
    acc[`${item.agentId}:${item.sessionId}`] = item;
  }
  return acc;
}

export function selectTabs(state: SessionStoreState): SessionTabState[] {
  const { tabOrder, tabTitles, tabIcons } = state;

  return tabOrder.map((key): SessionTabState => {
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
 * Compare two SessionInfoDTO for referential equality.
 */
function sessionInfoEquals(a: SessionInfoDTO, b: SessionInfoDTO): boolean {
  if (a === b) return true;
  return (
    a.status === b.status &&
    a.lastTurnOutcome === b.lastTurnOutcome &&
    a.isStreaming === b.isStreaming &&
    a.tokenUsage === b.tokenUsage &&
    a.contextWindowMax === b.contextWindowMax &&
    a.model === b.model &&
    a.title === b.title &&
    a.cwd === b.cwd &&
    a.createdAt === b.createdAt &&
    a.lastResponseAt === b.lastResponseAt
  );
}

/**
 * Derives SessionOverviewItem from SessionInfoDTO.
 * messageCount / toolCallCount / toolCallsCompleted
 * are obtained via messageStore selectors, so set to 0 here.
 */
export function snapshotToOverviewItem(
  info: SessionInfoDTO,
  titleHint?: string
): SessionOverviewItem {
  const status = info.status;
  const createdAt = info.createdAt;

  const elapsedMs =
    status === "running" && info.lastResponseAt
      ? Date.now() - new Date(info.lastResponseAt).getTime()
      : 0;

  const progress: SessionProgress = {
    elapsedMs,
    tokenUsage: {
      input: info.tokenUsage.inputTokens,
      output: info.tokenUsage.outputTokens,
      total: info.tokenUsage.totalTokens,
    },
    contextWindow:
      info.contextWindowMax != null
        ? {
            used: info.tokenUsage.totalTokens,
            max: info.contextWindowMax,
            percentage: Math.round(
              (info.tokenUsage.totalTokens / info.contextWindowMax) * 100
            ),
          }
        : undefined,
    messageCount: 0,
    toolCallCount: 0,
    toolCallsCompleted: 0,
  };

  const recentResponses: ResponsePreview[] = [];

  return {
    sessionId: info.sessionId,
    agentId: info.agentId,
    title: titleHint ?? info.title ?? info.sessionId,
    status,
    lastTurnOutcome: info.lastTurnOutcome,
    model: info.model,
    mode: info.mode,
    progress,
    recentResponses,
    cwd: info.cwd,
    createdAt,
    lastResponseAt: info.lastResponseAt,
  };
}

export interface SessionStoreState {
  sessionInfoMap: Record<string, SessionInfoDTO>;
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

  /** Pinned session keys (agentId:sessionId) */
  pinnedSessionKeys: string[];
  /** Current plan for the active session (null if no plan) */
  currentPlan: Plan | null;
  /** Plan history (previous plans that were approved/rejected) */
  planHistory: Plan[];

  commandCenterExpanded: boolean;
  commandCenterSelectedKey: string | null;
  /** Completion notification for background session turns */
  completionNotification: {
    agentId: string;
    sessionId: string;
    title: string;
    outcome: TurnOutcome;
  } | null;

  setSessionInfoMap: (map: Record<string, SessionInfoDTO>) => void;
  setSessionInfo: (
    agentId: string,
    sessionId: string,
    info: SessionInfoDTO
  ) => void;

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
  setSessionCommands: (
    agentId: string,
    sessionId: string,
    commands: SlashCommand[]
  ) => void;
  setStatusline: (statusline: SessionStoreState["statusline"]) => void;

  setPromptQueue: (sessionKey: string, queue: QueuedPrompt[]) => void;
  addQueuedPrompt: (sessionKey: string, entry: QueuedPrompt) => void;
  removeQueuedPrompt: (sessionKey: string, promptId: string) => void;
  reorderQueuedPrompts: (sessionKey: string, orderedIds: string[]) => void;
  clearQueue: (sessionKey: string) => void;
  updateQueuedPromptStatus: (
    sessionKey: string,
    promptId: string,
    status: QueuedPrompt["status"]
  ) => void;

  bulkSetTabs: (params: {
    tabs: SessionTabState[];
    workspaceRoot?: string;
    connectedAgents?: ConnectedAgentInfo[];
    workspaceFolders?: WorkspaceFolder[];
    agentInfoMap?: Record<string, AgentInfo>;
    sessionInfoMap?: Record<string, SessionInfoDTO>;
  }) => void;

  getOverviewItems: () => SessionOverviewItem[];
  getTabs: () => SessionTabState[];

  pinSession: (sessionKey: string) => void;
  unpinSession: (sessionKey: string) => void;
  togglePin: (sessionKey: string) => void;
  setFocusSession: (sessionKey: string | null) => void;
  setCurrentPlan: (plan: Plan | null) => void;
  updatePlanStep: (
    stepId: string,
    updates: Partial<Plan["steps"][number]>
  ) => void;
  approvePlan: () => void;
  rejectPlan: () => void;
  addPlanStep: (description: string, afterStepId?: string) => void;
  removePlanStep: (stepId: string) => void;
  cancelPlan: () => void;
  replan: (failedStepId: string, reason: string) => void;
  toggleCommandCenter: () => void;
  setCommandCenterExpanded: (expanded: boolean) => void;
  setCommandCenterSelectedKey: (key: string | null) => void;
  setCompletionNotification: (notification: {
    agentId: string;
    sessionId: string;
    title: string;
    outcome: TurnOutcome;
  }) => void;
  clearCompletionNotification: () => void;
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

  pinnedSessionKeys: [],
  currentPlan: null,
  planHistory: [],
  commandCenterExpanded: false,
  commandCenterSelectedKey: null,
  completionNotification: null,

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

  setTabOrder: (order) =>
    set((s) => (s.tabOrder === order ? s : { tabOrder: order })),

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
      return {
        ...state,
        tabOrder: nextOrder,
        tabTitles: nextTitles,
        activeSessionKey: key,
      };
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
      const nextActive =
        state.activeSessionKey === targetKey
          ? nextOrder.length > 0
            ? nextOrder[Math.min(idx, nextOrder.length - 1)]
            : null
          : state.activeSessionKey;
      removePipelineCache(targetKey);

      let nextPinned = state.pinnedSessionKeys;
      if (state.pinnedSessionKeys.includes(targetKey)) {
        nextPinned = state.pinnedSessionKeys.filter((k) => k !== targetKey);
      }

      return {
        ...state,
        tabOrder: nextOrder,
        sessionInfoMap: nextInfoMap,
        promptQueue: nextQueue,
        activeSessionKey: nextActive,
        pinnedSessionKeys: nextPinned,
      };
    }),

  setActiveSession: (sessionKey) =>
    set((s) =>
      s.activeSessionKey === sessionKey ? s : { activeSessionKey: sessionKey }
    ),

  setWorkspaceRoot: (root) =>
    set((s) => (s.workspaceRoot === root ? s : { workspaceRoot: root })),

  setAgentInfo: (agentId, info) =>
    set((state) => {
      if (state.agentInfoMap[agentId] === info) return state;
      return {
        ...state,
        agentInfoMap: { ...state.agentInfoMap, [agentId]: info },
      };
    }),

  setConnectedAgents: (agents) =>
    set((s) =>
      s.connectedAgents === agents ? s : { connectedAgents: agents }
    ),
  setWorkspaceFolders: (folders) =>
    set((s) =>
      s.workspaceFolders === folders ? s : { workspaceFolders: folders }
    ),

  setSessionCommands: (agentId, sessionId, commands) =>
    set((state) => {
      const key = sessionKeyOf(agentId, sessionId);
      if (state.sessionCommands[key] === commands) return state;
      return {
        ...state,
        sessionCommands: { ...state.sessionCommands, [key]: commands },
      };
    }),

  setStatusline: (statusline) =>
    set((s) => (s.statusline === statusline ? s : { statusline })),

  setPromptQueue: (sessionKey, queue) =>
    set((state) => {
      if (state.promptQueue[sessionKey] === queue) return state;
      return {
        ...state,
        promptQueue: { ...state.promptQueue, [sessionKey]: queue },
      };
    }),

  addQueuedPrompt: (sessionKey, entry) =>
    set((state) => {
      const existing = state.promptQueue[sessionKey] ?? [];
      return {
        ...state,
        promptQueue: {
          ...state.promptQueue,
          [sessionKey]: [...existing, entry],
        },
      };
    }),

  removeQueuedPrompt: (sessionKey, promptId) =>
    set((state) => {
      const q = state.promptQueue[sessionKey];
      if (!q) return state;
      const filtered = q.filter((e) => e.id !== promptId);
      if (filtered.length === q.length) return state;
      return {
        ...state,
        promptQueue: { ...state.promptQueue, [sessionKey]: filtered },
      };
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
        promptQueue: {
          ...state.promptQueue,
          [sessionKey]: [...reordered, ...sending],
        },
      };
    }),

  clearQueue: (sessionKey) =>
    set((state) => {
      if (!state.promptQueue[sessionKey]) return state;
      const next = { ...state.promptQueue };
      delete next[sessionKey];
      return { ...state, promptQueue: next };
    }),

  updateQueuedPromptStatus: (sessionKey, promptId, status) =>
    set((state) => {
      const q = state.promptQueue[sessionKey];
      if (!q) return state;
      const idx = q.findIndex((e) => e.id === promptId);
      if (idx < 0) return state;
      const updated = q.map((e) =>
        e.id === promptId ? { ...e, status } : e
      );
      return {
        ...state,
        promptQueue: { ...state.promptQueue, [sessionKey]: updated },
      };
    }),

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

      // Preserve sessions that exist in current tabOrder but are absent from
      // the incoming tabs list (e.g. a just-restored session whose snapshot
      // arrived before the extension host's tab list was updated).  Without
      // this, bulkSetTabs performs a full replacement and drops the key,
      // leaving the UI unable to display the restored session's messages.
      const incomingSet = new Set(order);
      const preserved = state.tabOrder.filter((k) => !incomingSet.has(k));
      const mergedOrder = preserved.length > 0 ? [...order, ...preserved] : order;

      if (
        state.tabOrder.length !== mergedOrder.length ||
        state.tabOrder.some((k, i) => k !== mergedOrder[i])
      ) {
        nextState.tabOrder = mergedOrder;
        changed = true;
      }
      if (Object.keys(titles).length > 0) {
        const nextTitles = { ...state.tabTitles };
        for (const [k, v] of Object.entries(titles)) {
          if (nextTitles[k] !== v) {
            nextTitles[k] = v;
            changed = true;
          }
        }
        nextState.tabTitles = nextTitles;
      }
      if (
        params.workspaceRoot !== undefined &&
        state.workspaceRoot !== params.workspaceRoot
      ) {
        nextState.workspaceRoot = params.workspaceRoot;
        changed = true;
      }
      if (
        params.connectedAgents &&
        state.connectedAgents !== params.connectedAgents
      ) {
        nextState.connectedAgents = params.connectedAgents;
        changed = true;
      }
      if (
        params.workspaceFolders &&
        state.workspaceFolders !== params.workspaceFolders
      ) {
        nextState.workspaceFolders = params.workspaceFolders;
        changed = true;
      }
      if (params.agentInfoMap) {
        const nextAgentInfo = { ...state.agentInfoMap };
        for (const [k, v] of Object.entries(params.agentInfoMap)) {
          if (nextAgentInfo[k] !== v) {
            nextAgentInfo[k] = v;
            changed = true;
          }
        }
        nextState.agentInfoMap = nextAgentInfo;
      }
      if (params.sessionInfoMap) {
        const nextInfoMap = { ...state.sessionInfoMap };
        for (const [k, v] of Object.entries(params.sessionInfoMap)) {
          const prev = state.sessionInfoMap[k];
          if (!prev || !sessionInfoEquals(prev, v)) {
            nextInfoMap[k] = v;
            changed = true;
          }
        }
        nextState.sessionInfoMap = nextInfoMap;
      }
      return changed ? nextState : state;
    });
  },

  getOverviewItems: (): SessionOverviewItem[] => selectOverviewItems(get()),
  getTabs: (): SessionTabState[] => selectTabs(get()),

  pinSession: (sessionKey) =>
    set((state) => {
      if (state.pinnedSessionKeys.includes(sessionKey)) return state;
      const next = [...state.pinnedSessionKeys, sessionKey];
      return { ...state, pinnedSessionKeys: next };
    }),

  unpinSession: (sessionKey) =>
    set((state) => {
      if (!state.pinnedSessionKeys.includes(sessionKey)) return state;
      const next = state.pinnedSessionKeys.filter((k) => k !== sessionKey);
      return { ...state, pinnedSessionKeys: next };
    }),

  togglePin: (sessionKey) =>
    set((state) => {
      const isPinned = state.pinnedSessionKeys.includes(sessionKey);
      const next = isPinned
        ? state.pinnedSessionKeys.filter((k) => k !== sessionKey)
        : [...state.pinnedSessionKeys, sessionKey];
      return { ...state, pinnedSessionKeys: next };
    }),

  setFocusSession: (sessionKey) =>
    set((s) =>
      s.activeSessionKey === sessionKey ? s : { activeSessionKey: sessionKey }
    ),

  setCurrentPlan: (plan) => set((s) => ({ ...s, currentPlan: plan })),

  updatePlanStep: (stepId, updates) =>
    set((s) => {
      if (!s.currentPlan) return s;
      const steps = s.currentPlan.steps.map((step) =>
        step.id === stepId ? { ...step, ...updates } : step
      );
      return { ...s, currentPlan: { ...s.currentPlan, steps } };
    }),

  approvePlan: () =>
    set((s) => {
      if (!s.currentPlan) return s;
      return {
        ...s,
        currentPlan: { ...s.currentPlan, status: "approved" },
        planHistory: [
          ...s.planHistory,
          { ...s.currentPlan, status: "approved" },
        ],
      };
    }),

  rejectPlan: () =>
    set((s) => {
      if (!s.currentPlan) return s;
      return {
        ...s,
        currentPlan: null,
        planHistory: [
          ...s.planHistory,
          { ...s.currentPlan, status: "rejected" },
        ],
      };
    }),

  addPlanStep: (description: string, afterStepId?: string) =>
    set((s) => {
      if (!s.currentPlan) return s;
      const steps = [...s.currentPlan.steps];
      const newStep: import("../types").PlanStep = {
        id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        index: steps.length,
        description,
        status: "pending",
      };
      if (afterStepId) {
        const idx = steps.findIndex((st) => st.id === afterStepId);
        if (idx >= 0) {
          steps.splice(idx + 1, 0, newStep);
        } else {
          steps.push(newStep);
        }
      } else {
        steps.push(newStep);
      }
      const reindexed = steps.map((st, i) => ({ ...st, index: i }));
      return { ...s, currentPlan: { ...s.currentPlan, steps: reindexed } };
    }),

  removePlanStep: (stepId: string) =>
    set((s) => {
      if (!s.currentPlan) return s;
      const steps = s.currentPlan.steps
        .filter((st) => st.id !== stepId)
        .map((st, i) => ({ ...st, index: i }));
      return { ...s, currentPlan: { ...s.currentPlan, steps } };
    }),

  cancelPlan: () =>
    set((s) => {
      if (!s.currentPlan) return s;
      return {
        ...s,
        currentPlan: { ...s.currentPlan, status: "cancelled" },
        planHistory: [
          ...s.planHistory,
          { ...s.currentPlan, status: "cancelled" },
        ],
      };
    }),

  replan: (failedStepId: string, reason: string) =>
    set((s) => {
      if (!s.currentPlan) return s;
      const steps = s.currentPlan.steps.map((st) =>
        st.id === failedStepId
          ? { ...st, status: "pending" as const, error: undefined }
          : st
      );
      return {
        ...s,
        currentPlan: { ...s.currentPlan, status: "pending", steps },
      };
    }),

  toggleCommandCenter: () =>
    set((s) => ({ commandCenterExpanded: !s.commandCenterExpanded })),

  setCommandCenterExpanded: (expanded) =>
    set((s) =>
      s.commandCenterExpanded === expanded
        ? s
        : { commandCenterExpanded: expanded }
    ),

  setCommandCenterSelectedKey: (key) =>
    set((s) =>
      s.commandCenterSelectedKey === key ? s : { commandCenterSelectedKey: key }
    ),

  setCompletionNotification: (notification) =>
    set(() => ({ completionNotification: notification })),

  clearCompletionNotification: () =>
    set(() => ({ completionNotification: null })),
}));
