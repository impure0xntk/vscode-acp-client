import React, {
  createContext,
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
  SessionOverviewFilter,
} from "../types";
import { getVsCodeApi } from "../lib/vscodeApi";
import { useSessionStore } from "../store/sessionStore";
import { useMessageStore } from "../store/messageStore";
import { useSessionUiStateStore } from "../store/sessionUiStateStore";
import type {
  SessionTabState,
  SessionInfoSnapshot,
  ConnectedAgentInfo,
  AgentInfo,
  WorkspaceFolder,
  SlashCommand,
} from "./useSessionContext";

// Re-export types for backward compatibility
export type {
  SessionTabState,
  SessionInfoSnapshot,
  ConnectedAgentInfo,
  AgentInfo,
  WorkspaceFolder,
  SlashCommand,
} from "./useSessionContext";

// ============================================================================
// Tab types — UI-only state (no duplicated model fields)
// ============================================================================

export type SessionTabStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

// ============================================================================
// Session key helper
// ============================================================================

type SessionKey = string; // `${agentId}:${sessionId}`

function sessionKey(agentId: string, sessionId: string): SessionKey {
  return `${agentId}:${sessionId}`;
}

// ============================================================================
// Shared types
// ============================================================================

export interface SessionContext {
  // Tab / session management
  tabs: SessionTabState[];
  activeSessionId: string | null;
  activeAgentId: string | null;

  // Connected agents info
  connectedAgents: ConnectedAgentInfo[];

  // Agent info
  agentInfoMap: Record<string, AgentInfo>;

  // Workspace folders
  workspaceFolders: WorkspaceFolder[];

  // Active session key
  activeSessionKey: string | null;

  /** SessionInfo snapshots from extension host */
  sessionInfoMap: Record<string, SessionInfoSnapshot>;

  workspaceRoot?: string;

  // Available slash commands
  availableCommands: SlashCommand[];

  // Background session completion notifications
  completedNotifications: Array<{
    agentId: string;
    sessionId: string;
    title: string;
  }>;
  dismissCompletedNotification: () => void;

  // Statusline
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

  // File resolution
  fetchFiles: (query: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;

  // Symbol search
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;

  // Messages for the active session
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

  // Internal dispatch (for advanced use — now an alias for store actions)
  dispatch: React.Dispatch<SessionAction>;
}

// Internal action type kept for backward compat
type SessionAction =
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
  | { type: "SET_TABS"; tabs: SessionTabState[] }
  | { type: "ADD_TAB"; tab: SessionTabState }
  | { type: "REMOVE_TAB"; sessionId: string }
  | { type: "UPDATE_TAB"; sessionId: string; agentId?: string; updates: Partial<SessionTabState> }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string; agentId: string }
  | { type: "REORDER_TABS"; tabs: SessionTabState[] }
  | { type: "INCREMENT_UNREAD"; sessionId: string; agentId: string }
  | { type: "SET_WORKSPACE_ROOT"; root?: string }
  | { type: "SET_AGENT_INFO"; agentId: string; info: AgentInfo }
  | { type: "SET_CONNECTED_AGENTS"; agents: ConnectedAgentInfo[] }
  | { type: "SET_WORKSPACE_FOLDERS"; folders: WorkspaceFolder[] }
  | { type: "SET_SESSION_COMMANDS"; agentId: string; sessionId: string; commands: SlashCommand[] }
  | { type: "SET_STATUSLINE"; statusline: { hostname?: string; repoName?: string; branch?: string; tag?: string } }
  | { type: "SET_SESSION_INFO_MAP"; map: Record<string, SessionInfoSnapshot> }
  | { type: "SET_SESSION_INFO"; agentId: string; sessionId: string; info: SessionInfoSnapshot }
  | { type: "SESSION_MESSAGE"; agentId: string; sessionId: string; message: ChatMessage }
  | { type: "SESSION_STREAM"; agentId: string; sessionId: string; chunk: string }
  | { type: "SESSION_STREAM_END"; agentId: string; sessionId: string }
  | { type: "SESSION_SWITCH"; agentId: string; sessionId: string; messages: ChatMessage[] }
  | { type: "SESSION_TURN_ACTIVE"; agentId: string; sessionId: string; active: boolean };

