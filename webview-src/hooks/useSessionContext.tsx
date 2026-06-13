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
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
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

/**
 * Per-tab UI state. Status, tokenUsage, model, mode, etc. are all
 * derived from `sessionInfoMap` — do NOT duplicate them here.
 */
export interface SessionTabState {
  sessionId: string;
  agentId: string;
  title: string;
  agentIcon?: string;
}

// ============================================================================
// Session key helper
// ============================================================================

function sessionKey(agentId: string, sessionId: string): string {
  return sessionKeyOf(agentId, sessionId);
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
  closeSession: (agentId: string, sessionId: string) => void;
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
  // setSessionOverviewState — removed, no longer needed
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
  | { type: "UPDATE_TAB"; sessionId: string; updates: Partial<SessionTabState> }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string; agentId: string }
  | { type: "REORDER_TABS"; tabs: SessionTabState[] }
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

  // Force re-render counter. We use a manual subscription instead of
  // useSessionStore(selector) because every store write creates new
  // object/array references via spread, and Zustand's useSyncExternalStore
  // uses Object.is for snapshot comparison — causing infinite re-renders.
  const [, setRenderTick] = React.useState(0);
  const storeRef = useRef(useSessionStore.getState());
  const msgStoreRef = useRef(useMessageStore.getState());

  useEffect(() => {
    const unsubSession = useSessionStore.subscribe(() => {
      storeRef.current = useSessionStore.getState();
      setRenderTick((n) => n + 1);
    });
    const unsubMessage = useMessageStore.subscribe(() => {
      msgStoreRef.current = useMessageStore.getState();
      setRenderTick((n) => n + 1);
    });
    return () => { unsubSession(); unsubMessage(); };
  }, []);

  const storeState = storeRef.current;
  const sessionInfoMap = storeState.sessionInfoMap;
  const tabOrder = storeState.tabOrder;
  const activeSessionKey = storeState.activeSessionKey;
  const workspaceRoot = storeState.workspaceRoot;
  const connectedAgents = storeState.connectedAgents;
  const agentInfoMap = storeState.agentInfoMap;
  const workspaceFolders = storeState.workspaceFolders;
  const sessionCommands = storeState.sessionCommands;
  const statusline = storeState.statusline;
  const sessionOverviewVisible = storeState.sessionOverviewVisible;
  const sessionOverviewState = storeState.sessionOverviewState;
  const sessionOverviewPosition = storeState.sessionOverviewPosition;
  const sessionOverviewWidth = storeState.sessionOverviewWidth;

  // Derived: tabs from store getter
  const tabs = storeState.getTabs();

  // Derived: activeSessionId / activeAgentId from activeSessionKey
  const activeSessionId = activeSessionKey ? activeSessionKey.split(":")[1] : null;
  const activeAgentId = activeSessionKey ? activeSessionKey.split(":")[0] : null;

  // Message store
  const msgState = msgStoreRef.current;
  const perSessionMessages = msgState.perSession;
  const streamingMap = msgState.streaming;

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
          const tabs = data.tabs as SessionTabState[];
          // Rebuild tabOrder and tabTitles from incoming tabs
          const order: string[] = [];
          const titles: Record<string, string> = {};
          for (const t of tabs) {
            const key = sessionKeyOf(t.agentId, t.sessionId);
            order.push(key);
            titles[key] = t.title;
          }
          store.setTabOrder(order);
          for (const [k, v] of Object.entries(titles)) {
            store.setTabTitle(k, v);
          }
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

        case "addTab": {
          const t = data.tab as SessionTabState;
          useSessionStore.getState().addTab(t.agentId, t.sessionId, t.title);
          return;
        }

        case "updateTab": {
          const sessionId = data.sessionId as string;
          const agentId = stateRef.current.activeSessionKey?.split(":")[0] ?? "";
          const key = sessionKeyOf(agentId, sessionId);
          const updates = data.updates as Partial<SessionTabState>;
          if (updates.title) {
            useSessionStore.getState().setTabTitle(key, updates.title);
          }
          return;
        }

        case "setActiveSession": {
          const sId = data.sessionId as string;
          const aId = data.agentId as string;
          useSessionStore.getState().setActiveSession(sessionKeyOf(aId, sId));
          return;
        }

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
          useMessageStore.getState().appendMessage(msgKey, data.message as ChatMessage);
          return;
        }

        case "session/stream": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          useMessageStore.getState().appendStreamChunk(
            msgKey, aId, sId, data.chunk as string
          );
          return;
        }

        case "session/streamEnd": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          useMessageStore.getState().setStreaming(msgKey, false);
          // Sync sessionInfoMap status so Overview/Tab indicators
          // return to idle immediately when the stream ends,
          // without waiting for the delayed session/turnActive(false).
          const cur = stateRef.current;
          const existing = cur.sessionInfoMap[msgKey];
          if (existing && existing.status === "running") {
            useSessionStore.getState().setSessionInfo(aId, sId, {
              ...existing,
              status: "idle",
              isTurnActive: false,
              isStreaming: false,
              updatedAt: new Date().toISOString(),
            });
          }
          return;
        }

        case "session/switch": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const store = useSessionStore.getState();
          const key = sessionKeyOf(aId, sId);
          // Set active session and messages atomically so the UI never
          // renders an empty ChatContainer between the two state updates.
          store.setActiveSession(key);
          useMessageStore.getState().setMessages(
            key,
            data.messages as ChatMessage[]
          );
          // Mark all messages as seen so unread badge clears on switch
          const newestId =
            data.messages && (data.messages as ChatMessage[]).length > 0
              ? (data.messages as ChatMessage[])[(data.messages as ChatMessage[]).length - 1].id
              : null;
          if (newestId) {
            useSessionUiStateStore.getState().save(key, { lastSeenMessageId: newestId });
          }
          // Update sessionInfoMap so Overview badges (context %, tokens, etc.)
          // are immediately available after session switch.
          store.setSessionInfo(aId, sId, {
            sessionId: sId,
            agentId: aId,
            status: (data.isTurnActive ? "running" : "idle") as import("../store/sessionStore").SessionInfoSnapshot["status"],
            isTurnActive: data.isTurnActive as boolean,
            isStreaming: data.isStreaming as boolean,
            tokenUsage: data.tokenUsage as { inputTokens: number; outputTokens: number; totalTokens: number },
            contextWindowMax: data.contextWindowMax as number | undefined,
            model: data.model as string | undefined,
            mode: data.mode as string | undefined,
            cwd: data.cwd as string | undefined,
            messageCount: (data.messages as ChatMessage[])?.length ?? 0,
            createdAt: data.createdAt as string,
            updatedAt: data.updatedAt as string,
          });
          return;
        }

        case "session/turnActive": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const msgKey = sessionKey(aId, sId);
          const cur = stateRef.current;
          const curActiveKey = cur.activeSessionKey;
          const active = data.active as boolean;
          // Sync streamingMap so Composer button reflects turn state
          // immediately, without waiting for session/stream chunks.
          if (msgKey === curActiveKey) {
            useMessageStore.getState().setStreaming(msgKey, active);
          }
          // Update session status in sessionInfoMap so Overview badges reflect turn state
          const existing = cur.sessionInfoMap[msgKey];
          if (existing) {
            useSessionStore.getState().setSessionInfo(aId, sId, {
              ...existing,
              isTurnActive: active,
              isStreaming: active,
              status: (active ? "running" : "idle") as import("../store/sessionStore").SessionInfoSnapshot["status"],
              updatedAt: new Date().toISOString(),
            });
          }
          return;
        }

        case "session/usage": {
          const aId = data.agentId as string;
          const sId = data.sessionId as string;
          const cur = stateRef.current;
          const key = sessionKey(aId, sId);
          const existing = cur.sessionInfoMap[key];
          if (existing) {
            useSessionStore.getState().setSessionInfo(aId, sId, {
              ...existing,
              tokenUsage: data.tokenUsage as { inputTokens: number; outputTokens: number; totalTokens: number },
              contextWindowMax: (data.contextWindowMax as number | undefined) ?? existing.contextWindowMax,
              updatedAt: new Date().toISOString(),
            });
          }
          return;
        }

        case "session/update":
          return;

        // Legacy — sessions are now derived from sessionInfoMap
        case "sessionOverview:state":
        case "sessionOverview:update":
          return;

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
    const key = sessionKeyOf(agentId, sessionId);
    // Do NOT set active session here — wait for session/switch response from
    // extension host so messages are available before the UI switches.
    // The session/switch handler below calls store.setActiveSession(key).
    getVsCodeApi().postMessage({ type: "switchSession", sessionId, agentId });
  }, []);

  const newSession = useCallback((agentId: string) => {
    getVsCodeApi().postMessage({ type: "newSession", agentId });
  }, []);

  const newSessionWithPicker = useCallback(() => {
    getVsCodeApi().postMessage({ type: "openNewSessionPicker" });
  }, []);

  const closeSession = useCallback((agentId: string, sessionId: string) => {
    const store = useSessionStore.getState();
    const key = sessionKeyOf(agentId, sessionId);
    store.removeTab(key);
    useSessionUiStateStore.getState().clear(key);
    getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
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
      const key = cur.activeSessionKey;
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
        const key = cur.activeSessionKey;
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
      case "SET_TABS": {
        const tabs = action.tabs;
        const order: string[] = [];
        const titles: Record<string, string> = {};
        for (const t of tabs) {
          const key = sessionKeyOf(t.agentId, t.sessionId);
          order.push(key);
          titles[key] = t.title;
        }
        store.setTabOrder(order);
        for (const [k, v] of Object.entries(titles)) {
          store.setTabTitle(k, v);
        }
        break;
      }
      case "ADD_TAB":
        store.addTab(action.tab.agentId, action.tab.sessionId, action.tab.title);
        break;
      case "REMOVE_TAB": {
        const key = store.activeSessionKey;
        if (key) store.removeTab(key);
        break;
      }
      case "UPDATE_TAB": {
        const key = store.activeSessionKey;
        if (key && action.updates.title) {
          store.setTabTitle(key, action.updates.title);
        }
        break;
      }
      case "SET_ACTIVE_SESSION":
        store.setActiveSession(sessionKeyOf(action.agentId, action.sessionId));
        break;
      case "REORDER_TABS": {
        const order = action.tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId));
        store.setTabOrder(order);
        break;
      }
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
