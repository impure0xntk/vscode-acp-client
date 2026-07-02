import { sessionKeyOf, useSessionStore } from "./store/sessionStore";
import { useMessageStore } from "./store/messageStore";
import { useUiStateStore } from "./store/uiStateStore";
import { useMeshStore } from "./store/meshStore";
import { usePathResolutionStore } from "./store/pathResolutionStore";
import { useFileWriteStore } from "./store/fileWriteStore";
import { clearDiffCache } from "./pipeline/stages/grouping";
import { getVsCodeApi } from "./lib/vscodeApi";
import { getLogger } from "./lib/logger";
import { toSessionInfoDTO } from "./store/mappers";
import type { SessionInfoDTO } from "./store/sessionStore";
import type {
  SessionTabState,
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
  Plan,
  PlanStep,
} from "./types";

const log = getLogger("webview.messageHandler");

/**
 * Safe JSON.stringify — catches circular references, BigInt, and other
 * non-serializable values that would throw.  Falls back to String(value).
 */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

// Guard key: set to the session key the webview just requested to switch to.
// When a session/switch response arrives, the key is compared:
// - if null → no pending switch (e.g. direct extension call), apply normally
// - if matching → apply and clear
// - if mismatched → stale echo from a previous switch, discard
let pendingSwitchGuard: string | null = null;

// Pending snapshot key: set by handleSessionSnapshot when a session is restored.
// Used by handleSetTabs as a fallback when the extension host's activeSessionKey
// is null (race condition: setTabs arrives before the extension updates its
// active session).  Cleared after first use in handleSetTabs.
let pendingSnapshotKey: string | null = null;

interface StreamBatch {
  chunks: string[];
  rafId: number | null;
  messageId?: string | null;
  sessionUpdate?: string | null;
}

const streamBatchMap = new Map<string, StreamBatch>();

function flushBatch(msgKey: string, agentId: string, sessionId: string): void {
  const batch = streamBatchMap.get(msgKey);
  if (!batch || batch.chunks.length === 0) return;
  if (batch.rafId != null) {
    cancelAnimationFrame(batch.rafId);
    batch.rafId = null;
  }
  const accumulated = batch.chunks;
  const messageId = batch.messageId;
  streamBatchMap.delete(msgKey);
  batch.chunks = [];

  useMessageStore
    .getState()
    .appendStreamChunks(msgKey, agentId, sessionId, accumulated, messageId);
  const store = useSessionStore.getState();
  const existing = store.sessionInfoMap[msgKey];
  if (existing && existing.status === "running") {
    store.setSessionInfo(agentId, sessionId, {
      ...existing,
      lastResponseAt: new Date().toISOString(),
    });
  }
}

function scheduleStreamFlush(
  msgKey: string,
  agentId: string,
  sessionId: string,
  chunk: string,
  messageId?: string,
  sessionUpdate?: string
): void {
  let batch = streamBatchMap.get(msgKey);
  if (!batch) {
    batch = { chunks: [], rafId: null, messageId: messageId ?? null, sessionUpdate: sessionUpdate ?? null };
    streamBatchMap.set(msgKey, batch);
  } else if (batch.messageId == null && messageId != null) {
    // Persist messageId for this batch window if not yet set.
    batch.messageId = messageId;
  } else if (
    messageId != null &&
    batch.messageId != null &&
    messageId !== batch.messageId
  ) {
    // messageId changed — flush the current batch so chunks are attributed
    // to the correct agent message.  Without this, all chunks accumulate
    // under the first messageId and subsequent logical messages are merged
    // into the first agent message, preventing intermediate steps.
    flushBatch(msgKey, agentId, sessionId);
    batch = { chunks: [], rafId: null, messageId, sessionUpdate };
    streamBatchMap.set(msgKey, batch);
  } else if (
    sessionUpdate != null &&
    batch.sessionUpdate != null &&
    sessionUpdate !== batch.sessionUpdate
  ) {
    // sessionUpdate type changed — flush the current batch to create a boundary
    // between different types of content (e.g., agent_message_chunk → agent_thought_chunk).
    // This implements Zed-equivalent fallback boundary detection when messageId is not provided.
    flushBatch(msgKey, agentId, sessionId);
    batch = { chunks: [], rafId: null, messageId: batch.messageId, sessionUpdate };
    streamBatchMap.set(msgKey, batch);
  }
  batch.chunks.push(chunk);
  // Persist sessionUpdate if not yet set
  if (batch.sessionUpdate == null && sessionUpdate != null) {
    batch.sessionUpdate = sessionUpdate;
  }

  if (batch.rafId == null) {
    batch.rafId = requestAnimationFrame(() => {
      const b = streamBatchMap.get(msgKey);
      if (!b) return;
      streamBatchMap.delete(msgKey);
      const accumulated = b.chunks;
      b.chunks = [];
      b.rafId = null;

      useMessageStore
        .getState()
        .appendStreamChunks(
          msgKey,
          agentId,
          sessionId,
          accumulated,
          b.messageId,
          b.sessionUpdate
        );
      const store = useSessionStore.getState();
      const existing = store.sessionInfoMap[msgKey];
      if (existing && existing.status === "running") {
        store.setSessionInfo(agentId, sessionId, {
          ...existing,
          lastResponseAt: new Date().toISOString(),
        });
      }
    });
  }
}

export function setPendingSwitch(agentId: string, sessionId: string): void {
  pendingSwitchGuard = sessionKeyOf(agentId, sessionId);
}

