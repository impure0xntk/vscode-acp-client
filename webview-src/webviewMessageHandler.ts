import { sessionKeyOf, useSessionStore } from "./store/sessionStore";
import { useMessageStore } from "./store/messageStore";
import { useUiStateStore } from "./store/uiStateStore";
import { useMeshStore } from "./store/meshStore";
import { usePathResolutionStore } from "./store/pathResolutionStore";
import { useFileWriteStore } from "./store/fileWriteStore";
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

// Guard key: set to the session key the webview just requested to switch to.
// When a session/switch response arrives, the key is compared:
// - if null → no pending switch (e.g. direct extension call), apply normally
// - if matching → apply and clear
// - if mismatched → stale echo from a previous switch, discard
let pendingSwitchGuard: string | null = null;

// ── rAF-based stream chunk batching ────────────────────────────────────────
// Coalesce rapid session/stream messages into a single Zustand update per
// frame.  The extension host already micro-batches via ProtocolHandler's
// 50ms timer, but multiple postMessage round-trips can still arrive in one
// frame.  This prevents a store update + pipeline re-render per chunk.

interface StreamBatch {
  chunks: string[];
  rafId: number | null;
}

const streamBatchMap = new Map<string, StreamBatch>();
const STREAM_BATCH_RAF_MS = 16; // ~1 frame at 60fps

function scheduleStreamFlush(msgKey: string, agentId: string, sessionId: string, chunk: string): void {
  let batch = streamBatchMap.get(msgKey);
  if (!batch) {
    batch = { chunks: [], rafId: null };
    streamBatchMap.set(msgKey, batch);
  }
  batch.chunks.push(chunk);

  if (batch.rafId == null) {
    batch.rafId = requestAnimationFrame(() => {
      const b = streamBatchMap.get(msgKey);
      if (!b) return;
      streamBatchMap.delete(msgKey);
      const accumulated = b.chunks;
      b.chunks = [];
      b.rafId = null;

      // Single Zustand update for all accumulated chunks
      useMessageStore.getState().appendStreamChunks(msgKey, agentId, sessionId, accumulated);
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

/**
 * Call this right before sending a switchSession message to the extension.
 * The guard key is stored and checked in handleSessionSwitch.
 */
export function setPendingSwitch(agentId: string, sessionId: string): void {
  pendingSwitchGuard = sessionKeyOf(agentId, sessionId);
}

// ── Message handler types ───────────────────────────────────────────────────

interface SetTabsMessage {
  type: "setTabs";
  tabs: SessionTabState[];
  /** Authoritative active session key ("agentId:sessionId") from the extension. */
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

// ── Mesh Orchestrator messages ──────────────────────────────────────────────

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

// ── Session pin/unpin messages ─────────────────────────────────────────────

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

// ── Plan update message ─────────────────────────────────────────────────────

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

// ── Agent status message ────────────────────────────────────────────────────

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

/**
 * ACP fs/write_text_file event forwarded from the extension host.
 * Contains the file path and content so the webview can count lines
 * written per turn for the file edit summary.
 */
interface SessionFileWriteMessage {
  type: "session/webviewFileWrite";
  agentId: string;
  sessionId: string;
  path: string;
  content: string;
  /** Original content before this write (null if file didn't exist) */
  originalContent?: string | null;
}

/**
 * Raw SDK session/update notification forwarded from the extension host.
 * The webview extracts tool_call / tool_call_update events and injects
 * them into the message store as tool-call chat messages so that the
 * existing pipeline (merge → annotate → ToolBatchSummary) renders them.
 */
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

// ── Handler functions ───────────────────────────────────────────────────────

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

  // Determine the authoritative active session key.
  // The extension sends the correct activeSessionKey in the setTabs message.
  // Only use a local fallback when the extension does not provide one (legacy).
  const storeBefore = useSessionStore.getState();
  const existingKey = storeBefore.activeSessionKey;
  const authoritativeKey =
    data.activeSessionKey && newKeys.includes(data.activeSessionKey)
      ? data.activeSessionKey
      : existingKey && newKeys.includes(existingKey)
        ? existingKey
        : (newKeys[0] ?? null);

  useSessionStore.getState().bulkSetTabs({
    tabs: data.tabs,
    workspaceRoot: data.workspaceRoot,
    connectedAgents: data.agents,
    workspaceFolders: data.workspaceFolders,
    agentInfoMap: data.agentInfoMap,
    sessionInfoMap: data.sessionInfoMap,
  });

  // Set the authoritative active session key only when it differs.
  // This prevents overwriting user-initiated tab switches that happened
  // since the last setTabs message was sent.
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
  // Deserialize attachmentsJson into attachments array so the pipeline
  // and <Message /> component can render attachment chips.
  const msg = data.message;
  const attachments =
    msg.attachments ??
    (msg.attachmentsJson
      ? (JSON.parse(
          msg.attachmentsJson
        ) as import("./types").ContextAttachment[])
      : undefined);

  // Deduplicate tool calls: the extension-host buffered flush
  // (flushPendingToolCalls) delivers tool messages that may already
  // have been delivered in real-time via session/notification →
  // handleSessionNotification. Remove any toolCall whose id already
  // exists in a tool message in the store to prevent duplicate cards.
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
      const dedupedTCs = msg.toolCalls.filter((tc) => !existingTcIds.has(tc.id));
      if (dedupedTCs.length === 0) {
        // All tool calls already exist — skip this message entirely
        log.debug("handleSessionMessage: skipping duplicate tool message", {
          msgKey,
          msgId: msg.id,
        });
        return;
      }
      if (dedupedTCs.length < msg.toolCalls.length) {
        // Some tool calls are duplicates — replace with deduped list
        log.debug("handleSessionMessage: deduplicating tool calls", {
          msgKey,
          before: msg.toolCalls.length,
          after: dedupedTCs.length,
        });
        useMessageStore
          .getState()
          .appendMessage(msgKey, { ...msg, attachments, toolCalls: dedupedTCs });
        return;
      }
    }
  }

  useMessageStore.getState().appendMessage(msgKey, { ...msg, attachments });
}

function handleSessionStreamStart(data: SessionStreamStart): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  // Set streaming flag immediately so the blinking cursor appears from
  // the very first stream chunk.  Without this, the first session (where
  // no prior agent message exists for appendStreamChunks to append to)
  // never gets streaming=true because appendStreamChunks only sets it when
  // shouldAppend is true (i.e. a prior agent message exists).
  useMessageStore.getState().setStreaming(msgKey, true);
  // Stamp the current file-write sequence counter onto the last agent
  // message so grouping.ts can partition writes per step.
  // writeSeq = N means N writes had been recorded when this step began,
  // so writes with seq >= N belong to this step.
  const writeSeq = useFileWriteStore.getState().currentSeq();
  log.info("handleSessionStreamStart: stamping writeSeq", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    writeSeq,
    currentFileWriteCount: writeSeq,
  });
  useMessageStore.getState().updateLastAgentMessage(msgKey, { writeSeq });
  // Also flush any pending stream batch so the first text appears immediately
  const batch = streamBatchMap.get(msgKey);
  if (batch && batch.chunks.length > 0) {
    if (batch.rafId != null) {
      cancelAnimationFrame(batch.rafId);
      batch.rafId = null;
    }
    const accumulated = batch.chunks;
    streamBatchMap.delete(msgKey);
    batch.chunks = [];
    useMessageStore.getState().appendStreamChunks(msgKey, data.agentId, data.sessionId, accumulated);
  }
}