// ============================================================================
// Context
// ============================================================================

export const SessionReactContext = createContext<SessionContext | null>(null);

/**
 * Provides session state for the entire webview tree.
 * Now delegates to Zustand stores for state management.
 */
export function SessionContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const isReadyRef = useRef(false);
  const isSessionReadyRef = useRef(false);
  const stateRef = useRef(useSessionStore.getState());
  stateRef.current = useSessionStore.getState();

  // Background session completion notification (queue for stacking)
  const [completedNotifications, setCompletedNotifications] = React.useState<
    Array<{ agentId: string; sessionId: string; title: string }>
  >([]);

  // Subscribe to store state
  const tabs = useSessionStore((s) => s.tabs);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeAgentId = useSessionStore((s) => s.activeAgentId);
  const workspaceRoot = useSessionStore((s) => s.workspaceRoot);
  const connectedAgents = useSessionStore((s) => s.connectedAgents);
  const agentInfoMap = useSessionStore((s) => s.agentInfoMap);
  const workspaceFolders = useSessionStore((s) => s.workspaceFolders);
  const sessionInfoMap = useSessionStore((s) => s.sessionInfoMap);
  const sessionCommands = useSessionStore((s) => s.sessionCommands);
  const statusline = useSessionStore((s) => s.statusline);
  const sessionOverviewVisible = useSessionStore((s) => s.sessionOverviewVisible);
  const sessionOverviewState = useSessionStore((s) => s.sessionOverviewState);
  const sessionOverviewPosition = useSessionStore((s) => s.sessionOverviewPosition);
  const sessionOverviewWidth = useSessionStore((s) => s.sessionOverviewWidth);

  // Message store
  const perSessionMessages = useMessageStore((s) => s.perSession);
  const streamingMap = useMessageStore((s) => s.streaming);

  const activeSessionKey =
    activeAgentId && activeSessionId
      ? sessionKey(activeAgentId, activeSessionId)
      : null;

  const availableCommands = activeSessionKey
    ? (sessionCommands[activeSessionKey] ?? [])
    : [];

  const activeMessages = activeSessionKey
    ? (perSessionMessages[activeSessionKey] ?? [])
    : [];
  const activeIsStreaming = activeSessionKey
    ? (streamingMap[activeSessionKey] ?? false)
    : false;

  // ------------------------------------------------------------------
  // Message handler — listens for messages from extension host
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data?.type) return;

      switch (data.type) {
        case "agentInfo":
          useSessionStore.getState().setAgentInfo(
            data.agentId as string,
            data.info as AgentInfo
          );
          return;

        case "statusline":
          useSessionStore.getState().setStatusline({
            hostname: data.hostname as string | undefined,
            repoName: data.repoName as string | undefined,
            branch: data.branch as string | undefined,
            tag: data.tag as string | undefined,
          });
          return;

        case "setTabs": {
          const store = useSessionStore.getState();
          store.setTabs(data.tabs as SessionTabState[]);
          if (data.workspaceRoot) store.setWorkspaceRoot(data.workspaceRoot as string);
          if (data.agents) store.setConnectedAgents(data.agents as ConnectedAgentInfo[]);
          if (data.workspaceFolders) store.setWorkspaceFolders(data.workspaceFolders as WorkspaceFolder[]);
          if (data.agentInfoMap) {
            const map = data.agentInfoMap as Record<string, AgentInfo>;
            for (const [agentId, info] of Object.entries(map)) {
              store.setAgentInfo(agentId, info);
            }
          }
          if (data.sessionInfoMap) {
            store.setSessionInfoMap(data.sessionInfoMap as Record<string, SessionInfoSnapshot>);
          }
          return;
        }

        case "addTab":
          useSessionStore.getState().addTab(data.tab as SessionTabState);
          return;

        case "updateTab":
          useSessionStore.getState().updateTab(
            data.sessionId as string,
            data.updates as Partial<SessionTabState>
          );
          return;

        case "setActiveSession":
          useSessionStore.getState().setActiveSession(
            data.sessionId as string,
            data.agentId as string
          );
          return;

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

        case "session/commands":
          useSessionStore.getState().setSessionCommands(
            data.agentId as string,
            data.sessionId as string,
            data.commands as SlashCommand[]
          );
          return;

        case "session/info": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          useSessionStore.getState().setSessionInfo(aId, sId, data as unknown as SessionInfoSnapshot);
          return;
        }

        case "session/message": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey =
            cur.activeAgentId && cur.activeSessionId
              ? sessionKey(cur.activeAgentId, cur.activeSessionId)
              : null;
          if (msgKey === curActiveKey) {
            useMessageStore.getState().appendMessage(msgKey, data.message as ChatMessage);
          } else {
            useSessionStore.getState().incrementUnread(sId, aId);
          }
          return;
        }

        case "session/stream": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey =
            cur.activeAgentId && cur.activeSessionId
              ? sessionKey(cur.activeAgentId, cur.activeSessionId)
              : null;
          if (msgKey === curActiveKey) {
            useMessageStore.getState().appendStreamChunk(
              msgKey, aId, sId, data.chunk as string
            );
          } else {
            useSessionStore.getState().incrementUnread(sId, aId);
          }
          return;
        }

        case "session/streamEnd": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey =
            cur.activeAgentId && cur.activeSessionId
              ? sessionKey(cur.activeAgentId, cur.activeSessionId)
              : null;
          if (msgKey === curActiveKey) {
            useMessageStore.getState().setStreaming(msgKey, false);
          }
          return;
        }

        case "session/switch": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const store = useSessionStore.getState();
          store.setActiveSession(sId, aId);
          useMessageStore.getState().setMessages(
            sessionKey(aId, sId),
            data.messages as ChatMessage[]
          );
          return;
        }

        case "session/turnActive": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey =
            cur.activeAgentId && cur.activeSessionId
              ? sessionKey(cur.activeAgentId, cur.activeSessionId)
              : null;
          if (msgKey === curActiveKey && !(data.active as boolean)) {
            useMessageStore.getState().setStreaming(msgKey, false);
          }
          return;
        }

        case "session/update":
          return;

        case "sessionOverview:state":
          useSessionStore.getState().setSessionOverviewState(
            data.payload as SessionOverviewState
          );
          return;

        case "sessionOverview:update": {
          const item = data.payload as import("../types").SessionOverviewItem;
          const current = stateRef.current.sessionOverviewState;
          const idx = current.sessions.findIndex(
            (s) => s.sessionId === item.sessionId && s.agentId === item.agentId
          );
          const sessions = [...current.sessions];
          if (idx >= 0) {
            sessions[idx] = item;
          } else {
            sessions.push(item);
          }
          useSessionStore.getState().setSessionOverviewState({
            ...current,
            sessions,
            lastUpdated: new Date().toISOString(),
            activeSessionId: stateRef.current.activeSessionId ?? current.activeSessionId,
            activeAgentId: stateRef.current.activeAgentId ?? current.activeAgentId,
          });
          return;
        }

        case "sessionOverview:toggle":
          useSessionStore.getState().setSessionOverviewVisible(
            data.payload.visible as boolean
          );
          return;

        case "sessionOverview:position":
          useSessionStore.getState().setSessionOverviewPosition(
            data.payload.position as "right" | "left"
          );
          return;

        // Legacy
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
    const store = useSessionStore.getState();
    store.setActiveSession(sessionId, agentId);
    store.updateTab(sessionId, { unreadCount: 0 });
    getVsCodeApi().postMessage({ type: "switchSession", sessionId, agentId });
  }, []);

  const newSession = useCallback((agentId: string) => {
    getVsCodeApi().postMessage({ type: "newSession", agentId });
  }, []);

  const newSessionWithPicker = useCallback(() => {
    getVsCodeApi().postMessage({ type: "openNewSessionPicker" });
  }, []);

  const closeSession = useCallback((sessionId: string) => {
    const store = useSessionStore.getState();
    const tab = store.tabs.find((t) => t.sessionId === sessionId);
    store.removeTab(sessionId);
    // Clean up persisted UI state for the closed session
    if (tab) {
      useSessionUiStateStore.getState().clear(sessionKey(tab.agentId, sessionId));
    }
    getVsCodeApi().postMessage({ type: "closeSession", sessionId });
  }, []);

  const forkSession = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({ type: "forkSession", sessionId });
  }, []);

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
      const cur = stateRef.current;
      const key =
        cur.activeAgentId && cur.activeSessionId
          ? sessionKey(cur.activeAgentId, cur.activeSessionId)
          : null;
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
        const cur = stateRef.current;
        const key =
          cur.activeAgentId && cur.activeSessionId
            ? sessionKey(cur.activeAgentId, cur.activeSessionId)
            : null;
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

  const fetchSymbols = useCallback(
    (query: string): Promise<SuggestionItem[]> => {
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
    },
    []
  );

  const resolveSymbol = useCallback(
    (name: string): Promise<ContextAttachment> => {
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
    },
    []
  );

  const dismissCompletedNotification = useCallback(() => {
    setCompletedNotifications((prev) => prev.slice(1));
  }, []);

  const toggleSessionOverview = useCallback(() => {
    const cur = useSessionStore.getState();
    cur.setSessionOverviewVisible(!cur.sessionOverviewVisible);
  }, []);

  const setSessionOverviewFilter = useCallback((filter: SessionOverviewFilter) => {
    useSessionStore.getState().setSessionOverviewFilter(filter);
  }, []);

  const toggleSessionOverviewSelection = useCallback((sessionId: string) => {
    useSessionStore.getState().toggleSessionOverviewSelected(sessionId);
  }, []);

  const setSessionOverviewSelection = useCallback((sessionIds: string[]) => {
    useSessionStore.getState().setSessionOverviewSelected(sessionIds);
  }, []);

  // Dispatch proxy for backward compat
  const dispatch = useCallback((action: SessionAction) => {
    const store = useSessionStore.getState();
    const msgStore = useMessageStore.getState();
    switch (action.type) {
      case "SET_TABS": store.setTabs(action.tabs); break;
      case "ADD_TAB": store.addTab(action.tab); break;
      case "REMOVE_TAB": store.removeTab(action.sessionId); break;
      case "UPDATE_TAB": store.updateTab(action.sessionId, action.updates); break;
      case "SET_ACTIVE_SESSION": store.setActiveSession(action.sessionId, action.agentId); break;
      case "REORDER_TABS": store.reorderTabs(action.tabs); break;
      case "INCREMENT_UNREAD": store.incrementUnread(action.sessionId, action.agentId); break;
      case "SET_WORKSPACE_ROOT": store.setWorkspaceRoot(action.root); break;
      case "SET_AGENT_INFO": store.setAgentInfo(action.agentId, action.info); break;
      case "SET_CONNECTED_AGENTS": store.setConnectedAgents(action.agents); break;
      case "SET_WORKSPACE_FOLDERS": store.setWorkspaceFolders(action.folders); break;
      case "SET_SESSION_COMMANDS": store.setSessionCommands(action.agentId, action.sessionId, action.commands); break;
      case "SET_STATUSLINE": store.setStatusline(action.statusline); break;
      case "SET_SESSION_INFO_MAP": store.setSessionInfoMap(action.map); break;
      case "SET_SESSION_INFO": store.setSessionInfo(action.agentId, action.sessionId, action.info); break;
      case "SESSION_MESSAGE": {
        const key = sessionKey(action.agentId, action.sessionId);
        msgStore.appendMessage(key, action.message);
        break;
      }
      case "SESSION_STREAM": {
        const key = sessionKey(action.agentId, action.sessionId);
        msgStore.appendStreamChunk(key, action.agentId, action.sessionId, action.chunk);
        break;
      }
      case "SESSION_STREAM_END": {
        const key = sessionKey(action.agentId, action.sessionId);
        msgStore.setStreaming(key, false);
        break;
      }
      case "SESSION_SWITCH": {
        const key = sessionKey(action.agentId, action.sessionId);
        msgStore.setMessages(key, action.messages);
        break;
      }
      case "SESSION_TURN_ACTIVE": {
        if (!action.active) {
          const key = sessionKey(action.agentId, action.sessionId);
          msgStore.setStreaming(key, false);
        }
        break;
      }
      case "SET_SESSION_OVERVIEW_VISIBLE": store.setSessionOverviewVisible(action.visible); break;
      case "SET_SESSION_OVERVIEW_STATE": store.setSessionOverviewState(action.state); break;
      case "SET_SESSION_OVERVIEW_POSITION": store.setSessionOverviewPosition(action.position); break;
      case "SET_SESSION_OVERVIEW_FILTER": store.setSessionOverviewFilter(action.filter); break;
      case "SET_SESSION_OVERVIEW_EXPANDED": store.setSessionOverviewExpanded(action.sessions); break;
      case "SET_SESSION_OVERVIEW_WIDTH": store.setSessionOverviewWidth(action.width); break;
      case "SET_SESSION_OVERVIEW_SELECTED": store.setSessionOverviewSelected(action.sessionIds); break;
      case "TOGGLE_SESSION_OVERVIEW_SELECTED": store.toggleSessionOverviewSelected(action.sessionId); break;
      case "SET_SESSION_OVERVIEW_SELECTION_MODE": store.setSessionOverviewSelectionMode(action.enabled); break;
      case "TOGGLE_SESSION_OVERVIEW_SELECTION": store.toggleSessionOverviewSelection(action.sessionId); break;
    }
  }, []);

  const contextValue = React.useMemo(
    () => ({
      tabs,
      activeSessionId,
      activeAgentId,
      activeSessionKey,
      connectedAgents,
      agentInfoMap,
      workspaceFolders,
      workspaceRoot,
      sessionInfoMap,
      messages: activeMessages,
      isStreaming: activeIsStreaming,
      completedNotifications,
      availableCommands,
      statusline,
      sessionOverviewVisible,
      sessionOverviewState,
      sessionOverviewPosition,
      sessionOverviewWidth,
      toggleSessionOverview,
      setSessionOverviewFilter,
      toggleSessionOverviewSelection,
      setSessionOverviewSelection,
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
    }),
    [
      tabs, activeSessionId, activeAgentId, activeSessionKey,
      connectedAgents, agentInfoMap, workspaceFolders, workspaceRoot,
      sessionInfoMap, completedNotifications, availableCommands, statusline,
      activeMessages, activeIsStreaming,
      sessionOverviewVisible, sessionOverviewState,
      sessionOverviewPosition, sessionOverviewWidth,
      toggleSessionOverview, setSessionOverviewFilter,
      toggleSessionOverviewSelection, setSessionOverviewSelection,
      sendMessage, cancelTurn, switchTab, newSession, newSessionWithPicker,
      closeSession, forkSession, fetchFiles, resolveFile, resolveSelection,
      resolveDiff, fetchSymbols, resolveSymbol, dismissCompletedNotification,
      dispatch,
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