interface SetTabsMessage {
  type: "setTabs";
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  workspaceRoot?: string;
  agents?: ConnectedAgentInfo[];
  workspaceFolders?: WorkspaceFolder[];
  agentInfoMap?: Record<string, AgentInfo>;
  sessionInfoMap?: Record<string, SessionInfoDTO>;
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
  /** ACP SDK messageId — identifies the logical message this chunk belongs to. */
  messageId?: string;
  /** ACP sessionUpdate type — identifies the type of session update (agent_message_chunk, agent_thought_chunk, user_message_chunk) */
  sessionUpdate?: string;
}

interface SessionStreamStart {
  type: "session/streamStart";
  agentId: string;
  sessionId: string;
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

interface SessionTurnEnded {
  type: "session/turnEnded";
  agentId: string;
  sessionId: string;
  stopReason: string;
}

interface SessionCompleted {
  type: "session/completed";
  agentId: string;
  sessionId: string;
  title: string;
  stopReason?: string;
}

interface SessionSnapshot {
  type: "session/snapshot";
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  status: string;
  isStreaming: boolean;
  createdAt: string;
  lastResponseAt: string | null;
}

interface SessionInfo {
  type: "session/info";
  agentId: string;
  sessionId: string;
  status: string;
  lastTurnOutcome: string | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  isStreaming: boolean;
  createdAt: string;
  lastResponseAt: string | null;
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

interface QueueDequeuedMessage {
  type: "queue:dequeued";
  agentId: string;
  sessionId: string;
  entry: QueuedPrompt;
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

interface MeshStatusMessage {
  type: "mesh:status";
  agents: import("./types").MeshAgentStatus[];
  teams?: import("./types").MeshTeamEntry[];
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

interface MeshStartTeamMessage {
  type: "mesh:startTeam";
  teamId: string;
  name: string;
  description: string;
  lead: { agentId: string; sessionId: string };
  members: Array<{ agentId: string; sessionId: string }>;
}

interface MeshTeamCreatedMessage {
  type: "mesh:teamCreated";
  team: import("./types").MeshTeamEntry;
}

interface MeshOpenTeamCreateMessage {
  type: "mesh:openTeamCreate";
}

interface MeshPlanMessage {
  type: "mesh:plan";
  text?: string;
  teamId?: string;
}

interface MeshAddMemberToTeamMessage {
  type: "mesh:addMemberToTeam";
  teamId: string;
  agentId: string;
}

interface MeshRemoveMemberFromTeamMessage {
  type: "mesh:removeMemberFromTeam";
  teamId: string;
  agentId: string;
}

interface MeshTeamUpdatedMessage {
  type: "mesh:teamUpdated";
  team: import("./types").MeshTeamEntry;
}

interface SessionTitleMessage {
  type: "session/title";
  agentId: string;
  sessionId: string;
  title: string;
}

interface SessionPinnedNotification {
  type: "session.pinned";
  agentId: string;
  sessionId: string;
}

interface SessionUnpinnedNotification {
  type: "session.unpinned";
  agentId: string;
  sessionId: string;
}

interface PathsResolvedMessage {
  type: "pathsResolved";
  sessionKey: string;
  paths: string[];
}

interface PlanUpdateMessage {
  type: "plan.update";
  plan: Plan;
}

interface PlanStepUpdateMessage {
  type: "plan.stepUpdate";
  planId: string;
  stepId: string;
  updates: Partial<PlanStep>;
}

interface PlanCancelledMessage {
  type: "plan.cancelled";
  planId: string;
}

interface AgentStatusMessage {
  type: "agent.status";
  agentId: string;
  status: "idle" | "running" | "waiting" | "error" | "completed";
  currentTask?: string;
  progress?: number;
}

interface ComposerFocusMessage {
  type: "composer:focus";
}

interface SessionFileWriteMessage {
  type: "session/webviewFileWrite";
  agentId: string;
  sessionId: string;
  path: string;
  content: string;
  originalContent?: string | null;
  contentHash?: string;
}

interface SessionNotificationMessage {
  type: "session/notification";
  agentId: string;
  sessionId: string;
  notification: {
    update: {
      sessionUpdate:
        | "agent_message_chunk"
        | "agent_thought_chunk"
        | "tool_call"
        | "tool_call_update"
        | "plan"
        | "plan_update"
        | "plan_removed"
        | "available_commands_update"
        | "current_mode_update"
        | "config_option_update"
        | "session_info_update"
        | "usage_update"
        | "user_message_chunk";
      [key: string]: unknown;
    };
    sessionId: string;
  };
}

type WebviewMessage =
  | PlanUpdateMessage
  | PlanStepUpdateMessage
  | PlanCancelledMessage
  | AgentStatusMessage
  | SessionTitleMessage
  | SetTabsMessage
  | SessionMessage
  | SessionStream
  | SessionStreamStart
  | SessionStreamEnd
  | SessionSwitch
  | SessionTurnActive
  | SessionUsage
  | SessionCompression
  | SessionTurnEnded
  | SessionCompleted
  | SessionSnapshot
  | SessionInfo
  | AgentInfoMessage
  | StatuslineMessage
  | AddTabMessage
  | UpdateTabMessage
  | SetActiveSessionMessage
  | SessionCommandsMessage
  | QueueAddedMessage
  | QueueUpdatedMessage
  | QueueDequeuedMessage
  | SessionOverviewToggleMessage
  | SessionOverviewPositionMessage
  | SessionOverviewStateMessage
  | MeshStatusMessage
  | MeshTaskBoardMessage
  | MeshMessageMessage
  | MeshAgentConnectedMessage
  | MeshAgentDisconnectedMessage
  | MeshPanelToggleMessage
  | MeshStartTeamMessage
  | MeshTeamCreatedMessage
  | MeshOpenTeamCreateMessage
  | MeshPlanMessage
  | MeshAddMemberToTeamMessage
  | MeshRemoveMemberFromTeamMessage
  | MeshTeamUpdatedMessage
  | SessionPinnedNotification
  | SessionUnpinnedNotification
  | PathsResolvedMessage
  | ComposerFocusMessage
  | SessionNotificationMessage
  | SessionFileWriteMessage;

function handleSetTabs(data: SetTabsMessage): void {
  log.info("handleSetTabs", {
    tabCount: data.tabs.length,
    tabs: data.tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId)),
    activeSessionKey: data.activeSessionKey,
    hasWorkspaceRoot: !!data.workspaceRoot,
    hasAgentInfo: !!data.agentInfoMap
      ? Object.keys(data.agentInfoMap).length
      : 0,
  });

