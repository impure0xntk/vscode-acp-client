import { useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { useUiStateStore } from "../../../store/uiStateStore";
import { getLogger } from "../../../lib/logger";
import { getVsCodeApi } from "../../../lib/vscodeApi";

const log = getLogger("handlers.session.stateSync");

/**
 * State synchronization message types for keeping webview stores in sync
 * across multiple panels (UnifiedChat, MiniChat, etc.)
 */

export interface StateSyncRequest {
  type: "state/syncRequest";
  /** Specific keys to sync, or undefined for full sync */
  keys?: string[];
}

export interface StateSyncResponse {
  type: "state/syncResponse";
  /** Session store state */
  sessionStore: {
    tabOrder: ReturnType<typeof useSessionStore.getState>["tabOrder"];
    activeSessionKey: ReturnType<typeof useSessionStore.getState>["activeSessionKey"];
    sessionInfoMap: ReturnType<typeof useSessionStore.getState>["sessionInfoMap"];
    workspaceRoot: ReturnType<typeof useSessionStore.getState>["workspaceRoot"];
    connectedAgents: ReturnType<typeof useSessionStore.getState>["connectedAgents"];
    workspaceFolders: ReturnType<typeof useSessionStore.getState>["workspaceFolders"];
    agentInfoMap: ReturnType<typeof useSessionStore.getState>["agentInfoMap"];
    completionNotification: ReturnType<typeof useSessionStore.getState>["completionNotification"];
  };
  /** Message store state (per-session messages) */
  messageStore: {
    perSession: ReturnType<typeof useMessageStore.getState>["perSession"];
    streaming: ReturnType<typeof useMessageStore.getState>["streaming"];
    promptQueue: ReturnType<typeof useMessageStore.getState>["promptQueue"];
    lastSessionUpdateType: ReturnType<typeof useMessageStore.getState>["lastSessionUpdateType"];
  };
  /** UI state store */
  uiStateStore: ReturnType<typeof useUiStateStore.getState>;
}

export interface StateUpdate {
  type: "state/update";
  /** Which store was updated */
  store: "session" | "message" | "ui";
  /** The update payload - partial state */
  payload: unknown;
  /** Source panel ID (to avoid echo) */
  sourcePanelId?: string;
}

export interface StateMutate {
  type: "state/mutate";
  /** Which store to mutate */
  store: "session" | "message" | "ui";
  /** Action name in the store */
  action: string;
  /** Action arguments */
  args: unknown[];
  /** Source panel ID */
  sourcePanelId?: string;
}

/**
 * Handle incoming state sync request from a webview
 * Extension host should respond with StateSyncResponse
 */
export function handleStateSyncRequest(data: StateSyncRequest): void {
  log.debug("handleStateSyncRequest received", { keys: data.keys });

  // Webviews don't handle this - it's handled by the extension host
  // This is here for type completeness
}

/**
 * Handle incoming state sync response from extension host
 * Apply the full state to local stores using proper Zustand setState().
 */
export function handleStateSyncResponse(data: StateSyncResponse): void {
  log.info("handleStateSyncResponse received", {
    sessionTabs: data.sessionStore.tabOrder.length,
    messageSessions: Object.keys(data.messageStore.perSession).length,
    activeSession: data.sessionStore.activeSessionKey,
  });

  // Apply session store state using setState() to trigger React re-renders
  useSessionStore.setState({
    tabOrder: data.sessionStore.tabOrder,
    activeSessionKey: data.sessionStore.activeSessionKey,
    sessionInfoMap: data.sessionStore.sessionInfoMap as Record<string, import("../../../store/sessionStore").SessionInfoDTO>,
    workspaceRoot: data.sessionStore.workspaceRoot,
    connectedAgents: data.sessionStore.connectedAgents as import("../../../store/sessionStore").ConnectedAgentInfo[],
    workspaceFolders: data.sessionStore.workspaceFolders as import("../../../store/sessionStore").WorkspaceFolder[],
    agentInfoMap: data.sessionStore.agentInfoMap as Record<string, import("../../../store/sessionStore").AgentInfo>,
    completionNotification: data.sessionStore.completionNotification as import("../../../store/sessionStore").SessionStoreState["completionNotification"],
  } as Partial<import("../../../store/sessionStore").SessionStoreState>);

  // Apply message store state using setState()
  useMessageStore.setState({
    perSession: data.messageStore.perSession,
    streaming: data.messageStore.streaming,
    promptQueue: data.messageStore.promptQueue,
    lastSessionUpdateType: data.messageStore.lastSessionUpdateType,
  } as Partial<import("../../../store/messageStore").MessageState>);

  // Apply UI state store using setState()
  useUiStateStore.setState(data.uiStateStore as Partial<import("../../../store/uiStateStore").UiStateStore>);
}

/**
 * Handle incremental state update from extension host
 * Apply partial update to local store using proper Zustand setState().
 */
export function handleStateUpdate(data: StateUpdate): void {
  log.debug("handleStateUpdate received", { store: data.store });

  switch (data.store) {
    case "session": {
      useSessionStore.setState(data.payload as Partial<import("../../../store/sessionStore").SessionStoreState>);
      break;
    }
    case "message": {
      useMessageStore.setState(data.payload as Partial<import("../../../store/messageStore").MessageState>);
      break;
    }
    case "ui": {
      useUiStateStore.setState(data.payload as Partial<import("../../../store/uiStateStore").UiStateStore>);
      break;
    }
  }
}

/**
 * Handle state mutate request from another webview
 * Apply the mutation locally (extension host already applied it).
 * Uses Zustand getState() to call store actions, then setState() to
 * ensure React reactivity.
 */
export function handleStateMutate(data: StateMutate): void {
  log.debug("handleStateMutate received", { store: data.store, action: data.action });

  switch (data.store) {
    case "session": {
      const store = useSessionStore.getState();
      const actionFn = (store as unknown as Record<string, unknown>)[data.action] as
        | ((...args: unknown[]) => void)
        | undefined;
      if (actionFn) {
        actionFn(...data.args);
      } else {
        log.warn("Unknown session store action", { action: data.action });
      }
      break;
    }
    case "message": {
      const store = useMessageStore.getState();
      const actionFn = (store as unknown as Record<string, unknown>)[data.action] as
        | ((...args: unknown[]) => void)
        | undefined;
      if (actionFn) {
        actionFn(...data.args);
      } else {
        log.warn("Unknown message store action", { action: data.action });
      }
      break;
    }
    case "ui": {
      const store = useUiStateStore.getState();
      const actionFn = (store as unknown as Record<string, unknown>)[data.action] as
        | ((...args: unknown[]) => void)
        | undefined;
      if (actionFn) {
        actionFn(...data.args);
      } else {
        log.warn("Unknown ui store action", { action: data.action });
      }
      break;
    }
  }
}

/**
 * Request full state sync from extension host
 */
export function requestStateSync(panelId?: string, keys?: string[]): void {
  const vscode = getVsCodeApi();
  vscode.postMessage({
    type: "state/syncRequest",
    panelId,
    keys,
  } as StateSyncRequest & { panelId?: string });
}

/**
 * Send state mutation to extension host for broadcast
 */
export function sendStateMutation(
  store: "session" | "message" | "ui",
  action: string,
  args: unknown[],
  panelId?: string
): void {
  const vscode = getVsCodeApi();
  vscode.postMessage({
    type: "state/mutate",
    store,
    action,
    args,
    sourcePanelId: panelId,
  } as StateMutate & { panelId?: string });
}