function handleSessionStream(data: SessionStream): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  // Schedule via rAF to coalesce multiple chunks arriving in the same frame
  // into a single Zustand update.  This prevents one store update + pipeline
  // re-render per chunk when the extension host delivers batched text.
  scheduleStreamFlush(msgKey, data.agentId, data.sessionId, data.chunk);
}

function handleSessionStreamEnd(data: SessionStreamEnd): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  // Flush any pending stream batch before clearing streaming flag
  const batch = streamBatchMap.get(msgKey);
  if (batch && batch.chunks.length > 0) {
    if (batch.rafId != null) {
      cancelAnimationFrame(batch.rafId);
      batch.rafId = null;
    }
    const accumulated = batch.chunks;
    streamBatchMap.delete(msgKey);
    batch.chunks = [];
    useMessageStore.getState().appendStreamChunks(msgKey, data.agentId, data.sessionId, accumulated);
  }
  useMessageStore.getState().setStreaming(msgKey, false);
  // Sync sessionInfoMap status so Overview/Tab indicators return to idle
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

  // No-op if already active (prevents redundant re-renders / race loops).
  if (currentKey === key) {
    log.debug("handleSessionSwitch: already active, skipping", { key });
    pendingSwitchGuard = null;
    return;
  }

  // Guard: if the webview has since switched to a different session,
  // this is a stale echo from the extension — discard it.
  if (pendingSwitchGuard !== null && pendingSwitchGuard !== key) {
    log.info("handleSessionSwitch: stale echo discarded", {
      expected: pendingSwitchGuard,
      received: key,
    });
    return;
  }

  // Clear the guard after processing a matching response.
  pendingSwitchGuard = null;

  const sessionStore = useSessionStore.getState();

  // Ensure the tab exists in tabOrder — if the extension activates a
  // session before bulkSetTabs delivers the full tab list (race between
  // session/switch and setTabs messages), addTab creates the tab so the
  // UI can render it. Without this, activeSessionKey is set but no tab
  // exists, resulting in a blank panel with no messages.
  if (!sessionStore.tabOrder.includes(key)) {
    sessionStore.addTab(
      data.agentId,
      data.sessionId,
      data.sessionId.slice(0, 8)
    );
  }

  // Only set activeSessionKey if it differs from the current key.
  // The webview already updated activeSessionKey in switchTab() before
  // sending the postMessage. Calling setActiveSession here would trigger
  // a redundant re-render and, in race conditions with other extension-
  // initiated session/switch messages (e.g. from sessionCreated or
  // setActiveSession), can cause the UI to switch to an unintended session.
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
  const outcome:
    | "completed"
    | "error"
    | "cancelled" =
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
  const outcome:
    | "completed"
    | "error"
    | "cancelled" = data.stopReason
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
    sessionStore.addTab(data.agentId, data.sessionId, data.sessionId.slice(0, 8));
  }
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
  useSessionStore.getState().updateQueuedPromptStatus(key, data.entry.id, "sending");
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