  const newKeys = data.tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId));

  const storeBefore = useSessionStore.getState();
  const existingKey = storeBefore.activeSessionKey;
  const authoritativeKey =
    data.activeSessionKey && newKeys.includes(data.activeSessionKey)
      ? data.activeSessionKey
      : existingKey && newKeys.includes(existingKey)
        ? existingKey
        : pendingSnapshotKey && newKeys.includes(pendingSnapshotKey)
          ? pendingSnapshotKey
          : (newKeys[0] ?? null);
  pendingSnapshotKey = null;

  useSessionStore.getState().bulkSetTabs({
    tabs: data.tabs,
    workspaceRoot: data.workspaceRoot,
    connectedAgents: data.agents,
    workspaceFolders: data.workspaceFolders,
    agentInfoMap: data.agentInfoMap,
    sessionInfoMap: data.sessionInfoMap,
  });

  const storeAfter = useSessionStore.getState();
  if (storeAfter.activeSessionKey !== authoritativeKey) {
    log.info("handleSetTabs: applying authoritative activeSessionKey", {
      from: storeAfter.activeSessionKey,
      to: authoritativeKey,
      source: data.activeSessionKey ? "extension" : "local-fallback",
    });
    storeAfter.setActiveSession(authoritativeKey);
  }
}

function handleSessionMessage(data: SessionMessage): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const msg = data.message;
  const attachments =
    msg.attachments ??
    (msg.attachmentsJson
      ? (JSON.parse(
          msg.attachmentsJson
        ) as import("./types").ContextAttachment[])
      : undefined);

  if (msg.role === "tool" && msg.toolCalls && msg.toolCalls.length > 0) {
    const store = useMessageStore.getState();
    const existingMsgs = store.perSession[msgKey];
    if (existingMsgs) {
      const existingTcIds = new Set<string>();
      for (const m of existingMsgs) {
        if (m.role === "tool" && m.toolCalls) {
          for (const tc of m.toolCalls) {
            existingTcIds.add(tc.id);
          }
        }
      }
      const dedupedTCs = msg.toolCalls.filter(
        (tc) => !existingTcIds.has(tc.id)
      );
      if (dedupedTCs.length === 0) {
        log.debug("handleSessionMessage: skipping duplicate tool message", {
          msgKey,
          msgId: msg.id,
        });
        return;
      }
      if (dedupedTCs.length < msg.toolCalls.length) {
        log.debug("handleSessionMessage: deduplicating tool calls", {
          msgKey,
          before: msg.toolCalls.length,
          after: dedupedTCs.length,
        });
        useMessageStore.getState().appendMessage(msgKey, {
          ...msg,
          attachments,
          toolCalls: dedupedTCs,
        });
        return;
      }
    }
  }

  useMessageStore.getState().appendMessage(msgKey, { ...msg, attachments });
}

function handleSessionStreamStart(data: SessionStreamStart): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  useMessageStore.getState().setStreaming(msgKey, true);
  const writeSeq = useFileWriteStore.getState().currentSeq();
  const lastAgentMsg = useMessageStore.getState().getLastAgentMessage(msgKey);
  log.info("handleSessionStreamStart", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    writeSeq,
    hasLastAgentMsg: !!lastAgentMsg,
    lastAgentMsgWriteSeq: lastAgentMsg?.writeSeq,
  });
  useMessageStore.getState().updateLastAgentMessage(msgKey, { writeSeq });
  const batch = streamBatchMap.get(msgKey);
  if (batch && batch.chunks.length > 0) {
    if (batch.rafId != null) {
      cancelAnimationFrame(batch.rafId);
      batch.rafId = null;
    }
    const accumulated = batch.chunks;
    const batchMessageId = batch.messageId;
    streamBatchMap.delete(msgKey);
    batch.chunks = [];
    useMessageStore
      .getState()
      .appendStreamChunks(
        msgKey,
        data.agentId,
        data.sessionId,
        accumulated,
        batchMessageId
      );
  }
}

function handleSessionStream(data: SessionStream): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  scheduleStreamFlush(
    msgKey,
    data.agentId,
    data.sessionId,
    data.chunk,
    data.messageId,
    data.sessionUpdate
  );
}

