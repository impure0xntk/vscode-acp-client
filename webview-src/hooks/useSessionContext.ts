import React, { useReducer, useEffect, useCallback, useRef } from "react";
import type { ChatMessage, TokenUsage, ContextAttachment, FileCandidate, SuggestionItem } from "../types";

import { getVsCodeApi } from "../lib/vscodeApi";

// ============================================================================
// Helpers
// ============================================================================

// ============================================================================
// Re-exports (for consumers)
// ============================================================================

// ============================================================================
// Tab types (previously from useMultiSession)
// ============================================================================

export type SessionTabStatus = "idle" | "running" | "completed" | "error" | "cancelled";

export interface SessionTabState {
  sessionId: string;
  agentId: string;
  title: string;
  status: SessionTabStatus;
  unreadCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Session start timestamp (ms since epoch) for duration calculation */
  sessionStartMs: number;
  lastActivity: number;
  isDirty: boolean;
  cwd?: string;
  model?: string;
  mode?: string;
  /** Max context window size in tokens (from UsageUpdate.size) */
  contextWindowMax?: number;
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
// Per-session message state
// ============================================================================

export interface SessionMessagesState {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  isTurnActive: boolean;
}

const emptySessionState = (): SessionMessagesState => ({
  messages: [],
  streamingContent: "",
  isStreaming: false,
  isTurnActive: false,
});

// ============================================================================
// Unified state
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

export interface SessionContext {
  // Tab / session management
  tabs: SessionTabState[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  contextWindowMax?: number;

  // Connected agents info (for new session picker)
  connectedAgents: ConnectedAgentInfo[];

  // Agent info from InitializeResponse (keyed by agentId)
  agentInfoMap: Record<string, AgentInfo>;

  // Workspace folders (for new session picker)
  workspaceFolders: WorkspaceFolder[];

  // Active session derived state
  activeSessionKey: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  isTurnActive: boolean;
  tokenUsage: TokenUsage;
  agentName: string;

  // All sessions raw data
  sessions: Record<SessionKey, SessionMessagesState>;
  workspaceRoot?: string;

  // Available slash commands for the active session
  availableCommands: SlashCommand[];

  // Background session completion notification
  completedNotification: { agentId: string; sessionId: string; title: string } | null;
  dismissCompletedNotification: () => void;

  // Actions
  sendMessage: (text: string, attachments?: ContextAttachment[], agentId?: string, sessionId?: string) => void;
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
  sessions: Record<SessionKey, SessionMessagesState>;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  agentName: string;
  workspaceRoot?: string;
  connectedAgents: ConnectedAgentInfo[];
  agentInfoMap: Record<string, AgentInfo>;
  workspaceFolders: WorkspaceFolder[];
  // sessionKey → SlashCommand[]
  sessionCommands: Record<string, SlashCommand[]>;
}

const initialState: FullState = {
  tabs: [],
  activeSessionId: null,
  activeAgentId: null,
  sessions: {},
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  contextWindowMax: undefined,
  agentName: "",
  connectedAgents: [],
  agentInfoMap: {},
  workspaceFolders: [],
  sessionCommands: {},
};

// ============================================================================
// Active session key derivation
// ============================================================================

function computeActiveSessionKey(state: FullState): SessionKey | null {
  if (state.activeSessionId && state.activeAgentId) {
    return sessionKey(state.activeAgentId, state.activeSessionId);
  }
  return null;
}

// ============================================================================
// Action types
// ============================================================================

type SessionAction =
  // --- Tab management ---
  | { type: "SET_TABS"; tabs: SessionTabState[] }
  | { type: "ADD_TAB"; tab: SessionTabState }
  | { type: "REMOVE_TAB"; sessionId: string }
  | { type: "UPDATE_TAB"; sessionId: string; agentId?: string; updates: Partial<SessionTabState> }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string; agentId: string }
  | { type: "REORDER_TABS"; tabs: SessionTabState[] }

  // --- Per-session message actions ---
  | { type: "SET_SESSION_MESSAGES"; agentId: string; sessionId: string; messages: ChatMessage[] }
  | { type: "ADD_SESSION_MESSAGE"; agentId: string; sessionId: string; message: ChatMessage }
  | { type: "CLEAR_SESSION_MESSAGES"; agentId: string; sessionId: string }
  | { type: "APPEND_SESSION_STREAM"; agentId: string; sessionId: string; chunk: string }
  | { type: "END_SESSION_STREAM"; agentId: string; sessionId: string }
  | { type: "SET_SESSION_TURN_ACTIVE"; agentId: string; sessionId: string; active: boolean }
  | { type: "CANCEL_SESSION"; agentId: string; sessionId: string }

