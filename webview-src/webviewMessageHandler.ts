import { sessionKeyOf, useSessionStore } from "./store/sessionStore";
import { useMessageStore } from "./store/messageStore";
import { useUiStateStore } from "./store/uiStateStore";
import { useMeshStore } from "./store/meshStore";
import { getVsCodeApi } from "./lib/vscodeApi";
import { getLogger } from "./lib/logger";
import { syncMessageCount } from "./store/sync";

const log = getLogger("webview.messageHandler");
import type {
  SessionTabState,
  SessionInfoSnapshot,
  ConnectedAgentInfo,
  AgentInfo,
  WorkspaceFolder,
  SlashCommand,
  SessionTabStatus,
} from "./store/sessionStore";
import type {
  QueuedPrompt,
  ChatMessage,
  TokenUsage,
  SessionOverviewState,
} from "./types";

// ── Message handler types ───────────────────────────────────────────────────

interface SetTabsMessage {
  type: "setTabs";
  tabs: SessionTabState[];
  workspaceRoot?: string;
  agents?: ConnectedAgentInfo[];
  workspaceFolders?: WorkspaceFolder[];
  agentInfoMap?: Record<string, AgentInfo>;
  sessionInfoMap?: Record<string, SessionInfoSnapshot>;
}

interface SessionMessage {
  type: "session/message";
  agentId: string;
  sessionId: string;
  message: ChatMessage;
}

interface SessionStream {
  type: "session/stream";
  agentId: string;
  sessionId: string;
  chunk: string;
}

interface SessionStreamEnd {
  type: "session/streamEnd";
  agentId: string;
  sessionId: string;
}

interface SessionSwitch {
  type: "session/switch";
  agentId: string;
  sessionId: string;
  tokenUsage?: TokenUsage;
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  createdAt?: string;
  isTurnActive?: boolean;
  isStreaming?: boolean;
}

interface SessionTurnActive {
  type: "session/turnActive";
  agentId: string;
  sessionId: string;
  active: boolean;
  action?: string;
}

interface SessionUsage {
  type: "session/usage";
  agentId: string;
  sessionId: string;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
}

interface SessionCompression {
  type: "session/compression";
  agentId: string;
  sessionId: string;
  contextWindowMax: number;
  usedTokens: number;
  usedBefore?: number;
}

interface SessionCompleted {
  type: "session/completed";
  agentId: string;
  sessionId: string;
  title: string;
}

interface SessionInfo {
  type: "session/info";
  agentId: string;
  sessionId: string;
  [key: string]: unknown;
}

interface AgentInfoMessage {
  type: "agentInfo";
  agentId: string;
  info: AgentInfo;
}

interface StatuslineMessage {
  type: "statusline";
  hostname?: string;
  repoName?: string;
  branch?: string;
  tag?: string;
}

interface AddTabMessage {
  type: "addTab";
  tab: SessionTabState;
}

interface UpdateTabMessage {
  type: "updateTab";
  sessionId: string;
  updates: Partial<SessionTabState>;
}

interface SetActiveSessionMessage {
  type: "setActiveSession";
  sessionId: string;
  agentId: string;
}

interface SessionCommandsMessage {
  type: "session/commands";
  agentId: string;
  sessionId: string;
  commands: SlashCommand[];
}

interface QueueAddedMessage {
  type: "queue:added";
  agentId: string;
  sessionId: string;
  entry: QueuedPrompt;
}

interface QueueUpdatedMessage {
  type: "queue:updated";
  agentId: string;
  sessionId: string;
  queue: QueuedPrompt[];
}

interface SessionOverviewToggleMessage {
  type: "sessionOverview:toggle";
  payload: { visible: boolean };
}

interface SessionOverviewPositionMessage {
  type: "sessionOverview:position";
  payload: { position: "right" | "left" };
}

interface SessionOverviewStateMessage {
  type: "sessionOverview:state";
  payload: SessionOverviewState;
}

// ── Mesh Orchestrator messages ──────────────────────────────────────────────

interface MeshStatusMessage {
  type: "mesh:status";
  agents: import("./types").MeshAgentStatus[];
}

interface MeshTaskBoardMessage {
  type: "mesh:taskBoard";
  tasks: import("./types").MeshTaskEntry[];
}

interface MeshMessageMessage {
  type: "mesh:message";
  message: import("./types").MeshRecentMessage;
}

interface MeshAgentConnectedMessage {
  type: "mesh:agentConnected";
  agentId: string;
}