function handleSessionStreamEnd(data: SessionStreamEnd): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const batch = streamBatchMap.get(msgKey);
  if (batch && batch.chunks.length > 0) {
    if (batch.rafId != null) {
      cancelAnimationFrame(batch.rafId);
      batch.rafId = null;
    }
    const accumulated = batch.chunks;
    const messageId = batch.messageId;
    streamBatchMap.delete(msgKey);
    batch.chunks = [];
    useMessageStore
      .getState()
      .appendStreamChunks(
        msgKey,
        data.agentId,
        data.sessionId,
        accumulated,
        messageId
      );
  }
  useMessageStore.getState().setStreaming(msgKey, false);
  const existing = useSessionStore.getState().sessionInfoMap[msgKey];
  if (existing && existing.status === "running") {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: "idle",
      isStreaming: false,
      lastResponseAt: new Date().toISOString(),
    });
  }
}

function handleSessionSwitch(data: SessionSwitch): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const currentKey = useSessionStore.getState().activeSessionKey;
  log.info("handleSessionSwitch", {
    from: currentKey,
    to: key,
    hasTokenUsage: !!data.tokenUsage,
    model: data.model,
  });

  if (currentKey === key) {
    log.debug("handleSessionSwitch: already active, skipping", { key });
    pendingSwitchGuard = null;
    return;
  }

  if (pendingSwitchGuard !== null && pendingSwitchGuard !== key) {
    log.info("handleSessionSwitch: stale echo discarded", {
      expected: pendingSwitchGuard,
      received: key,
    });
    return;
  }

  pendingSwitchGuard = null;

  // Session switched — clear diff cache since previous session's content
  // hashes are irrelevant to the new session.
  clearDiffCache();

  const sessionStore = useSessionStore.getState();

  if (!sessionStore.tabOrder.includes(key)) {
    sessionStore.addTab(
      data.agentId,
      data.sessionId,
      data.sessionId.slice(0, 8)
    );
  }

  if (currentKey !== key) {
    sessionStore.setActiveSession(key);
  }
}

function handleSessionTurnActive(data: SessionTurnActive): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const active = data.active;
  log.debug("handleSessionTurnActive", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    active,
    action: data.action,
  });

  // Do NOT clear file write records here — the writeSeq partitioning
  // in grouping.ts already scopes summaries per-step.  Clearing here
  // causes attachStepFileEditSummaries to see empty writes after turn end,
  // resulting in no fileEditSummary on any step.

  // Sync streamingMap so Composer button reflects turn state
  useMessageStore.getState().setStreaming(msgKey, active);

  // Update session status in sessionInfoMap
  const existing = useSessionStore.getState().sessionInfoMap[msgKey];
  if (existing) {
    // When cancelling, the orchestrator emits sessionTurnActiveChanged with
    // active=false but keeps status="cancelling" until the agent confirms.
    // Overwriting to "idle" here would hide the cancelling state from the
    // Composer stop button and the StreamingStatus bar.
    const nextStatus =
      existing.status === "cancelling"
        ? "cancelling"
        : active
          ? "running"
          : "idle";
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      isStreaming: active,
      status: nextStatus,
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

function handleSessionTurnEnded(data: SessionTurnEnded): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const existing = useSessionStore.getState().sessionInfoMap[key];
  log.info("handleSessionTurnEnded", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    stopReason: data.stopReason,
  });

  // Clear the diff cache — turn is complete, cached diffs for this turn's
  // file contents are no longer needed.  Without this, the module-level
  // cache grows unbounded across turns (memory leak).
  clearDiffCache();

  // Stamp stopReason onto the last agent message in the message store so
  // the pipeline's groupByUserBoundary can use it as the authoritative
  // signal for the final response boundary.
  useMessageStore.getState().updateLastAgentMessage(key, {
    stopReason: data.stopReason,
  });

  // Clear the messageStore streaming flag so the blinking cursor in
  // SessionChatContainer disappears.  handleSessionStreamEnd also clears
  // this, but session/turnEnded is the authoritative turn-end signal and
  // may arrive without a preceding streamEnd (e.g. non-streaming agents
  // or agent-side truncation).  Without this, useMessages().isStreaming
  // stays true and the cursor keeps blinking after the turn is done.
  useMessageStore.getState().setStreaming(key, false);

  // Map ACP stopReason to TurnOutcome for the UI
  const outcome: "completed" | "error" | "cancelled" =
    data.stopReason === "end_turn" || data.stopReason === "max_turn_requests"
      ? "completed"
      : data.stopReason === "cancelled"
        ? "cancelled"
        : "error";
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: outcome === "completed" ? "idle" : existing.status,
      isStreaming: false,
      lastTurnOutcome: outcome,
      lastResponseAt: new Date().toISOString(),
    });
  }
  // If stopReason indicates refusal or max_tokens, the turn ended abnormally —
  // emit a completion notification so the user sees the reason.
  if (data.stopReason === "refusal" || data.stopReason === "max_tokens") {
    useSessionStore.getState().setCompletionNotification({
      agentId: data.agentId,
      sessionId: data.sessionId,
      title: existing?.title ?? data.sessionId.slice(0, 8),
      outcome,
    });
  }
}