  // --- Global actions ---
  | { type: "SET_TOKEN_USAGE"; usage: TokenUsage }
  | { type: "SET_AGENT_NAME"; name: string }
  | { type: "SET_WORKSPACE_ROOT"; root?: string }

  // --- Session switch (sets active + full messages/state) ---
  | { type: "SESSION_SWITCH"; agentId: string; sessionId: string; messages?: ChatMessage[]; tokenUsage?: TokenUsage; contextWindowMax?: number }

  // --- Agent / workspace info ---
  | { type: "SET_AGENT_INFO"; agentId: string; info: AgentInfo }
  | { type: "SET_CONNECTED_AGENTS"; agents: ConnectedAgentInfo[] }
  | { type: "SET_WORKSPACE_FOLDERS"; folders: WorkspaceFolder[] }

  // --- Slash commands ---
  | { type: "SET_SESSION_COMMANDS"; agentId: string; sessionId: string; commands: SlashCommand[] }

  // --- Per-session usage update (from session/usage) ---
  | { type: "UPDATE_SESSION_USAGE"; agentId: string; sessionId: string; tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number }; contextWindowMax?: number }

  // --- Legacy backward-compat ---
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "ADD_MESSAGE"; message: ChatMessage }
  | { type: "CLEAR_MESSAGES" }
  | { type: "APPEND_STREAM"; chunk: string }
  | { type: "END_STREAM" }
  | { type: "SET_TURN_ACTIVE"; active: boolean };

// ============================================================================
// Reducer
// ============================================================================

function ensureSession(
  sessions: Record<SessionKey, SessionMessagesState>,
  key: SessionKey
): SessionMessagesState {
  if (!sessions[key]) {
    sessions[key] = emptySessionState();
  }
  return sessions[key];
}