// ── Mesh Orchestrator handlers ──────────────────────────────────────────────

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

// ── Session pin/unpin handlers ─────────────────────────────────────────────

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

// ── Plan update handler ─────────────────────────────────────────────────────

function handlePlanUpdate(data: PlanUpdateMessage): void {
  log.info("plan.update", {
    planId: data.plan.id,
    stepCount: data.plan.steps.length,
    status: data.plan.status,
  });
  useSessionStore.getState().setCurrentPlan(data.plan);
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

// ── Agent status handler ────────────────────────────────────────────────────

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

// ── Session notification handler ────────────────────────────────────────────

/**
 * Normalize raw SDK toolCallStatus → webview ToolCall.status
 */
export function normalizeToolStatus(
  raw: string | null | undefined,
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
  content: Array<{ type: string; [key: string]: unknown }> | undefined,
): import("./types").ToolCallDiffContent | undefined {
  if (!content) return undefined;
  for (const c of content) {
    if (c.type === "diff") {
      const oldText = (c.oldText as string | undefined) ?? "";
      const newText = (c.newText as string) ?? "";
      const filePath = (c.path as string) ?? "";
      // Build a minimal unified diff
      const diff = oldText === newText
        ? newText
        : `--- ${filePath}\n+++ ${filePath}\n-${oldText}\n+${newText}`;
      return { type: "diff", diff, oldPath: oldText ? filePath : undefined, newPath: filePath };
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
  useFileWriteStore.getState().addWrite(
    data.agentId,
    data.sessionId,
    data.path,
    data.content,
    data.originalContent ?? null
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
    const tcLocations = (update.locations as Array<{ path: string; line?: number }> | undefined)?.map(
      (loc) => ({ path: loc.path, line: loc.line ?? undefined }),
    );
    const tcDiff = extractDiffFromContent(
      update.content as Array<{ type: string; [key: string]: unknown }> | undefined,
    );

    const toolCall = {
      id: tcId,
      title: tcTitle,
      status: tcStatus,
      kind: tcKind,
      input: typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput),
      output: rawOutput !== undefined
        ? typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput)
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
        (m) => m.role === "tool" && m.toolCalls?.some((tc) => tc.id === tcId),
      );
      if (alreadyExists) {
        log.debug("handleSessionNotification: skipping duplicate tool_call", { msgKey, tcId });
        return;
      }
    }

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
  } else if (su === "tool_call_update") {
    // Update an existing tool call in the message store
    const tcId = update.toolCallId as string;
    const store = useMessageStore.getState();
    const existingMsgs = store.perSession[msgKey];
    if (!existingMsgs) return;

    log.debug("handleSessionNotification: tool_call_update", { msgKey, tcId });

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
            input: rawInput !== undefined
              ? typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput)
              : tc.input,
            output: rawOutput !== undefined
              ? typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput)
              : tc.output,
            locations:
              (update.locations as Array<{ path: string; line?: number }> | undefined)?.map(
                (loc) => ({ path: loc.path, line: loc.line ?? undefined }),
              ) ?? tc.locations,
            diffContent:
              extractDiffFromContent(
                update.content as Array<{ type: string; [key: string]: unknown }> | undefined,
              ) ?? tc.diffContent,
          };
        });
        store.updateMessage(msgKey, i, { ...m, toolCalls: updatedTCs });
        break;
      }
    }
  }
}

// ── Setup function ──────────────────────────────────────────────────────────

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
      case "mesh:plan":
        // Forward to extension host — SupervisorOrchestrator.createPlan() handles the rest
        // No-op on webview side; the extension host will send plan.update when ready
        break;
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