function handleSessionCompleted(data: SessionCompleted): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const existing = useSessionStore.getState().sessionInfoMap[key];
  log.info("handleSessionCompleted", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    title: data.title,
    stopReason: data.stopReason,
  });
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: "completed",
      isStreaming: false,
      lastResponseAt: new Date().toISOString(),
    });
  }
  // Show completion notification with outcome derived from stopReason
  const outcome: "completed" | "error" | "cancelled" = data.stopReason
    ? data.stopReason === "end_turn" || data.stopReason === "max_turn_requests"
      ? "completed"
      : data.stopReason === "cancelled"
        ? "cancelled"
        : "error"
    : "completed";
  useSessionStore.getState().setCompletionNotification({
    agentId: data.agentId,
    sessionId: data.sessionId,
    title: data.title,
    outcome,
  });
}

function handleSessionSnapshot(data: SessionSnapshot): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("handleSessionSnapshot", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    messageCount: data.messages.length,
  });

  // Deserialize attachmentsJson for each message
  const messages = data.messages.map((msg) => {
    if (msg.attachmentsJson && !msg.attachments) {
      try {
        const attachments = JSON.parse(
          msg.attachmentsJson
        ) as import("./types").ContextAttachment[];
        return { ...msg, attachments };
      } catch {
        return msg;
      }
    }
    return msg;
  });

  // Populate message store so the chat UI renders the restored conversation
  useMessageStore.getState().setMessages(key, messages);

  // Update session info in session store
  const dto = toSessionInfoDTO({
    sessionId: data.sessionId,
    agentId: data.agentId,
    status: data.status,
    lastTurnOutcome: null,
    isStreaming: data.isStreaming,
    tokenUsage: {
      input: data.tokenUsage.inputTokens,
      output: data.tokenUsage.outputTokens,
      total: data.tokenUsage.totalTokens,
    },
    contextWindowMax: data.contextWindowMax,
    model: data.model,
    mode: data.mode,
    cwd: data.cwd,
    createdAt: data.createdAt,
    lastResponseAt: data.lastResponseAt,
  });
  useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, dto);

  // Ensure the tab exists in tabOrder — without this, a restored session's
  // messages are stored in messageStore but the UI cannot render them because
  // the session key is missing from tabOrder.  This also prevents the race
  // where a subsequent setTabs (bulkSetTabs) arrives before session/switch
  // and overwrites tabOrder without the restored session's key.
  const sessionStore = useSessionStore.getState();
  if (!sessionStore.tabOrder.includes(key)) {
    sessionStore.addTab(
      data.agentId,
      data.sessionId,
      data.sessionId.slice(0, 8)
    );
  }

  // Explicitly set the restored session as the active session so that
  // SessionChatContainer renders its messages.  Without this, the
  // subsequent session/switch message from the extension host hits the
  // currentKey === key early-return guard and the webview never re-renders
  // the chat area for the restored session.
  sessionStore.setActiveSession(key);

  // Record the pending snapshot key so that a subsequent handleSetTabs
  // (triggered by sendTabsToChatPanel) can use this as a fallback when
  // the extension host's activeSessionKey is null (race condition: setTabs
  // arrives before the extension updates its active session).
  pendingSnapshotKey = key;
}

function handleSessionInfo(data: SessionInfo): void {
  const dto = toSessionInfoDTO({
    sessionId: data.sessionId,
    agentId: data.agentId,
    status: data.status,
    lastTurnOutcome: data.lastTurnOutcome,
    isStreaming: data.isStreaming,
    tokenUsage: {
      input: data.tokenUsage.inputTokens,
      output: data.tokenUsage.outputTokens,
      total: data.tokenUsage.totalTokens,
    },
    contextWindowMax: data.contextWindowMax,
    model: data.model,
    mode: data.mode,
    cwd: data.cwd,
    createdAt: data.createdAt,
    lastResponseAt: data.lastResponseAt,
  });
  useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, dto);
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
  useSessionStore
    .getState()
    .addTab(data.tab.agentId, data.tab.sessionId, data.tab.title);
}

function handleUpdateTab(data: UpdateTabMessage): void {
  const store = useSessionStore.getState();
  const key = store.activeSessionKey;
  if (key && data.updates.title) {
    store.setTabTitle(key, data.updates.title);
  }
}

function handleSetActiveSession(data: SetActiveSessionMessage): void {
  useSessionStore
    .getState()
    .setActiveSession(sessionKeyOf(data.agentId, data.sessionId));
}

function handleSessionCommands(data: SessionCommandsMessage): void {
  useSessionStore
    .getState()
    .setSessionCommands(data.agentId, data.sessionId, data.commands);
}

function handleQueueAdded(data: QueueAddedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore.getState().addQueuedPrompt(key, data.entry);
}

function handleQueueUpdated(data: QueueUpdatedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore.getState().setPromptQueue(key, data.queue);
}

function handleQueueDequeued(data: QueueDequeuedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore
    .getState()
    .updateQueuedPromptStatus(key, data.entry.id, "sending");
}

function handleSessionOverviewState(data: SessionOverviewStateMessage): void {
  useUiStateStore.getState().setOverviewState(data.payload);
}

function handleSessionOverviewToggle(data: SessionOverviewToggleMessage): void {
  useUiStateStore.getState().setOverviewVisible(data.payload.visible);
}

function handleSessionOverviewPosition(
  data: SessionOverviewPositionMessage
): void {
  useUiStateStore.getState().setOverviewPosition(data.payload.position);
}

function handleMeshStatus(data: MeshStatusMessage): void {
  useMeshStore.getState().setAgentStatuses(data.agents);
  if (data.teams) {
    useMeshStore.getState().setTeams(data.teams);
  }
}