function reducer(state: FullState, action: SessionAction): FullState {
  switch (action.type) {
    // ==================================================================
    // Tab management
    // ==================================================================

    case "SET_TABS": {
      // Auto-select the only tab when there is exactly one and no active session yet
      if (action.tabs.length === 1 && !state.activeSessionId) {
        return {
          ...state,
          tabs: action.tabs,
          activeSessionId: action.tabs[0].sessionId,
          activeAgentId: action.tabs[0].agentId,
        };
      }
      return { ...state, tabs: action.tabs };
    }


    case "ADD_TAB":
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        activeSessionId: action.tab.sessionId,
        activeAgentId: action.tab.agentId,
      };

    case "REMOVE_TAB": {
      // Find the tab matching both sessionId and agentId (from active session)
      const targetAgentId = state.activeSessionId === action.sessionId ? state.activeAgentId : undefined;
      const removedTab = targetAgentId
        ? state.tabs.find((t) => t.sessionId === action.sessionId && t.agentId === targetAgentId)
        : state.tabs.find((t) => t.sessionId === action.sessionId);

      const newTabs = removedTab
        ? state.tabs.filter((t) => !(t.sessionId === action.sessionId && t.agentId === removedTab.agentId))
        : state.tabs.filter((t) => t.sessionId !== action.sessionId);

      let newActiveSessionId = state.activeSessionId;
      let newActiveAgentId = state.activeAgentId;
      if (state.activeSessionId === action.sessionId && state.activeAgentId === (removedTab?.agentId ?? targetAgentId)) {
        if (newTabs.length > 0) {
          newActiveSessionId = newTabs[newTabs.length - 1].sessionId;
          newActiveAgentId = newTabs[newTabs.length - 1].agentId;
        } else {
          newActiveSessionId = null;
          newActiveAgentId = null;
        }
      }
      // Remove the session messages for the closed tab
      const newSessions = { ...state.sessions };
      if (removedTab) {
        const key = sessionKey(removedTab.agentId, removedTab.sessionId);
        delete newSessions[key];
      }
      return {
        ...state,
        tabs: newTabs,
        activeSessionId: newActiveSessionId,
        activeAgentId: newActiveAgentId,
        sessions: newSessions,
      };
    }

    case "UPDATE_TAB": {
      const tabs = state.tabs.map((t) => {
        if (t.sessionId !== action.sessionId) return t;
        const merged = { ...t, ...action.updates };
        // Don't overwrite contextWindowMax with undefined
        if (action.updates.contextWindowMax === undefined) {
          merged.contextWindowMax = t.contextWindowMax;
        }
        return merged;
      });
      return { ...state, tabs };
    }

    case "UPDATE_SESSION_USAGE": {
      const tabs = state.tabs.map((t) => {
        if (t.sessionId !== action.sessionId || t.agentId !== action.agentId) return t;
        const merged = { ...t };
        if (action.tokenUsage) {
          merged.tokenUsage = action.tokenUsage;
        }
        if (action.contextWindowMax !== undefined && action.contextWindowMax > 0) {
          merged.contextWindowMax = action.contextWindowMax;
        }
        return merged;
      });
      const isActiveTab = action.sessionId === state.activeSessionId && action.agentId === state.activeAgentId;
      const globalCwm = isActiveTab && action.contextWindowMax !== undefined && action.contextWindowMax > 0
        ? action.contextWindowMax
        : state.contextWindowMax;
      // Sync global tokenUsage from the active tab so Toolbar always shows
      // the latest values even when App.tsx falls back to the global state.
      const globalTokenUsage = isActiveTab && action.tokenUsage
        ? action.tokenUsage
        : state.tokenUsage;
      return { ...state, tabs, contextWindowMax: globalCwm, tokenUsage: globalTokenUsage };
    }

    case "SET_ACTIVE_SESSION":
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeAgentId: action.agentId,
      };

    case "REORDER_TABS":
      return { ...state, tabs: action.tabs };

    // ==================================================================
    // Per-session message actions
    // ==================================================================

    case "SET_SESSION_MESSAGES": {
      const key = sessionKey(action.agentId, action.sessionId);
      const sessions = {
        ...state.sessions,
        [key]: {
          ...ensureSession(state.sessions, key),
          messages: action.messages,
          streamingContent: "",
          isStreaming: false,
        },
      };
      return { ...state, sessions };
    }

    case "ADD_SESSION_MESSAGE": {
      const key = sessionKey(action.agentId, action.sessionId);
      const prev = ensureSession(state.sessions, key);
      // Replace by id when the message already exists (tool call status updates)
      const existingIdx = prev.messages.findIndex((m) => m.id === action.message.id);
      const msgs =
        existingIdx >= 0
          ? [...prev.messages.slice(0, existingIdx), action.message, ...prev.messages.slice(existingIdx + 1)]
          : [...prev.messages, action.message];
      const sessions = {
        ...state.sessions,
        [key]: { ...prev, messages: msgs },
      };
      return { ...state, sessions };
    }

    case "CLEAR_SESSION_MESSAGES": {
      const key = sessionKey(action.agentId, action.sessionId);
      const sessions = { ...state.sessions, [key]: emptySessionState() };
      return { ...state, sessions };
    }

    case "APPEND_SESSION_STREAM": {
      const key = sessionKey(action.agentId, action.sessionId);
      const prev = ensureSession(state.sessions, key);
      const newContent = prev.streamingContent + action.chunk;
      const msgs = [...prev.messages];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx].role === "agent" && prev.isStreaming) {
        msgs[lastIdx] = { ...msgs[lastIdx], content: newContent };
      } else {
        msgs.push({
          id: crypto.randomUUID(),
          role: "agent",
          content: newContent,
          timestamp: Date.now(),
        });
      }
      const sessions = {
        ...state.sessions,
        [key]: { ...prev, messages: msgs, streamingContent: newContent, isStreaming: true },
      };
      return { ...state, sessions };
    }

    case "END_SESSION_STREAM": {
      const key = sessionKey(action.agentId, action.sessionId);
      const prev = ensureSession(state.sessions, key);
      const sessions = {
        ...state.sessions,
        [key]: { ...prev, streamingContent: "", isStreaming: false },
      };
      // When stream ends, mark tab as completed
      const tabs = state.tabs.map((t) =>
        t.sessionId === action.sessionId && t.agentId === action.agentId
          ? { ...t, status: "completed" as const }
          : t
      );
      return { ...state, sessions, tabs };
    }

    case "SET_SESSION_TURN_ACTIVE": {
      const key = sessionKey(action.agentId, action.sessionId);
      const prev = ensureSession(state.sessions, key);
      const sessions = {
        ...state.sessions,
        [key]: { ...prev, isTurnActive: action.active },
      };
      // Sync tab status: running when active, idle when inactive
      const tabs = state.tabs.map((t) =>
        t.sessionId === action.sessionId && t.agentId === action.agentId
          ? { ...t, status: action.active ? "running" as const : "idle" as const }
          : t
      );
      return { ...state, sessions, tabs };
    }

    case "CANCEL_SESSION": {
      const key = sessionKey(action.agentId, action.sessionId);
      const prev = ensureSession(state.sessions, key);
      const msgs = prev.messages.map((m) => {
        if (m.toolCalls) {
          return {
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.status === "in_progress"
                ? { ...tc, status: "cancelled" as const }
                : tc
            ),
          };
        }
        return m;
      });
      const sessions = {
        ...state.sessions,
        [key]: { ...prev, messages: msgs, isStreaming: false, isTurnActive: false },
      };
      return { ...state, sessions };
    }

    // ==================================================================
    // Global actions
    // ==================================================================

    case "SET_TOKEN_USAGE":
      return { ...state, tokenUsage: action.usage };

    case "SET_AGENT_NAME":
      return { ...state, agentName: action.name };

    case "SET_WORKSPACE_ROOT":
      return { ...state, workspaceRoot: action.root };

    case "SET_AGENT_INFO":
      return {
        ...state,
        agentInfoMap: { ...state.agentInfoMap, [action.agentId]: action.info },
      };

    case "SET_CONNECTED_AGENTS":
      return { ...state, connectedAgents: action.agents };

    case "SET_WORKSPACE_FOLDERS":
      return { ...state, workspaceFolders: action.folders };

    // ==================================================================
    // Slash commands
    // ==================================================================

    case "SET_SESSION_COMMANDS": {
      const key = sessionKey(action.agentId, action.sessionId);
      return {
        ...state,
        sessionCommands: { ...state.sessionCommands, [key]: action.commands },
      };
    }

    // ==================================================================
    // Session switch — sets active + full messages/state
    // ==================================================================

    case "SESSION_SWITCH": {
      const key = sessionKey(action.agentId, action.sessionId);
      let sessions = state.sessions;
      if (action.messages) {
        sessions = {
          ...sessions,
          [key]: {
            ...ensureSession(sessions, key),
            messages: action.messages,
            streamingContent: "",
            isStreaming: false,
          },
        };
      }
      // Sync tokenUsage and contextWindowMax from session/switch payload
      const tokenUsage = action.tokenUsage ?? state.tokenUsage;
      const contextWindowMax = action.contextWindowMax ?? state.contextWindowMax;
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeAgentId: action.agentId,
        sessions,
        tokenUsage,
        contextWindowMax,
      };
    }

    // ==================================================================
    // Legacy backward-compat (operate on active session)
    // ==================================================================

    case "SET_MESSAGES":
    case "ADD_MESSAGE":
    case "CLEAR_MESSAGES":
    case "APPEND_STREAM":
    case "END_STREAM":
    case "SET_TURN_ACTIVE": {
      const activeKey = computeActiveSessionKey(state);
      const hasKey = Boolean(activeKey);
      const key = activeKey ?? "__legacy__";
      let baseState = state;
      if (!hasKey) {
        baseState = reducer(baseState, { type: "SET_ACTIVE_SESSION", sessionId: "__legacy__", agentId: "__legacy__" });
      }
      const legacyMap: Record<string, SessionAction> = {
        SET_MESSAGES: { type: "SET_SESSION_MESSAGES", agentId: key.split(":")[0], sessionId: key.split(":")[1], messages: (action as { messages: ChatMessage[] }).messages },
        ADD_MESSAGE: { type: "ADD_SESSION_MESSAGE", agentId: key.split(":")[0], sessionId: key.split(":")[1], message: (action as { message: ChatMessage }).message },
        CLEAR_MESSAGES: { type: "CLEAR_SESSION_MESSAGES", agentId: key.split(":")[0], sessionId: key.split(":")[1] },
        APPEND_STREAM: { type: "APPEND_SESSION_STREAM", agentId: key.split(":")[0], sessionId: key.split(":")[1], chunk: (action as { chunk: string }).chunk },
        END_STREAM: { type: "END_SESSION_STREAM", agentId: key.split(":")[0], sessionId: key.split(":")[1] },
        SET_TURN_ACTIVE: { type: "SET_SESSION_TURN_ACTIVE", agentId: key.split(":")[0], sessionId: key.split(":")[1], active: (action as { active: boolean }).active },
      };
      return reducer(baseState, legacyMap[action.type]!);
    }

    default:
      return state;
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useSessionContext(): SessionContext {
  const [state, dispatch] = useReducer(reducer, initialState);
  const isReadyRef = useRef(false);
  const isSessionReadyRef = useRef(false);
  const activeSessionKey = computeActiveSessionKey(state);

  // Derived active session state
  const activeSession = activeSessionKey ? state.sessions[activeSessionKey] : null;
  const messages = activeSession?.messages ?? [];
  const isStreaming = activeSession?.isStreaming ?? false;
  const isTurnActive = activeSession?.isTurnActive ?? false;
  const availableCommands = activeSessionKey ? (state.sessionCommands[activeSessionKey] ?? []) : [];



  // ------------------------------------------------------------------
  // Background session completion notification
  // ------------------------------------------------------------------
  const [completedNotification, setCompletedNotification] = React.useState<{
    agentId: string;
    sessionId: string;
    title: string;
  } | null>(null);

  // ------------------------------------------------------------------
  // Message handler — listens for ALL message types from extension host
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data?.type) return;

      // --- New session-scoped protocol ---
      switch (data.type) {
        case "session/switch":
          dispatch({
            type: "SESSION_SWITCH",
            agentId: data.agentId,
            sessionId: data.sessionId,
            messages: data.messages as ChatMessage[] | undefined,
            tokenUsage: data.tokenUsage as TokenUsage | undefined,
            contextWindowMax: data.contextWindowMax as number | undefined,
          });
          return;

        case "session/message":
          dispatch({
            type: "ADD_SESSION_MESSAGE",
            agentId: data.agentId,
            sessionId: data.sessionId,
            message: data.message as ChatMessage,
          });
          return;

        case "session/stream":
          dispatch({
            type: "APPEND_SESSION_STREAM",
            agentId: data.agentId,
            sessionId: data.sessionId,
            chunk: data.chunk as string,
          });
          return;

        case "session/streamEnd":
          dispatch({
            type: "END_SESSION_STREAM",
            agentId: data.agentId,
            sessionId: data.sessionId,
          });
          return;

        case "session/turnActive":
          dispatch({
            type: "SET_SESSION_TURN_ACTIVE",
            agentId: data.agentId,
            sessionId: data.sessionId,
            active: data.active as boolean,
          });
          return;

        case "session/cancel":
          dispatch({
            type: "CANCEL_SESSION",
            agentId: data.agentId,
            sessionId: data.sessionId,
          });
          return;

        case "session/usage": {
          const tu = data.tokenUsage as { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
          const cwm = data.contextWindowMax as number | undefined;
          dispatch({
            type: "UPDATE_SESSION_USAGE",
            agentId: data.agentId as string,
            sessionId: data.sessionId as string,
            tokenUsage: tu ? {
              inputTokens: tu.inputTokens,
              outputTokens: tu.outputTokens,
              totalTokens: tu.totalTokens,
            } : undefined,
            contextWindowMax: cwm,
          });
          return;
        }

        case "session/completed":
          setCompletedNotification({
            agentId: data.agentId as string,
            sessionId: data.sessionId as string,
            title: data.title as string,
          });
          return;

        case "session/notification": {
          const notif = data.notification as { update?: { sessionUpdate?: string; content?: { type: string; text?: string } } } | undefined;
          const updateType = notif?.update?.sessionUpdate;
          if (updateType === "tool_call" || updateType === "tool_call_update") {
            // Tool calls are already handled via sessionMessage in orchestrator,
            // but forward as session/notification fallback
            const sessionInfo = (data as { sessionInfo?: { toolCalls?: unknown[] } }).sessionInfo;
            if (sessionInfo?.toolCalls) {
              dispatch({
                type: "ADD_SESSION_MESSAGE",
                agentId: data.agentId as string,
                sessionId: data.sessionId as string,
                message: {
                  id: crypto.randomUUID(),
                  role: "tool",
                  content: "",
                  timestamp: Date.now(),
                  toolCalls: sessionInfo.toolCalls as ChatMessage["toolCalls"],
                },
              });
            }
          }
          return;
        }
      }

      // --- Agent info ---
      if (data.type === "agentInfo") {
        dispatch({
          type: "SET_AGENT_INFO",
          agentId: data.agentId as string,
          info: data.info as AgentInfo,
        });
        return;
      }

      // --- Tab management ---
      switch (data.type) {
        case "setTabs":
          dispatch({ type: "SET_TABS", tabs: data.tabs as SessionTabState[] });
          // Store workspaceRoot in global state for Toolbar display
          dispatch({ type: "SET_WORKSPACE_ROOT", root: (data.workspaceRoot as string) ?? undefined });
          // Store connected agents info for new session picker
          dispatch({ type: "SET_CONNECTED_AGENTS", agents: (data.agents as ConnectedAgentInfo[]) ?? [] });
          // Store workspace folders for new session picker
          dispatch({ type: "SET_WORKSPACE_FOLDERS", folders: (data.workspaceFolders as WorkspaceFolder[]) ?? [] });
          // Store agent info map (from InitializeResponse)
          if (data.agentInfoMap) {
            const map = data.agentInfoMap as Record<string, AgentInfo>;
            for (const [agentId, info] of Object.entries(map)) {
              dispatch({ type: "SET_AGENT_INFO", agentId, info });
            }
          }
          break;
        case "addTab":
          dispatch({ type: "ADD_TAB", tab: data.tab as SessionTabState });
          break;
        case "updateTab":
          dispatch({
            type: "UPDATE_TAB",
            sessionId: data.sessionId as string,
            updates: data.updates as Partial<SessionTabState>,
          });
          break;
        case "setActiveSession":
          dispatch({
            type: "SET_ACTIVE_SESSION",
            sessionId: data.sessionId as string,
            agentId: data.agentId as string,
          });
          break;
      }

      // --- Legacy session/update (backward compat) ---
      if (data.type === "session/update") {
        const key = sessionKey(data.agentId, data.sessionId);
        switch (data.updateType) {
          case "agent_message_chunk":
            dispatch({
              type: "APPEND_SESSION_STREAM",
              agentId: data.agentId,
              sessionId: data.sessionId,
              chunk: data.text as string,
            });
            break;
          case "tool_call":
          case "tool_call_update":
            dispatch({
              type: "ADD_SESSION_MESSAGE",
              agentId: data.agentId,
              sessionId: data.sessionId,
              message: {
                id: crypto.randomUUID(),
                role: "system",
                content: data.content as string,
                timestamp: Date.now(),
                toolCalls: data.toolCalls as ChatMessage["toolCalls"],
              },
            });
            break;
          case "session_status":
            dispatch({
              type: "SET_SESSION_TURN_ACTIVE",
              agentId: data.agentId,
              sessionId: data.sessionId,
              active: data.isTurnActive as boolean,
            });
            break;
        }
        return;
      }

      // --- Legacy single-session (backward compat) ---
      switch (data.type) {
        case "setMessages":
          dispatch({ type: "SET_MESSAGES", messages: data.messages as ChatMessage[] });
          break;
        case "addMessage":
          dispatch({ type: "ADD_MESSAGE", message: data.message as ChatMessage });
          break;
        case "clearMessages":
          dispatch({ type: "CLEAR_MESSAGES" });
          break;
        case "streamChunk":
          dispatch({ type: "APPEND_STREAM", chunk: data.chunk as string });
          break;
        case "endStream":
          dispatch({ type: "END_STREAM" });
          break;
        case "tokenUsage":
          dispatch({ type: "SET_TOKEN_USAGE", usage: data.usage as TokenUsage });
          break;
        case "session/tokenUsage":
          // Deprecated: token usage is now delivered via session/switch.
          // Keep as no-op for backward compatibility.
          break;
        case "turnActive":
          dispatch({ type: "SET_TURN_ACTIVE", active: data.active as boolean });
          break;
        case "agentName":
          dispatch({ type: "SET_AGENT_NAME", name: data.name as string });
          break;
        case "fullState":
          dispatch({ type: "SET_MESSAGES", messages: data.messages as ChatMessage[] });
          dispatch({ type: "SET_TOKEN_USAGE", usage: data.tokenUsage as TokenUsage });
          dispatch({ type: "SET_TURN_ACTIVE", active: data.isTurnActive as boolean });
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    // Fire "ready" on mount (compat — extension handler is now a no-op)
    if (!isReadyRef.current) {
      isReadyRef.current = true;
      getVsCodeApi().postMessage({ type: "ready" });
    }

    // Fire "sessionReady" on mount (tabs initialization)
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
    (text: string, attachments: ContextAttachment[] = [], agentId?: string, sessionId?: string) => {
      getVsCodeApi().postMessage({ type: "sendMessage", text, attachments, agentId, sessionId });
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

  // ------------------------------------------------------------------
  // File resolution helpers
  // ------------------------------------------------------------------

  const fetchFiles = useCallback((query: string): Promise<FileCandidate[]> => {
    return new Promise((resolve) => {
      const reqId = crypto.randomUUID();
      const handler = (event: MessageEvent) => {
        if (event.data.type === "fileCandidates" && event.data.reqId === reqId) {
          window.removeEventListener("message", handler);
          resolve(event.data.candidates ?? []);
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "fetchFiles", query, reqId });
    });
  }, []);

  const resolveFile = useCallback((path: string, token?: number): Promise<ContextAttachment> => {
    return new Promise((resolve, reject) => {
      const reqId = crypto.randomUUID();
      const handler = (event: MessageEvent) => {
        if (event.data.type === "resolvedFile" && event.data.reqId === reqId) {
          window.removeEventListener("message", handler);
          if (event.data.attachment) {
            resolve(event.data.attachment as ContextAttachment);
          } else {
            reject(new Error((event.data.error as string) ?? "Failed to resolve file"));
          }
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "resolveFile", path, reqId, token });
    });
  }, []);

  const resolveSelection = useCallback((): Promise<ContextAttachment | null> => {
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

  // ------------------------------------------------------------------
  // Symbol search helpers
  // ------------------------------------------------------------------

  const fetchSymbols = useCallback((query: string): Promise<SuggestionItem[]> => {
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "symbolCandidates" && event.data.query === query) {
          window.removeEventListener("message", handler);
          resolve((event.data.candidates as SuggestionItem[]) ?? []);
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "fetchSymbols", query });
    });
  }, []);

  const resolveSymbol = useCallback((name: string): Promise<ContextAttachment> => {
    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "resolvedSymbol" && event.data.name === name) {
          window.removeEventListener("message", handler);
          if (event.data.attachment) {
            resolve(event.data.attachment as ContextAttachment);
          } else {
            reject(new Error((event.data.error as string) ?? "Failed to resolve symbol"));
          }
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "resolveSymbol", name });
    });
  }, []);

  const dismissCompletedNotification = useCallback(() => {
    setCompletedNotification(null);
  }, []);

  // Memoize all callback refs once (stabilized identities for child props)
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
    dispatch,
  });
  stableActions.current = {
    // We keep only identity; values are overwritten each render
    // but React.memo children still see the same ref object.
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
    dispatch,
  };

  // Build context only when underlying data actually changes
  const contextValue = React.useMemo(
    () => ({
      tabs: state.tabs,
      activeSessionId: state.activeSessionId,
      activeAgentId: state.activeAgentId,
      activeSessionKey,
      contextWindowMax: state.contextWindowMax,
      connectedAgents: state.connectedAgents,
      agentInfoMap: state.agentInfoMap,
      workspaceFolders: state.workspaceFolders,
      messages,
      isStreaming,
      isTurnActive,
      tokenUsage: state.tokenUsage,
      agentName: state.agentName,
      sessions: state.sessions,
      workspaceRoot: state.workspaceRoot,
      completedNotification,
      availableCommands,
      // Stable function refs — child components that are React.memo
      // won't re-render when only these callbacks change.
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
      dismissCompletedNotification: stableActions.current.dismissCompletedNotification,
      dispatch: stableActions.current.dispatch,
    }),
    // Only data-bearing deps — action callbacks excluded for stability
    [
      state.tabs,
      state.activeSessionId,
      state.activeAgentId,
      activeSessionKey,
      state.contextWindowMax,
      state.connectedAgents,
      state.agentInfoMap,
      state.workspaceFolders,
      messages,
      isStreaming,
      isTurnActive,
      state.tokenUsage,
      state.agentName,
      state.sessions,
      state.workspaceRoot,
      completedNotification,
      availableCommands,
    ],
  );

  return contextValue;
}