interface MeshAgentDisconnectedMessage {
  type: "mesh:agentDisconnected";
  agentId: string;
}

interface MeshPanelToggleMessage {
  type: "mesh:togglePanel";
  visible: boolean;
}

type WebviewMessage =
  | SetTabsMessage
  | SessionMessage
  | SessionStream
  | SessionStreamEnd
  | SessionSwitch
  | SessionTurnActive
  | SessionUsage
  | SessionCompression
  | SessionCompleted
  | SessionInfo
  | AgentInfoMessage
  | StatuslineMessage
  | AddTabMessage
  | UpdateTabMessage
  | SetActiveSessionMessage
  | SessionCommandsMessage
  | QueueAddedMessage
  | QueueUpdatedMessage
  | SessionOverviewToggleMessage
  | SessionOverviewPositionMessage
  | SessionOverviewStateMessage
  | MeshStatusMessage
  | MeshTaskBoardMessage
  | MeshMessageMessage
  | MeshAgentConnectedMessage
  | MeshAgentDisconnectedMessage
  | MeshPanelToggleMessage;

// ── Handler functions ───────────────────────────────────────────────────────

function handleSetTabs(data: SetTabsMessage): void {
  log.info("handleSetTabs", {
    tabCount: data.tabs.length,
    tabs: data.tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId)),
    hasWorkspaceRoot: !!data.workspaceRoot,
    hasAgentInfo: !!data.agentInfoMap ? Object.keys(data.agentInfoMap).length : 0,
  });
  useSessionStore.getState().bulkSetTabs({
    tabs: data.tabs,
    workspaceRoot: data.workspaceRoot,
    connectedAgents: data.agents,
    workspaceFolders: data.workspaceFolders,
    agentInfoMap: data.agentInfoMap,
    sessionInfoMap: data.sessionInfoMap,
  });

  // Set activeSessionKey if not already set or if the current key is no
  // longer in the tab list.  Without this, a race between setTabs and
  // session/switch messages leaves activeSessionKey null, causing the
  // first user message to be silently dropped (no resolved targets).
  const store = useSessionStore.getState();
  const currentKey = store.activeSessionKey;
  const newKeys = data.tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId));
  if (!currentKey || !newKeys.includes(currentKey)) {
    const fallback = newKeys[0] ?? null;
    log.info("handleSetTabs: setting activeSessionKey", { from: currentKey, to: fallback });
    store.setActiveSession(fallback);
  }
}

function handleSessionMessage(data: SessionMessage): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  useMessageStore.getState().appendMessage(msgKey, data.message);
  syncMessageCount(data.agentId, data.sessionId);
}

function handleSessionStream(data: SessionStream): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  useMessageStore.getState().appendStreamChunk(
    msgKey,
    data.agentId,
    data.sessionId,
    data.chunk,
  );
  // Update lastResponseAt so the session is considered "alive"
  const store = useSessionStore.getState();
  const existing = store.sessionInfoMap[msgKey];
  if (existing) {
    store.setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      lastResponseAt: new Date().toISOString(),
    });
  }
}

function handleSessionStreamEnd(data: SessionStreamEnd): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  useMessageStore.getState().setStreaming(msgKey, false);
  // Sync sessionInfoMap status so Overview/Tab indicators return to idle
  const existing = useSessionStore.getState().sessionInfoMap[msgKey];
  if (existing && existing.status === "running") {
    const msgsAfter = useMessageStore.getState().perSession[msgKey];
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: "idle",
      isTurnActive: false,
      isStreaming: false,
      messageCount: msgsAfter?.length ?? existing.messageCount,
      lastResponseAt: new Date().toISOString(),
    });
  }
}