function handleMeshTeamCreated(data: MeshTeamCreatedMessage): void {
  useMeshStore.getState().addTeam(data.team);
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

function handleMeshTeamUpdated(data: MeshTeamUpdatedMessage): void {
  useMeshStore.getState().updateTeam(data.team.id, data.team);
}

function handlePathsResolved(data: PathsResolvedMessage): void {
  usePathResolutionStore
    .getState()
    .addResolvedPaths(data.sessionKey, data.paths);
}

function handleSessionTitle(data: SessionTitleMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("session title changed", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    title: data.title,
  });
  useSessionStore.getState().setTabTitle(key, data.title);
}

function handleSessionPinned(data: SessionPinnedNotification): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("session pinned", {
    agentId: data.agentId,
    sessionId: data.sessionId,
  });
  useSessionStore.getState().pinSession(key);
}

function handleSessionUnpinned(data: SessionUnpinnedNotification): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("session unpinned", {
    agentId: data.agentId,
    sessionId: data.sessionId,
  });
  useSessionStore.getState().unpinSession(key);
}

function handlePlanUpdate(data: PlanUpdateMessage): void {
  log.info("plan.update", {
    planId: data.plan.id,
    stepCount: data.plan.steps.length,
    status: data.plan.status,
  });
  const sessionStore = useSessionStore.getState();
  sessionStore.setCurrentPlan(data.plan);
  sessionStore.setIsPlanning(false);

  // Replace the planning indicator with a plan summary in the chat.
  // Determine the correct session key: if the plan has a teamId, look up
  // the team lead's session; otherwise fall back to the active session.
  let targetKey: string | null = sessionStore.activeSessionKey;
  if (data.plan.teamId) {
    const team = useMeshStore
      .getState()
      .teams.find((t) => t.id === data.plan.teamId);
    if (team) {
      targetKey = sessionKeyOf(team.lead.agentId, team.lead.sessionId);
    }
  }
  if (targetKey) {
    const messages = useMessageStore.getState().perSession[targetKey];
    if (messages) {
      const idx = messages.findIndex(
        (m) => m.planMeta?.planStatus === "draft" && !m.planMeta?.isPlanRequest
      );
      if (idx >= 0) {
        const updated: ChatMessage = {
          ...messages[idx],
          content: `Plan created: ${data.plan.steps.length} steps`,
          planMeta: {
            ...messages[idx].planMeta,
            planId: data.plan.id,
            planStatus: data.plan.status,
          },
        };
        useMessageStore.getState().updateMessage(targetKey, idx, updated);
      }
    }
  }
}

function handlePlanStepUpdate(data: PlanStepUpdateMessage): void {
  log.debug("plan.stepUpdate", {
    planId: data.planId,
    stepId: data.stepId,
    updates: Object.keys(data.updates),
  });
  const store = useSessionStore.getState();
  if (!store.currentPlan || store.currentPlan.id !== data.planId) return;
  store.updatePlanStep(data.stepId, data.updates);
}

function handlePlanCancelled(data: PlanCancelledMessage): void {
  log.info("plan.cancelled", { planId: data.planId });
  const store = useSessionStore.getState();
  if (!store.currentPlan || store.currentPlan.id !== data.planId) return;
  store.cancelPlan();
}

function handleAgentStatus(data: AgentStatusMessage): void {
  log.debug("agent.status", { agentId: data.agentId, status: data.status });
  useMeshStore.getState().updateAgentStatus(data.agentId, {
    state:
      data.status === "running"
        ? "working"
        : data.status === "waiting"
          ? "waiting"
          : data.status === "error"
            ? "error"
            : "idle",
    currentTask: data.currentTask,
    progress: data.progress,
  });
}

/**
 * Normalize raw SDK toolCallStatus → webview ToolCall.status
 */
export function normalizeToolStatus(
  raw: string | null | undefined
): "in_progress" | "completed" | "failed" | "cancelled" {
  if (raw === "pending") return "in_progress";
  if (
    raw === "in_progress" ||
    raw === "completed" ||
    raw === "failed" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "in_progress";
}

/**
 * Extract diff content from a ToolCallContent array (SDK format).
 */
export function extractDiffFromContent(
  content: Array<{ type: string; [key: string]: unknown }> | undefined
): import("./types").ToolCallDiffContent | undefined {
  if (!content) return undefined;
  for (const c of content) {
    if (c.type === "diff") {
      const oldText = (c.oldText as string | undefined) ?? "";
      const newText = (c.newText as string) ?? "";
      const filePath = (c.path as string) ?? "";
      // Build a minimal unified diff
      const diff =
        oldText === newText
          ? newText
          : `--- ${filePath}\n+++ ${filePath}\n-${oldText}\n+${newText}`;
      return {
        type: "diff",
        diff,
        oldPath: oldText ? filePath : undefined,
        newPath: filePath,
      };
    }
  }
  return undefined;
}

function handleSessionFileWrite(data: SessionFileWriteMessage): void {
  log.debug("handleSessionFileWrite", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    path: data.path,
    contentLen: data.content.length,
    hasOriginal: data.originalContent !== undefined,
  });
  useFileWriteStore
    .getState()
    .addWrite(
      data.agentId,
      data.sessionId,
      data.path,
      data.content,
      data.originalContent ?? null,
      data.contentHash
    );
}

