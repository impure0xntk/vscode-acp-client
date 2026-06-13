import React, {
  createContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type {
  ChatMessage,
  ContextAttachment,
  FileCandidate,
  SuggestionItem,
  SessionOverviewState,
  SessionOverviewItem,
  SessionOverviewFilter,
} from "../types";
import { getVsCodeApi } from "../lib/vscodeApi";

// ============================================================================
// Tab types — UI-only state (no duplicated model fields)
// ============================================================================

export type SessionTabStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

/**
 * SessionTabState holds ONLY UI-concern state.
 * All model-derived data (status, tokenUsage, model, mode, etc.) is read
 * from SessionInfoSnapshot via sessionInfoMap.
 */
export interface SessionTabState {
  sessionId: string;
  agentId: string;
  title: string;
  /** UI-only: unread message count for badge display */
  unreadCount: number;
  /** UI-only: whether session has unseen activity */
  isDirty: boolean;
}

export type SessionTab = SessionTabState;

// ============================================================================
// Session key helper
// ============================================================================

type SessionKey = string; // `${agentId}:${sessionId}`

function sessionKey(agentId: string, sessionId: string): SessionKey {
  return `${agentId}:${sessionId}`;
}

// ============================================================================
// Snapshot of SessionInfo sent from extension host — read-only in webview
// ============================================================================

export interface SessionInfoSnapshot {
  sessionId: string;
  agentId: string;
  status: string;
  isTurnActive: boolean;
  isStreaming: boolean;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  contextWindowMax?: number;
  cwd?: string;
  model?: string;
  mode?: string;
  /** ISO date string */
  createdAt: string;
  /** ISO date string */
  updatedAt: string;
  /** Message count from model */
  messageCount: number;
}

// ============================================================================
// Shared types
// ============================================================================

export interface ConnectedAgentInfo {
  agentId: string;
  name: string;
  state: string;
  color?: string;
}

export interface AgentInfo {
  name: string;
  title?: string;
  version?: string;
  protocolVersion: number;
  capabilities?: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
    sessionCapabilities?: {
      fork?: boolean;
      list?: boolean;
      resume?: boolean;
      delete?: boolean;
      close?: boolean;
      additionalDirectories?: boolean;
    };
  };
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface SlashCommand {
  name: string;
  description?: string;
  input?: { type: "text" | "boolean"; description?: string } | null;
}

// ============================================================================
// SessionContext — public interface
// ============================================================================

export interface SessionContext {
  // Tab / session management — UI-only state
  tabs: SessionTabState[];
  activeSessionId: string | null;
  activeAgentId: string | null;

  // Connected agents info (for new session picker)
  connectedAgents: ConnectedAgentInfo[];

  // Agent info from InitializeResponse (keyed by agentId)
  agentInfoMap: Record<string, AgentInfo>;

  // Workspace folders (for new session picker)
  workspaceFolders: WorkspaceFolder[];

  // Active session key
  activeSessionKey: string | null;

  /** SessionInfo snapshots from extension host — source of truth for all session-derived state */
  sessionInfoMap: Record<string, SessionInfoSnapshot>;

  workspaceRoot?: string;

  // Available slash commands for the active session
  availableCommands: SlashCommand[];

  // Background session completion notifications (stacked)
  completedNotifications: Array<{
    agentId: string;
    sessionId: string;
    title: string;
  }>;
  dismissCompletedNotification: () => void;

  // Statusline info (hostname, repo, branch, tag)
  statusline?: {
    hostname?: string;
    repoName?: string;
    branch?: string;
    tag?: string;
  };

  // Actions
  sendMessage: (
    text: string,
    attachments?: ContextAttachment[],
    agentId?: string,
    sessionId?: string
  ) => void;
  cancelTurn: (agentId?: string, sessionId?: string) => void;
  switchTab: (sessionId: string, agentId: string) => void;
  newSession: (agentId: string) => void;
  newSessionWithPicker: () => void;
  closeSession: (sessionId: string) => void;
  forkSession: (sessionId: string) => void;

  // File resolution helpers
  fetchFiles: (query: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;

  // Symbol search
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;

  // Messages for the active session (derived from per-session store)
  messages: ChatMessage[];
  isStreaming: boolean;

  // Session Overview Panel state
  sessionOverviewVisible: boolean;
  sessionOverviewState: SessionOverviewState;
  sessionOverviewPosition: "right" | "left";
  sessionOverviewWidth: number;
  toggleSessionOverview: () => void;
  setSessionOverviewFilter: (filter: SessionOverviewFilter) => void;
  toggleSessionOverviewSelection: (sessionId: string) => void;
  setSessionOverviewSelection: (sessionIds: string[]) => void;

  // Internal dispatch (for advanced use)
  dispatch: React.Dispatch<SessionAction>;
}

// ============================================================================
// Internal full state shape (not exported)
// ============================================================================

interface FullState {
  tabs: SessionTabState[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  workspaceRoot?: string;
  connectedAgents: ConnectedAgentInfo[];
  agentInfoMap: Record<string, AgentInfo>;
  workspaceFolders: WorkspaceFolder[];
  /** sessionKey → SlashCommand[] */
  sessionCommands: Record<string, SlashCommand[]>;
  /** Statusline info */
  statusline: {
    hostname?: string;
    repoName?: string;
    branch?: string;
    tag?: string;
  };
  /** SessionInfo snapshots from extension host — source of truth for display derivation */
  sessionInfoMap: Record<string, SessionInfoSnapshot>;
  /** Per-session message store: sessionKey → ChatMessage[] */
  sessionMessages: Record<string, ChatMessage[]>;
  /** Per-session streaming state: sessionKey → boolean */
  sessionStreaming: Record<string, boolean>;
  /** Session Overview Panel visibility */
  sessionOverviewVisible: boolean;
  /** Session Overview Panel width (px, 200-600) */
  sessionOverviewWidth: number;
  /** Session Overview Panel position (right or left) */
  sessionOverviewPosition: "right" | "left";
  /** Session Overview Panel state */
  sessionOverviewState: SessionOverviewState;
}

const initialState: FullState = {
  tabs: [],
  activeSessionId: null,
  activeAgentId: null,
  connectedAgents: [],
  agentInfoMap: {},
  workspaceFolders: [],
  sessionCommands: {},
  statusline: { hostname: "", repoName: "", branch: "" },
  sessionInfoMap: {},
  sessionMessages: {},
  sessionStreaming: {},
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
};

// ============================================================================
// Active session key derivation
// ============================================================================

function computeActiveSessionKey(s: {
  activeSessionId: string | null;
  activeAgentId: string | null;
}): SessionKey | null {
  if (s.activeSessionId && s.activeAgentId) {
    return sessionKey(s.activeAgentId, s.activeSessionId);
  }
  return null;
}

// ============================================================================
// Action types — tab/session management only
// ============================================================================

type SessionAction =
  // --- Tab management ---
  | { type: "SET_TABS"; tabs: SessionTabState[] }
  | { type: "ADD_TAB"; tab: SessionTabState }
  | { type: "REMOVE_TAB"; sessionId: string }
  | {
      type: "UPDATE_TAB";
      sessionId: string;
      agentId?: string;
      updates: Partial<SessionTabState>;
    }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string; agentId: string }
  | { type: "REORDER_TABS"; tabs: SessionTabState[] }
  | { type: "INCREMENT_UNREAD"; sessionId: string; agentId: string }

  // --- Global actions ---
  | { type: "SET_WORKSPACE_ROOT"; root?: string }

  // --- Agent / workspace info ---
  | { type: "SET_AGENT_INFO"; agentId: string; info: AgentInfo }
  | { type: "SET_CONNECTED_AGENTS"; agents: ConnectedAgentInfo[] }
  | { type: "SET_WORKSPACE_FOLDERS"; folders: WorkspaceFolder[] }

  // --- Slash commands ---
  | {
      type: "SET_SESSION_COMMANDS";
      agentId: string;
      sessionId: string;
      commands: SlashCommand[];
    }

  // --- Statusline ---
  | {
      type: "SET_STATUSLINE";
      statusline: {
        hostname?: string;
        repoName?: string;
        branch?: string;
        tag?: string;
      };
    }

  // --- SessionInfo ---
  | { type: "SET_SESSION_INFO_MAP"; map: Record<string, SessionInfoSnapshot> }

  // --- Session Overview ---
  | { type: "SET_SESSION_OVERVIEW_VISIBLE"; visible: boolean }
  | { type: "SET_SESSION_OVERVIEW_STATE"; state: SessionOverviewState }
  | { type: "SET_SESSION_OVERVIEW_POSITION"; position: "right" | "left" }
  | { type: "SET_SESSION_OVERVIEW_FILTER"; filter: SessionOverviewFilter }
  | { type: "SET_SESSION_OVERVIEW_EXPANDED"; sessions: string[] }
  | { type: "SET_SESSION_OVERVIEW_WIDTH"; width: number }
  | { type: "SET_SESSION_OVERVIEW_SELECTED"; sessionIds: string[] }
  | { type: "TOGGLE_SESSION_OVERVIEW_SELECTED"; sessionId: string }
  | { type: "SET_SESSION_OVERVIEW_SELECTION_MODE"; enabled: boolean }
  | { type: "TOGGLE_SESSION_OVERVIEW_SELECTION"; sessionId: string }

  // --- Per-session updates (session/info = metadata only; session/switch = full snapshot) ---
  | {
      type: "SET_SESSION_INFO";
      agentId: string;
      sessionId: string;
      info: SessionInfoSnapshot;
    }
  | {
      type: "SESSION_MESSAGE";
      agentId: string;
      sessionId: string;
      message: ChatMessage;
    }
  | {
      type: "SESSION_STREAM";
      agentId: string;
      sessionId: string;
      chunk: string;
    }
  | { type: "SESSION_STREAM_END"; agentId: string; sessionId: string }
  /** Full snapshot from extension host on session switch — replaces messages for that session */
  | {
      type: "SESSION_SWITCH";
      agentId: string;
      sessionId: string;
      messages: ChatMessage[];
    }
  | { type: "SESSION_TURN_ACTIVE"; agentId: string; sessionId: string; active: boolean };

// ============================================================================
// Reducer — tab/session management only, no message state
// ============================================================================

function reducer(state: FullState, action: SessionAction): FullState {
  switch (action.type) {
    case "SET_TABS": {
      if (action.tabs.length === 1 && !state.activeSessionId) {
        return {
          ...state,
          tabs: action.tabs,
          activeSessionId: action.tabs[0].sessionId,
          activeAgentId: action.tabs[0].agentId,
          sessionOverviewState: {
            ...state.sessionOverviewState,
            activeSessionId: action.tabs[0].sessionId,
            activeAgentId: action.tabs[0].agentId,
          },
        };
      }
      return { ...state, tabs: action.tabs };
    }

    case "ADD_TAB": {
      const newKey = sessionKey(action.tab.agentId, action.tab.sessionId);
      // Clear messages for the new session slot to prevent stale messages
      // from being displayed while the full snapshot (session/switch) arrives.
      const newSessionMessages = { ...state.sessionMessages };
      newSessionMessages[newKey] = [];
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        activeSessionId: action.tab.sessionId,
        activeAgentId: action.tab.agentId,
        sessionMessages: newSessionMessages,
      };
    }

    case "REMOVE_TAB": {
      const targetAgentId =
        state.activeSessionId === action.sessionId
          ? state.activeAgentId
          : undefined;
      const removedTab = targetAgentId
        ? state.tabs.find(
            (t) =>
              t.sessionId === action.sessionId && t.agentId === targetAgentId
          )
        : state.tabs.find((t) => t.sessionId === action.sessionId);

      const newTabs = removedTab
        ? state.tabs.filter(
            (t) =>
              !(
                t.sessionId === action.sessionId &&
                t.agentId === removedTab.agentId
              )
          )
        : state.tabs.filter((t) => t.sessionId !== action.sessionId);

      let newActiveSessionId = state.activeSessionId;
      let newActiveAgentId = state.activeAgentId;
      if (
        state.activeSessionId === action.sessionId &&
        state.activeAgentId === (removedTab?.agentId ?? targetAgentId)
      ) {
        if (newTabs.length > 0) {
          newActiveSessionId = newTabs[newTabs.length - 1].sessionId;
          newActiveAgentId = newTabs[newTabs.length - 1].agentId;
        } else {
          newActiveSessionId = null;
          newActiveAgentId = null;
        }
      }
      return {
        ...state,
        tabs: newTabs,
        activeSessionId: newActiveSessionId,
        activeAgentId: newActiveAgentId,
      };
    }

    case "UPDATE_TAB": {
      const tabs = state.tabs.map((t) => {
        if (t.sessionId !== action.sessionId) return t;
        return { ...t, ...action.updates };
      });
      return { ...state, tabs };
    }

    case "SET_ACTIVE_SESSION": {
      const newKey = sessionKey(action.agentId, action.sessionId);
      // Clear messages for the new session to prevent stale messages
      // from a previous session being displayed during the switch.
      const newSessionMessages = { ...state.sessionMessages };
      newSessionMessages[newKey] = [];
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeAgentId: action.agentId,
        sessionMessages: newSessionMessages,
        sessionOverviewState: {
          ...state.sessionOverviewState,
          activeSessionId: action.sessionId,
          activeAgentId: action.agentId,
        },
      };
    }

    case "REORDER_TABS":
      return { ...state, tabs: action.tabs };

    case "INCREMENT_UNREAD": {
      const tabs = state.tabs.map((t) =>
        t.sessionId === action.sessionId && t.agentId === action.agentId
          ? { ...t, unreadCount: t.unreadCount + 1 }
          : t
      );
      return { ...state, tabs };
    }

    case "SET_WORKSPACE_ROOT":
      return { ...state, workspaceRoot: action.root };

    case "SET_AGENT_INFO":
      return {
        ...state,
        agentInfoMap: { ...state.agentInfoMap, [action.agentId]: action.info },
      };

    case "SET_STATUSLINE":
      return { ...state, statusline: action.statusline };

    case "SET_CONNECTED_AGENTS":
      return { ...state, connectedAgents: action.agents };

    case "SET_WORKSPACE_FOLDERS":
      return { ...state, workspaceFolders: action.folders };

    case "SET_SESSION_COMMANDS": {
      const key = sessionKey(action.agentId, action.sessionId);
      return {
        ...state,
        sessionCommands: { ...state.sessionCommands, [key]: action.commands },
      };
    }

    case "SET_SESSION_INFO_MAP":
      return { ...state, sessionInfoMap: action.map };

    case "SET_SESSION_OVERVIEW_VISIBLE":
      return { ...state, sessionOverviewVisible: action.visible };

    case "SET_SESSION_OVERVIEW_POSITION":
      return { ...state, sessionOverviewPosition: action.position };

    case "SET_SESSION_OVERVIEW_STATE":
      return {
        ...state,
        sessionOverviewState: {
          // Preserve existing filter/selection when payload omits them
          filter: state.sessionOverviewState.filter,
          selectionMode: state.sessionOverviewState.selectionMode,
          selectedSessionIds: state.sessionOverviewState.selectedSessionIds,
          ...action.state,
          // Sync active session from tab state if not provided in the payload
          activeSessionId: action.state.activeSessionId ?? state.activeSessionId,
          activeAgentId: action.state.activeAgentId ?? state.activeAgentId,
        },
      };

    case "SET_SESSION_OVERVIEW_FILTER": {
      return {
        ...state,
        sessionOverviewState: {
          ...state.sessionOverviewState,
          filter: action.filter,
        },
      };
    }

    case "SET_SESSION_OVERVIEW_EXPANDED": {
      return {
        ...state,
        sessionOverviewState: {
          ...state.sessionOverviewState,
          expandedSessions: action.sessions,
        },
      };
    }

    case "SET_SESSION_OVERVIEW_WIDTH":
      return { ...state, sessionOverviewWidth: action.width };

    case "SET_SESSION_OVERVIEW_SELECTED": {
      return {
        ...state,
        sessionOverviewState: {
          ...state.sessionOverviewState,
          selectedSessionIds: action.sessionIds,
        },
      };
    }

    case "TOGGLE_SESSION_OVERVIEW_SELECTED": {
      const current = state.sessionOverviewState.selectedSessionIds ?? [];
      const idx = current.indexOf(action.sessionId);
      const next = idx >= 0
        ? [...current.slice(0, idx), ...current.slice(idx + 1)]
        : [...current, action.sessionId];
      return {
        ...state,
        sessionOverviewState: {
          ...state.sessionOverviewState,
          selectedSessionIds: next,
        },
      };
    }

    case "SET_SESSION_OVERVIEW_SELECTION_MODE": {
      return {
        ...state,
        sessionOverviewState: {
          ...state.sessionOverviewState,
          selectionMode: action.enabled,
        },
      };
    }

    case "TOGGLE_SESSION_OVERVIEW_SELECTION": {
      // Enter selection mode and toggle the session
      const current = state.sessionOverviewState.selectedSessionIds ?? [];
      const idx = current.indexOf(action.sessionId);
      const next = idx >= 0
        ? [...current.slice(0, idx), ...current.slice(idx + 1)]
        : [...current, action.sessionId];
      return {
        ...state,
        sessionOverviewState: {
          ...state.sessionOverviewState,
          selectionMode: true,
          selectedSessionIds: next,
        },
      };
    }

    case "SET_SESSION_INFO": {
      const key = sessionKey(action.agentId, action.sessionId);
      return {
        ...state,
        sessionInfoMap: { ...state.sessionInfoMap, [key]: action.info },
        sessionStreaming: {
          ...state.sessionStreaming,
          [key]: action.info.isStreaming,
        },
      };
    }

    case "SESSION_MESSAGE": {
      const key = sessionKey(action.agentId, action.sessionId);
      const existing = state.sessionMessages[key] ?? [];
      return {
        ...state,
        sessionMessages: {
          ...state.sessionMessages,
          [key]: [...existing, action.message],
        },
      };
    }

    case "SESSION_STREAM": {
      const key = sessionKey(action.agentId, action.sessionId);
      const existing = state.sessionMessages[key] ?? [];
      const last = existing[existing.length - 1];
      if (last && last.role === "agent" && last.agentId === action.agentId) {
        const updated = {
          ...last,
          content: last.content + action.chunk,
        };
        return {
          ...state,
          sessionMessages: {
            ...state.sessionMessages,
            [key]: [...existing.slice(0, -1), updated],
          },
          sessionStreaming: { ...state.sessionStreaming, [key]: true },
        };
      }
      const streamingMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        content: action.chunk,
        timestamp: Date.now(),
        agentId: action.agentId,
        sessionId: action.sessionId,
      };
      return {
        ...state,
        sessionMessages: {
          ...state.sessionMessages,
          [key]: [...existing, streamingMsg],
        },
        sessionStreaming: { ...state.sessionStreaming, [key]: true },
      };
    }

    case "SESSION_STREAM_END": {
      const key = sessionKey(action.agentId, action.sessionId);
      return {
        ...state,
        sessionStreaming: { ...state.sessionStreaming, [key]: false },
      };
    }

    case "SESSION_TURN_ACTIVE": {
      const key = sessionKey(action.agentId, action.sessionId);
      if (!action.active) {
        return {
          ...state,
          sessionStreaming: { ...state.sessionStreaming, [key]: false },
        };
      }
      return state;
    }

    case "SESSION_SWITCH": {
      const key = sessionKey(action.agentId, action.sessionId);
      return {
        ...state,
        sessionMessages: { ...state.sessionMessages, [key]: action.messages },
        sessionStreaming: { ...state.sessionStreaming, [key]: false },
      };
    }

    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

export const SessionReactContext = createContext<SessionContext | null>(null);

/**
 * Provides session state for the entire webview tree.
 * Must wrap the root component (see index.tsx).
 */
export function SessionContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const isReadyRef = useRef(false);
  const isSessionReadyRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeSessionKey = computeActiveSessionKey(state);

  const availableCommands = activeSessionKey
    ? (state.sessionCommands[activeSessionKey] ?? [])
    : [];

  // Background session completion notification (queue for stacking)
  const [completedNotifications, setCompletedNotifications] = React.useState<
    Array<{ agentId: string; sessionId: string; title: string }>
  >([]);

  // ------------------------------------------------------------------
  // Message handler — listens for tab/agent control messages from extension host
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data?.type) return;

      switch (data.type) {
        // --- Agent info ---
        case "agentInfo":
          dispatch({
            type: "SET_AGENT_INFO",
            agentId: data.agentId as string,
            info: data.info as AgentInfo,
          });
          return;

        // --- Statusline ---
        case "statusline":
          dispatch({
            type: "SET_STATUSLINE",
            statusline: {
              hostname: data.hostname as string | undefined,
              repoName: data.repoName as string | undefined,
              branch: data.branch as string | undefined,
              tag: data.tag as string | undefined,
            },
          });
          return;

        // --- Tab management ---
        case "setTabs": {
          dispatch({ type: "SET_TABS", tabs: data.tabs as SessionTabState[] });
          dispatch({
            type: "SET_WORKSPACE_ROOT",
            root: (data.workspaceRoot as string) ?? undefined,
          });
          dispatch({
            type: "SET_CONNECTED_AGENTS",
            agents: (data.agents as ConnectedAgentInfo[]) ?? [],
          });
          dispatch({
            type: "SET_WORKSPACE_FOLDERS",
            folders: (data.workspaceFolders as WorkspaceFolder[]) ?? [],
          });
          if (data.agentInfoMap) {
            const map = data.agentInfoMap as Record<string, AgentInfo>;
            for (const [agentId, info] of Object.entries(map)) {
              dispatch({ type: "SET_AGENT_INFO", agentId, info });
            }
          }
          if (data.sessionInfoMap) {
            dispatch({
              type: "SET_SESSION_INFO_MAP",
              map: data.sessionInfoMap as Record<string, SessionInfoSnapshot>,
            });
          }
          return;
        }

        case "addTab":
          dispatch({ type: "ADD_TAB", tab: data.tab as SessionTabState });
          return;

        case "updateTab":
          dispatch({
            type: "UPDATE_TAB",
            sessionId: data.sessionId as string,
            updates: data.updates as Partial<SessionTabState>,
          });
          return;

        case "setActiveSession":
          dispatch({
            type: "SET_ACTIVE_SESSION",
            sessionId: data.sessionId as string,
            agentId: data.agentId as string,
          });
          return;

        // --- Background session completed ---
        case "session/completed":
          setCompletedNotifications((prev) => [
            ...prev,
            {
              agentId: data.agentId as string,
              sessionId: data.sessionId as string,
              title: data.title as string,
            },
          ]);
          return;

        // --- Slash commands ---
        case "session/commands":
          dispatch({
            type: "SET_SESSION_COMMANDS",
            agentId: data.agentId as string,
            sessionId: data.sessionId as string,
            commands: data.commands as SlashCommand[],
          });
          return;

        case "session/info": {
          // Always process — session/info carries tab metadata (cwd, model,
          // status, token usage) that every tab needs regardless of which tab
          // is currently active. Without this, a newly created session would
          // never show its cwd until the user manually switches to it.
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          dispatch({
            type: "SET_SESSION_INFO",
            agentId: aId,
            sessionId: sId,
            info: data as unknown as SessionInfoSnapshot,
          });
          return;
        }

        // --- Per-session incremental updates ---
        case "session/message": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey = computeActiveSessionKey(cur);
          if (msgKey === curActiveKey) {
            dispatch({
              type: "SESSION_MESSAGE",
              agentId: aId,
              sessionId: sId,
              message: data.message as ChatMessage,
            });
          } else {
            // Non-active session: increment unread badge
            dispatch({
              type: "INCREMENT_UNREAD",
              sessionId: sId,
              agentId: aId,
            });
          }
          return;
        }

        case "session/stream": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey = computeActiveSessionKey(cur);
          if (msgKey === curActiveKey) {
            dispatch({
              type: "SESSION_STREAM",
              agentId: aId,
              sessionId: sId,
              chunk: data.chunk as string,
            });
          } else {
            // Non-active session: increment unread badge on first stream chunk
            dispatch({
              type: "INCREMENT_UNREAD",
              sessionId: sId,
              agentId: aId,
            });
          }
          return;
        }

        case "session/streamEnd": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey = computeActiveSessionKey(cur);
          if (msgKey === curActiveKey) {
            dispatch({
              type: "SESSION_STREAM_END",
              agentId: aId,
              sessionId: sId,
            });
          }
          return;
        }

        // --- Session switch: full snapshot from extension host ---
        // Always process — session/switch IS the switch mechanism. The
        // extension host sends session/switch when it wants the webview to
        // display a session (initial load, new session, tab switch). If we
        // gated on curActiveKey, the very first switch after creating a new
        // session would be dropped because the webview hasn't updated its
        // active key yet.
        case "session/switch": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          dispatch({
            type: "SET_ACTIVE_SESSION",
            sessionId: sId,
            agentId: aId,
          });
          dispatch({
            type: "SESSION_SWITCH",
            agentId: aId,
            sessionId: sId,
            messages: data.messages as ChatMessage[],
          });
          return;
        }

        case "session/turnActive": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey = computeActiveSessionKey(cur);
          if (msgKey === curActiveKey) {
            dispatch({
              type: "SESSION_TURN_ACTIVE",
              agentId: aId,
              sessionId: sId,
              active: data.active as boolean,
            });
          }
          return;
        }

        // --- Legacy session/update (backward compat) ---
        case "session/update": {
          switch (data.updateType) {
            case "session_status":
              // Legacy turn-active signal — no-op, state comes from SessionInfo
              break;
          }
          return;
        }

        // --- Session Overview ---
        case "sessionOverview:state":
          dispatch({
            type: "SET_SESSION_OVERVIEW_STATE",
            state: data.payload as SessionOverviewState,
          });
          return;

        case "sessionOverview:update": {
          const item = data.payload as SessionOverviewItem;
          const current = stateRef.current.sessionOverviewState;
          const curActive = stateRef.current;
          const idx = current.sessions.findIndex(
            (s) => s.sessionId === item.sessionId && s.agentId === item.agentId
          );
          const sessions = [...current.sessions];
          if (idx >= 0) {
            sessions[idx] = item;
          } else {
            sessions.push(item);
          }
          dispatch({
            type: "SET_SESSION_OVERVIEW_STATE",
            state: {
              ...current,
              sessions,
              lastUpdated: new Date().toISOString(),
              activeSessionId: curActive.activeSessionId ?? current.activeSessionId,
              activeAgentId: curActive.activeAgentId ?? current.activeAgentId,
            },
          });
          return;
        }

        case "sessionOverview:toggle":
          dispatch({
            type: "SET_SESSION_OVERVIEW_VISIBLE",
            visible: data.payload.visible as boolean,
          });
          return;

        case "sessionOverview:position":
          dispatch({
            type: "SET_SESSION_OVERVIEW_POSITION",
            position: data.payload.position as "right" | "left",
          });
          return;

        // --- Legacy single-session (backward compat) ---
        case "agentName":
        case "setMessages":
        case "addMessage":
        case "clearMessages":
        case "streamChunk":
        case "endStream":
        case "tokenUsage":
        case "turnActive":
        case "fullState":
        case "session/tokenUsage":
          // Deprecated — state is now managed via SessionInfo in the extension host
          return;
      }
    };

    window.addEventListener("message", handleMessage);

    if (!isReadyRef.current) {
      isReadyRef.current = true;
      getVsCodeApi().postMessage({ type: "ready" });
    }

    if (!isSessionReadyRef.current) {
      isSessionReadyRef.current = true;
      getVsCodeApi().postMessage({ type: "sessionReady" });
    }

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  const sendMessage = useCallback(
    (
      text: string,
      attachments: ContextAttachment[] = [],
      agentId?: string,
      sessionId?: string
    ) => {
      getVsCodeApi().postMessage({
        type: "sendMessage",
        text,
        attachments,
        agentId,
        sessionId,
      });
    },
    []
  );

  const cancelTurn = useCallback((agentId?: string, sessionId?: string) => {
    getVsCodeApi().postMessage({ type: "cancelTurn", agentId, sessionId });
  }, []);

  const switchTab = useCallback((sessionId: string, agentId: string) => {
    dispatch({ type: "SET_ACTIVE_SESSION", sessionId, agentId });
    dispatch({ type: "UPDATE_TAB", sessionId, updates: { unreadCount: 0 } });
    getVsCodeApi().postMessage({ type: "switchSession", sessionId, agentId });
  }, []);

  const newSession = useCallback((agentId: string) => {
    getVsCodeApi().postMessage({ type: "newSession", agentId });
  }, []);

  const newSessionWithPicker = useCallback(() => {
    getVsCodeApi().postMessage({ type: "openNewSessionPicker" });
  }, []);

  const closeSession = useCallback((sessionId: string) => {
    dispatch({ type: "REMOVE_TAB", sessionId });
    getVsCodeApi().postMessage({ type: "closeSession", sessionId });
  }, []);

  const forkSession = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({ type: "forkSession", sessionId });
  }, []);

  const fetchFiles = useCallback((query: string): Promise<FileCandidate[]> => {
    return new Promise((resolve) => {
      const reqId = crypto.randomUUID();
      const handler = (event: MessageEvent) => {
        if (
          event.data.type === "fileCandidates" &&
          event.data.reqId === reqId
        ) {
          window.removeEventListener("message", handler);
          resolve(event.data.candidates ?? []);
        }
      };
      window.addEventListener("message", handler);
      const cur = stateRef.current;
      const key = computeActiveSessionKey(cur);
      const info = key ? cur.sessionInfoMap[key] : undefined;
      getVsCodeApi().postMessage({
        type: "fetchFiles",
        query,
        reqId,
        cwd: info?.cwd,
        agentId: cur.activeAgentId ?? undefined,
        sessionId: cur.activeSessionId ?? undefined,
      });
    });
  }, []);

  const resolveFile = useCallback(
    (path: string): Promise<ContextAttachment> => {
      return new Promise((resolve, reject) => {
        const reqId = crypto.randomUUID();
        const handler = (event: MessageEvent) => {
          if (
            event.data.type === "resolvedFile" &&
            event.data.reqId === reqId
          ) {
            window.removeEventListener("message", handler);
            if (event.data.attachment) {
              resolve(event.data.attachment as ContextAttachment);
            } else {
              reject(
                new Error(
                  (event.data.error as string) ?? "Failed to resolve file"
                )
              );
            }
          }
        };
        window.addEventListener("message", handler);
        const cur = stateRef.current;
        const key = computeActiveSessionKey(cur);
        const info = key ? cur.sessionInfoMap[key] : undefined;
        getVsCodeApi().postMessage({
          type: "resolveFile",
          path,
          reqId,
          cwd: info?.cwd,
          agentId: cur.activeAgentId ?? undefined,
          sessionId: cur.activeSessionId ?? undefined,
        });
      });
    },
    []
  );

  const resolveSelection =
    useCallback((): Promise<ContextAttachment | null> => {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.data.type === "resolvedSelection") {
            window.removeEventListener("message", handler);
            resolve(event.data.attachment as ContextAttachment | null);
          }
        };
        window.addEventListener("message", handler);
        getVsCodeApi().postMessage({ type: "resolveSelection" });
      });
    }, []);

  const resolveDiff = useCallback((): Promise<ContextAttachment | null> => {
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "resolvedDiff") {
          window.removeEventListener("message", handler);
          resolve(event.data.attachment as ContextAttachment | null);
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "resolveDiff" });
    });
  }, []);

  const fetchSymbols = useCallback(
    (query: string): Promise<SuggestionItem[]> => {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (
            event.data.type === "symbolCandidates" &&
            event.data.query === query
          ) {
            window.removeEventListener("message", handler);
            resolve((event.data.candidates as SuggestionItem[]) ?? []);
          }
        };
        window.addEventListener("message", handler);
        getVsCodeApi().postMessage({ type: "fetchSymbols", query });
      });
    },
    []
  );

  const resolveSymbol = useCallback(
    (name: string): Promise<ContextAttachment> => {
      return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (
            event.data.type === "resolvedSymbol" &&
            event.data.name === name
          ) {
            window.removeEventListener("message", handler);
            if (event.data.attachment) {
              resolve(event.data.attachment as ContextAttachment);
            } else {
              reject(
                new Error(
                  (event.data.error as string) ?? "Failed to resolve symbol"
                )
              );
            }
          }
        };
        window.addEventListener("message", handler);
        getVsCodeApi().postMessage({ type: "resolveSymbol", name });
      });
    },
    []
  );

  const dismissCompletedNotification = useCallback(() => {
    setCompletedNotifications((prev) => prev.slice(1));
  }, []);

  const toggleSessionOverview = useCallback(() => {
    dispatch({
      type: "SET_SESSION_OVERVIEW_VISIBLE",
      visible: !stateRef.current.sessionOverviewVisible,
    });
  }, []);

  const setSessionOverviewFilter = useCallback(
    (filter: SessionOverviewFilter) => {
      dispatch({ type: "SET_SESSION_OVERVIEW_FILTER", filter });
    },
    []
  );

  const toggleSessionOverviewSelection = useCallback(
    (sessionId: string) => {
      dispatch({ type: "TOGGLE_SESSION_OVERVIEW_SELECTED", sessionId });
    },
    []
  );

  const setSessionOverviewSelection = useCallback(
    (sessionIds: string[]) => {
      dispatch({ type: "SET_SESSION_OVERVIEW_SELECTED", sessionIds });
    },
    []
  );

  const stableActions = React.useRef({
    sendMessage,
    cancelTurn,
    switchTab,
    newSession,
    newSessionWithPicker,
    closeSession,
    forkSession,
    fetchFiles,
    resolveFile,
    resolveSelection,
    resolveDiff,
    fetchSymbols,
    resolveSymbol,
    dismissCompletedNotification,
    toggleSessionOverview,
    setSessionOverviewFilter,
    toggleSessionOverviewSelection,
    setSessionOverviewSelection,
    dispatch,
  });
  stableActions.current = {
    sendMessage,
    cancelTurn,
    switchTab,
    newSession,
    newSessionWithPicker,
    closeSession,
    forkSession,
    fetchFiles,
    resolveFile,
    resolveSelection,
    resolveDiff,
    fetchSymbols,
    resolveSymbol,
    dismissCompletedNotification,
    toggleSessionOverview,
    setSessionOverviewFilter,
    toggleSessionOverviewSelection,
    setSessionOverviewSelection,
    dispatch,
  };

  const activeMessages = activeSessionKey
    ? (state.sessionMessages[activeSessionKey] ?? [])
    : [];
  const activeIsStreaming = activeSessionKey
    ? (state.sessionStreaming[activeSessionKey] ?? false)
    : false;

  const contextValue = React.useMemo(
    () => ({
      tabs: state.tabs,
      activeSessionId: state.activeSessionId,
      activeAgentId: state.activeAgentId,
      activeSessionKey,
      connectedAgents: state.connectedAgents,
      agentInfoMap: state.agentInfoMap,
      workspaceFolders: state.workspaceFolders,
      workspaceRoot: state.workspaceRoot,
      sessionInfoMap: state.sessionInfoMap,
      messages: activeMessages,
      isStreaming: activeIsStreaming,
      completedNotifications,
      availableCommands,
      statusline: state.statusline,
      // Session Overview
      sessionOverviewVisible: state.sessionOverviewVisible,
      sessionOverviewState: state.sessionOverviewState,
      sessionOverviewPosition: state.sessionOverviewPosition,
      sessionOverviewWidth: state.sessionOverviewWidth,
      toggleSessionOverview: stableActions.current.toggleSessionOverview,
      setSessionOverviewFilter: stableActions.current.setSessionOverviewFilter,
      toggleSessionOverviewSelection: stableActions.current.toggleSessionOverviewSelection,
      setSessionOverviewSelection: stableActions.current.setSessionOverviewSelection,
      // Stable function refs
      sendMessage: stableActions.current.sendMessage,
      cancelTurn: stableActions.current.cancelTurn,
      switchTab: stableActions.current.switchTab,
      newSession: stableActions.current.newSession,
      newSessionWithPicker: stableActions.current.newSessionWithPicker,
      closeSession: stableActions.current.closeSession,
      forkSession: stableActions.current.forkSession,
      fetchFiles: stableActions.current.fetchFiles,
      resolveFile: stableActions.current.resolveFile,
      resolveSelection: stableActions.current.resolveSelection,
      resolveDiff: stableActions.current.resolveDiff,
      fetchSymbols: stableActions.current.fetchSymbols,
      resolveSymbol: stableActions.current.resolveSymbol,
      dismissCompletedNotification:
        stableActions.current.dismissCompletedNotification,
      dispatch: stableActions.current.dispatch,
    }),
    [
      state.tabs,
      state.activeSessionId,
      state.activeAgentId,
      activeSessionKey,
      state.connectedAgents,
      state.agentInfoMap,
      state.workspaceFolders,
      state.workspaceRoot,
      state.sessionInfoMap,
      completedNotifications,
      availableCommands,
      state.statusline,
      activeMessages,
      activeIsStreaming,
      state.sessionOverviewVisible,
      state.sessionOverviewState,
    ]
  );

  return (
    <SessionReactContext.Provider value={contextValue}>
      {children}
    </SessionReactContext.Provider>
  );
}

// ============================================================================
// Consumer hook
// ============================================================================

/**
 * Read session state from context.
 * Must be called inside <SessionContextProvider>.
 */
export function useSessionContext(): SessionContext {
  const ctx = React.useContext(SessionReactContext);
  if (!ctx) {
    throw new Error(
      "useSessionContext must be used within a SessionContextProvider"
    );
  }
  return ctx;
}