function handleSessionSwitch(data: SessionSwitch): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const prevKey = useSessionStore.getState().activeSessionKey;
  log.info("handleSessionSwitch", {
    from: prevKey,
    to: key,
    hasTokenUsage: !!data.tokenUsage,
    model: data.model,
  });

  const sessionStore = useSessionStore.getState();

  // Ensure the tab exists in tabOrder — if the extension activates a
  // session before bulkSetTabs delivers the full tab list (race between
  // session/switch and setTabs messages), addTab creates the tab so the
  // UI can render it. Without this, activeSessionKey is set but no tab
  // exists, resulting in a blank panel with no messages.
  if (!sessionStore.tabOrder.includes(key)) {
    sessionStore.addTab(data.agentId, data.sessionId, data.sessionId.slice(0, 8));
  }

  // Single atomic update: build new sessionInfo.
  const msgStore = useMessageStore.getState();
  const cachedMsgs = msgStore.perSession[key] ?? [];
  const existing = sessionStore.sessionInfoMap[key];

  const newInfo: SessionInfoSnapshot = {
    sessionId: data.sessionId,
    agentId: data.agentId,
    status: "idle",
    isTurnActive: data.isTurnActive ?? false,
    isStreaming: data.isStreaming ?? false,
    tokenUsage: data.tokenUsage,
    contextWindowMax: data.contextWindowMax,
    model: data.model,
    mode: data.mode,
    cwd: data.cwd,
    messageCount: cachedMsgs.length,
    createdAt: data.createdAt,
    lastResponseAt: existing?.lastResponseAt ?? null,
  };

  sessionStore.setActiveSession(key);
  sessionStore.setSessionInfo(data.agentId, data.sessionId, newInfo);
}

function handleSessionTurnActive(data: SessionTurnActive): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const active = data.active;
  log.debug("handleSessionTurnActive", { agentId: data.agentId, sessionId: data.sessionId, active, action: data.action });

  // Sync streamingMap so Composer button reflects turn state
  useMessageStore.getState().setStreaming(msgKey, active);

  // Update session status in sessionInfoMap
  const existing = useSessionStore.getState().sessionInfoMap[msgKey];
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      isTurnActive: active,
      isStreaming: active,
      status: active ? "running" : "idle",
    });
  }
}

function handleSessionUsage(data: SessionUsage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const existing = useSessionStore.getState().sessionInfoMap[key];
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      tokenUsage: data.tokenUsage,
      contextWindowMax: data.contextWindowMax ?? existing.contextWindowMax,
    });
  }
}