function handleSessionNotification(data: SessionNotificationMessage): void {
  const { agentId, sessionId, notification } = data;
  const update = notification.update;
  const su = update.sessionUpdate;

  if (su !== "tool_call" && su !== "tool_call_update") return;

  const msgKey = sessionKeyOf(agentId, sessionId);

  if (su === "tool_call") {
    const tcId = update.toolCallId as string;
    const tcTitle = (update.title as string) ?? "";
    const tcStatus = normalizeToolStatus(update.status as string | null);
    const tcKind = (update.kind as string) ?? "";
    const rawInput = update.rawInput;
    const rawOutput = update.rawOutput;
    const tcLocations = (
      update.locations as Array<{ path: string; line?: number }> | undefined
    )?.map((loc) => ({ path: loc.path, line: loc.line ?? undefined }));
    const tcDiff = extractDiffFromContent(
      update.content as
        | Array<{ type: string; [key: string]: unknown }>
        | undefined
    );

    const toolCall = {
      id: tcId,
      title: tcTitle,
      status: tcStatus,
      kind: tcKind,
      input:
        typeof rawInput === "string" ? rawInput : safeJsonStringify(rawInput),
      output:
        rawOutput !== undefined
          ? typeof rawOutput === "string"
            ? rawOutput
            : safeJsonStringify(rawOutput)
          : undefined,
      locations: tcLocations,
      diffContent: tcDiff,
    };

    // Try to find an existing tool message for this turn and append.
    // If none exists, create a new tool ChatMessage.
    const store = useMessageStore.getState();
    const existingMsgs = store.perSession[msgKey];

    // Deduplicate: if ANY existing tool message already contains a toolCall
    // with this id, skip — the same toolCallId was already delivered via
    // the extension-host buffered flush (flushPendingToolCalls → session/message)
    // or by a previous notification. Without this, duplicate delivery
    // causes consecutive FETCH (or any same-kind) calls to render as
    // separate cards instead of being merged into a single batch.
    if (existingMsgs) {
      const alreadyExists = existingMsgs.some(
        (m: ChatMessage) =>
          m.role === "tool" && m.toolCalls?.some((tc) => tc.id === tcId)
      );
      if (alreadyExists) {
        log.debug("handleSessionNotification: skipping duplicate tool_call", {
          msgKey,
          tcId,
        });
        return;
      }
    }

    // Merge consecutive tool calls arriving without an intervening agent message
    // into the last tool message.  This ensures they render as a single
    // ToolBatchSummary instead of individual ToolCallCards.
    if (existingMsgs && existingMsgs.length > 0) {
      const lastMsg = existingMsgs[existingMsgs.length - 1];
      // Append to the last tool message only if no agent message has arrived
      // since it (boundary check: last message is still a tool message).
      if (lastMsg.role === "tool") {
        log.debug(
          "handleSessionNotification: appending to existing tool message",
          {
            msgKey,
            lastMsgId: lastMsg.id,
            incomingToolId: tcId,
          }
        );
        useMessageStore
          .getState()
          .updateMessage(msgKey, existingMsgs.length - 1, {
            ...lastMsg,
            toolCalls: [...(lastMsg.toolCalls ?? []), toolCall],
          });
      } else {
        // Agent message intervened — create a new tool message.
        const toolMsg = {
          id: `tc-${tcKind}-${tcId}-${Date.now()}`,
          role: "tool" as const,
          content: "",
          timestamp: Date.now(),
          agentId,
          sessionId,
          toolCalls: [toolCall],
        };
        store.appendMessage(msgKey, toolMsg);
      }
    } else {
      // Each tool_call notification creates its own tool message.
      // This ensures that tool calls arriving between different agent messages
      // are kept as separate PipelineItems, so they can be correctly grouped
      // with their following agent message as a distinct intermediate step.
      const toolMsg = {
        id: `tc-${tcKind}-${tcId}-${Date.now()}`,
        role: "tool" as const,
        content: "",
        timestamp: Date.now(),
        agentId,
        sessionId,
        toolCalls: [toolCall],
      };
      store.appendMessage(msgKey, toolMsg);
    }
  } else if (su === "tool_call_update") {
    // Update an existing tool call in the message store
    const tcId = update.toolCallId as string;
    const rawStatus = update.status as string | null;
    const newStatus = normalizeToolStatus(rawStatus);
    const store = useMessageStore.getState();
    const existingMsgs = store.perSession[msgKey];
    if (!existingMsgs) return;

    log.debug("handleSessionNotification: tool_call_update", {
      msgKey,
      tcId,
      status: newStatus,
    });

    for (let i = existingMsgs.length - 1; i >= 0; i--) {
      const m = existingMsgs[i];
      if (m.toolCalls?.some((tc) => tc.id === tcId)) {
        const updatedTCs = (m.toolCalls ?? []).map((tc) => {
          if (tc.id !== tcId) return tc;
          const rawInput = update.rawInput;
          const rawOutput = update.rawOutput;
          return {
            ...tc,
            title: (update.title as string) ?? tc.title,
            status: normalizeToolStatus((update.status as string) ?? tc.status),
            kind: (update.kind as string) ?? tc.kind,
            input:
              rawInput !== undefined
                ? typeof rawInput === "string"
                  ? rawInput
                  : safeJsonStringify(rawInput)
                : tc.input,
            output:
              rawOutput !== undefined
                ? typeof rawOutput === "string"
                  ? rawOutput
                  : safeJsonStringify(rawOutput)
                : tc.output,
            locations:
              (
                update.locations as
                  | Array<{ path: string; line?: number }>
                  | undefined
              )?.map((loc) => ({
                path: loc.path,
                line: loc.line ?? undefined,
              })) ?? tc.locations,
            diffContent:
              extractDiffFromContent(
                update.content as
                  | Array<{ type: string; [key: string]: unknown }>
                  | undefined
              ) ?? tc.diffContent,
          };
        });
        store.updateMessage(msgKey, i, { ...m, toolCalls: updatedTCs });
        break;
      }
    }

    // Note: we do NOT close the agent message on tool_call_update.
    // The step boundary is set when a NEW tool_call arrives (above),
    // not when an existing call completes.  This implements the desired
    // semantics: "once a tool call comes, merge tokens after it until
    // interrupted; after interruption, subsequent tokens form the next step".
  }
}

/**
 * Configures the webview message handler.
 * Distributes messages from the extension host to each store.
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
      case "session/streamStart":
        handleSessionStreamStart(data);
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
      case "session/turnEnded":
        handleSessionTurnEnded(data);
        break;
      case "session/completed":
        handleSessionCompleted(data);
        break;
      case "session/snapshot":
        handleSessionSnapshot(data);
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
      case "queue:dequeued":
        handleQueueDequeued(data);
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
      case "mesh:startTeam":
        // Forward to extension host — MeshOrchestrator.startTeam() handles the rest
        // No-op on webview side; the extension host will send mesh:teamCreated on success
        break;
      case "mesh:teamCreated":
        handleMeshTeamCreated(data);
        break;
      case "mesh:openTeamCreate":
        // No-op on extension host — the webview manages the dialog state internally
        break;
      case "mesh:plan": {
        // Append the user's plan request to the chat so it is visible in context
        const sessionStore = useSessionStore.getState();
        let activeKey = sessionStore.activeSessionKey;

        // In supervisor mode with a team, switch to the lead agent's session
        // so the plan request/response is visible in the Supervisor view
        // (otherwise messages go to the UnifiedMode's active session).
        if (data.teamId) {
          const team = useMeshStore
            .getState()
            .teams.find((t) => t.id === data.teamId);
          if (team) {
            const leadKey = sessionKeyOf(
              team.lead.agentId,
              team.lead.sessionId
            );
            if (activeKey !== leadKey) {
              log.info("mesh:plan: switching to lead session", {
                from: activeKey,
                to: leadKey,
              });
              sessionStore.setActiveSession(leadKey);
              activeKey = leadKey;
            }
            // Auto-focus the lead session so the chat is visible in Supervisor view
            sessionStore.setSupervisorViewMode("focus");
            sessionStore.setSupervisorFocusSession(leadKey);
          }
        }

        if (activeKey && data.text) {
          const [agentId, sessionId] = activeKey.split(":");
          useMessageStore.getState().appendMessage(activeKey, {
            id: crypto.randomUUID(),
            role: "user",
            content: data.text,
            timestamp: Date.now(),
            agentId,
            sessionId,
            planMeta: { isPlanRequest: true, teamId: data.teamId ?? "" },
          });

          // Planning indicator — replaced by plan summary when plan.update arrives
          useMessageStore.getState().appendMessage(activeKey, {
            id: `plan-indicator-${Date.now()}`,
            role: "system",
            content: "Planning...",
            timestamp: Date.now(),
            agentId,
            sessionId,
            planMeta: {
              isPlanRequest: false,
              planStatus: "draft",
              teamId: data.teamId ?? "",
            },
          });

          useSessionStore.getState().setIsPlanning(true, null);
        }
        // Forward to extension host — SupervisorOrchestrator.createPlan() handles the rest
        break;
      }
      case "mesh:addMemberToTeam":
      case "mesh:removeMemberFromTeam":
        // Forward to extension host — MeshOrchestrator handles the rest
        // No-op on webview side; the extension host will send mesh:teamUpdated on success
        break;
      case "mesh:teamUpdated":
        handleMeshTeamUpdated(data);
        break;
      case "pathsResolved":
        handlePathsResolved(data);
        break;
      case "session/title":
        handleSessionTitle(data);
        break;
      case "session.pinned":
        handleSessionPinned(data);
        break;
      case "session.unpinned":
        handleSessionUnpinned(data);
        break;
      case "plan.update":
        handlePlanUpdate(data);
        break;
      case "plan.stepUpdate":
        handlePlanStepUpdate(data);
        break;
      case "plan.cancelled":
        handlePlanCancelled(data);
        break;
      case "agent.status":
        handleAgentStatus(data);
        break;
      case "composer:focus":
        requestAnimationFrame(() => {
          const textarea =
            document.querySelector<HTMLTextAreaElement>(".composer textarea");
          if (textarea) {
            textarea.focus();
            // Place cursor at end
            const len = textarea.value.length;
            textarea.selectionStart = len;
            textarea.selectionEnd = len;
          }
        });
        break;
      case "session/notification":
        handleSessionNotification(data);
        break;
      case "session/webviewFileWrite":
        handleSessionFileWrite(data);
        break;
    }
  });

  // Notify extension host that webview is ready
  getVsCodeApi().postMessage({ type: "ready" });
  getVsCodeApi().postMessage({ type: "sessionReady" });
  getVsCodeApi().postMessage({ type: "mesh:getStatus" });
}