function handleSessionCompression(data: SessionCompression): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const compressionMsg: ChatMessage = {
    id: `compression-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "system",
    content: "",
    timestamp: Date.now(),
    agentId: data.agentId,
    sessionId: data.sessionId,
    compressionInfo: {
      contextWindowMax: data.contextWindowMax,
      usedTokens: data.usedTokens,
      usedBefore: data.usedBefore,
    },
  };
  useMessageStore.getState().appendMessage(msgKey, compressionMsg);
}

function handleSessionCompleted(data: SessionCompleted): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const existing = useSessionStore.getState().sessionInfoMap[key];
  log.info("handleSessionCompleted", { agentId: data.agentId, sessionId: data.sessionId, title: data.title });
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: "completed",
      isTurnActive: false,
      isStreaming: false,
      lastResponseAt: new Date().toISOString(),
    });
  }
}

function handleSessionInfo(data: SessionInfo): void {
  const aId = data.agentId;
  const sId = data.sessionId;
  const existing = useSessionStore.getState().sessionInfoMap[sessionKeyOf(aId, sId)];
  const snapshot = data as unknown as SessionInfoSnapshot;

  // Preserve existing messageCount if not incoming
  if (existing && snapshot.messageCount === undefined) {
    snapshot.messageCount = existing.messageCount;
  }

  // Always sync from message store
  const msgStore = useMessageStore.getState();
  const msgs = msgStore.perSession[sessionKeyOf(aId, sId)];
  if (msgs && msgs.length > 0) {
    snapshot.messageCount = msgs.length;
  }

  useSessionStore.getState().setSessionInfo(aId, sId, snapshot);
}

function handleAgentInfo(data: AgentInfoMessage): void {
  useSessionStore.getState().setAgentInfo(data.agentId, data.info);
}

function handleStatusline(data: StatuslineMessage): void {
  useSessionStore.getState().setStatusline({
    hostname: data.hostname,
    repoName: data.repoName,
    branch: data.branch,
    tag: data.tag,
  });
}

function handleAddTab(data: AddTabMessage): void {
  useSessionStore.getState().addTab(data.tab.agentId, data.tab.sessionId, data.tab.title);
}

function handleUpdateTab(data: UpdateTabMessage): void {
  const store = useSessionStore.getState();
  const key = store.activeSessionKey;
  if (key && data.updates.title) {
    store.setTabTitle(key, data.updates.title);
  }
}

function handleSetActiveSession(data: SetActiveSessionMessage): void {
  useSessionStore.getState().setActiveSession(sessionKeyOf(data.agentId, data.sessionId));
}

function handleSessionCommands(data: SessionCommandsMessage): void {
  useSessionStore.getState().setSessionCommands(data.agentId, data.sessionId, data.commands);
}

function handleQueueAdded(data: QueueAddedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore.getState().addQueuedPrompt(key, data.entry);
}

function handleQueueUpdated(data: QueueUpdatedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore.getState().setPromptQueue(key, data.queue);
}

function handleSessionOverviewState(data: SessionOverviewStateMessage): void {
  useUiStateStore.getState().setOverviewState(data.payload);
}

function handleSessionOverviewToggle(data: SessionOverviewToggleMessage): void {
  useUiStateStore.getState().setOverviewVisible(data.payload.visible);
}

function handleSessionOverviewPosition(data: SessionOverviewPositionMessage): void {
  useUiStateStore.getState().setOverviewPosition(data.payload.position);
}

// ── Mesh Orchestrator handlers ──────────────────────────────────────────────

function handleMeshStatus(data: MeshStatusMessage): void {
  useMeshStore.getState().setAgentStatuses(data.agents);
}

function handleMeshTaskBoard(data: MeshTaskBoardMessage): void {
  useMeshStore.getState().setTasks(data.tasks);
}

function handleMeshMessage(data: MeshMessageMessage): void {
  useMeshStore.getState().addRecentMessage(data.message);
}

function handleMeshAgentConnected(data: MeshAgentConnectedMessage): void {
  // Refresh agent statuses — the extension host will send a full mesh:status update
  // This notification is used to trigger a status refresh if needed
  getLogger("mesh").info("agent connected", { agentId: data.agentId });
}

function handleMeshAgentDisconnected(data: MeshAgentDisconnectedMessage): void {
  useMeshStore.getState().updateAgentStatus(data.agentId, {
    state: "disconnected",
  } as Partial<import("./types").MeshAgentStatus>);
}

function handleMeshPanelToggle(data: MeshPanelToggleMessage): void {
  useMeshStore.getState().setMeshPanelVisible(data.visible);
}

// ── Setup function ──────────────────────────────────────────────────────────

/**
 * Configures the webview message handler.
 * Distributes messages from the extended host to each store.
 */
export function setupMessageHandlers(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as WebviewMessage;
    if (!data?.type) return;

    log.debug("received", { type: data.type });

    switch (data.type) {
      case "setTabs":
        handleSetTabs(data);
        break;
      case "session/message":
        handleSessionMessage(data);
        break;
      case "session/stream":
        handleSessionStream(data);
        break;
      case "session/streamEnd":
        handleSessionStreamEnd(data);
        break;
      case "session/switch":
        handleSessionSwitch(data);
        break;
      case "session/turnActive":
        handleSessionTurnActive(data);
        break;
      case "session/usage":
        handleSessionUsage(data);
        break;
      case "session/compression":
        handleSessionCompression(data);
        break;
      case "session/completed":
        handleSessionCompleted(data);
        break;
      case "session/info":
        handleSessionInfo(data);
        break;
      case "agentInfo":
        handleAgentInfo(data);
        break;
      case "statusline":
        handleStatusline(data);
        break;
      case "addTab":
        handleAddTab(data);
        break;
      case "updateTab":
        handleUpdateTab(data);
        break;
      case "setActiveSession":
        handleSetActiveSession(data);
        break;
      case "session/commands":
        handleSessionCommands(data);
        break;
      case "queue:added":
        handleQueueAdded(data);
        break;
      case "queue:updated":
        handleQueueUpdated(data);
        break;
      case "sessionOverview:state":
        handleSessionOverviewState(data);
        break;
      case "sessionOverview:toggle":
        handleSessionOverviewToggle(data);
        break;
      case "sessionOverview:position":
        handleSessionOverviewPosition(data);
        break;
      case "mesh:status":
        handleMeshStatus(data);
        break;
      case "mesh:taskBoard":
        handleMeshTaskBoard(data);
        break;
      case "mesh:message":
        handleMeshMessage(data);
        break;
      case "mesh:agentConnected":
        handleMeshAgentConnected(data);
        break;
      case "mesh:agentDisconnected":
        handleMeshAgentDisconnected(data);
        break;
      case "mesh:togglePanel":
        handleMeshPanelToggle(data);
        break;
    }
  });

  // Notify extension host that webview is ready
  getVsCodeApi().postMessage({ type: "ready" });
  getVsCodeApi().postMessage({ type: "sessionReady" });
  getVsCodeApi().postMessage({ type: "mesh:getStatus" });
}
