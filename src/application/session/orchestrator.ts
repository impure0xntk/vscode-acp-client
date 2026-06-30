// ============================================================================
// SessionOrchestrator — thin facade over session modules
//
// This class composes the following modules:
//   - AgentConnection   : process lifecycle, initialize, disconnect
//   - SessionState      : in-memory state, streaming buffer, tool call buffer
//   - SessionLifecycle  : CRUD, fork, restore, rename, pin
//   - PromptExecution   : prompt send, queue, cancel, turn lifecycle
//   - ProtocolHandler   : handleSessionUpdate, handleRequestPermission
//   - SessionOverview   : overview computation, debounced emit
//
// The orchestrator owns the module wiring and exposes a unified API
// for the extension layer (event handlers, commands, extension.ts).
// ============================================================================

import { EventEmitter } from "events";
import type { UIAPI } from "../../platform/ui";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { PersistentHistoryStore } from "./persistentHistory";
import type { SessionHistoryStore, HistoryEntry } from "./historyStore";
import { PromptBuilder } from "../../domain/services/prompt-builder";
import type { MeshProtocolConfig } from "../../domain/services/prompt-builder";
import { getLogger } from "../../platform/backends";

const log = getLogger("orchestrator");

import { AgentConnection } from "./agent-connection";
import { SessionState, sessionKey } from "./session-state";
import { SessionLifecycle } from "./session-lifecycle";
import { PromptExecution } from "./prompt-execution";
import { ProtocolHandler } from "./protocol-handler";
import { SessionOverview } from "./session-overview";
import type {
  AgentConfig,
  RestoreResult,
  AgentStatus,
  SessionStatusInfo,
  AgentConnectionState,
  AppSessionInfo,
  AgentInfo,
} from "./types";

// Re-export types for downstream consumers
export type {
  AppSessionInfo,
  QueuedPrompt,
  QueuedPromptStatus,
  AgentConfig,
  AutoConnectEntry,
  AgentInfo,
  AgentStatus,
  SessionStatusInfo,
  AgentConnectionState,
  RestoreResult,
  SessionCompletedEvent,
  PromptContext,
} from "./types";

export { sessionKey } from "./session-state";

// ============================================================================
// OrchestratorDeps
// ============================================================================

export interface OrchestratorDeps {
  ui: UIAPI;
  fs: FileSystemAPI;
}

// ============================================================================
// SessionOrchestrator
// ============================================================================

export class SessionOrchestrator extends EventEmitter {
  private deps: OrchestratorDeps;

  // Modules
  private agentConnection!: AgentConnection;
  private sessionState: SessionState;
  private sessionLifecycle!: SessionLifecycle;
  private promptExecution!: PromptExecution;
  private protocolHandler!: ProtocolHandler;
  private sessionOverview: SessionOverview;

  // History stores (set after construction)
  private historyStore: PersistentHistoryStore | null = null;
  private sessionHistoryStore: SessionHistoryStore | null = null;

  constructor(deps: OrchestratorDeps) {
    super();
    this.deps = deps;

    // Initialize modules in dependency order
    // 1. SessionState (no dependencies)
    this.sessionState = new SessionState();

    // 2. SessionOverview (depends on sessionState)
    this.sessionOverview = new SessionOverview({
      agentConnection: undefined as any, // Will be set after agentConnection is created
      sessionState: this.sessionState,
      emit: (event: string, ...args: unknown[]) => this.emit(event, ...args),
    });

    // 3. ProtocolHandler (depends on sessionState, ui)
    //    Uses placeholder references that will be updated
    this.protocolHandler = new ProtocolHandler({
      agentConnection: undefined as any,
      sessionState: this.sessionState,
      promptExecution: undefined as any,
      ui: deps.ui,
      historyStore: null,
      sessionHistoryStore: null,
      emit: (event: string, ...args: unknown[]) => this.emit(event, ...args),
    });

    // 4. PromptExecution (depends on agentConnection placeholder, sessionState)
    this.promptExecution = new PromptExecution({
      agentConnection: undefined as any,
      sessionState: this.sessionState,
      protocolHandler: this.protocolHandler,
      historyStore: null,
      getMeshGlobalEnabled: () =>
        deps.ui.getConfiguration<boolean>("acp.meshProtocol", "enabled", false),
      emit: (event: string, ...args: unknown[]) => this.emit(event, ...args),
      appendToolMessage: (
        agentId: string,
        sessionId: string,
        message: import("../../domain/models/chat").ChatMessage
      ) => this.appendMessage(agentId, sessionId, message),
    });

    // 5. SessionLifecycle (depends on agentConnection, sessionState, promptExecution)
    this.sessionLifecycle = new SessionLifecycle({
      agentConnection: undefined as any,
      sessionState: this.sessionState,
      promptExecution: this.promptExecution,
      historyStore: null,
      sessionHistoryStore: null,
      emit: (event: string, ...args: unknown[]) => this.emit(event, ...args),
    });

    // 6. AgentConnection (depends on protocolHandler callbacks)
    this.agentConnection = new AgentConnection({
      ui: deps.ui,
      fs: deps.fs,
      onSessionUpdate: (agentId, notification) =>
        this.protocolHandler.handleSessionUpdate(agentId, notification),
      onRequestPermission: (agentId, request) =>
        this.protocolHandler.handleRequestPermission(agentId, request),
      onAgentDisconnected: (agentId) => {
        this.sessionState.removeAgent(agentId);
        this.emit("agentDisconnected", agentId);
      },
      onFileWrite: (event) => {
        this.emit("fileWrite", event);
      },
    });

    // Now update all cross-references
    (this.sessionOverview as any).deps.agentConnection = this.agentConnection;
    (this.protocolHandler as any).deps.agentConnection = this.agentConnection;
    (this.protocolHandler as any).deps.promptExecution = this.promptExecution;
    (this.promptExecution as any).deps.agentConnection = this.agentConnection;
    (this.sessionLifecycle as any).deps.agentConnection = this.agentConnection;
  }

  // ========================================================================
  // History Store (set after construction)
  // ========================================================================

  setHistoryStore(store: PersistentHistoryStore): void {
    this.historyStore = store;
    (this.sessionLifecycle as any).deps.historyStore = store;
    (this.protocolHandler as any).deps.historyStore = store;
  }

  setSessionHistoryStore(store: SessionHistoryStore): void {
    this.sessionHistoryStore = store;
    (this.sessionLifecycle as any).deps.sessionHistoryStore = store;
    (this.protocolHandler as any).deps.sessionHistoryStore = store;
  }

  // ========================================================================
  // Agent Connection Management
  // ========================================================================

  async connectAgent(agentId: string, config: AgentConfig): Promise<void> {
    if (this.agentConnection.isConnected(agentId)) {
      log.debug("agent already connected, skipping", { agentId });
      return;
    }

    this.sessionState.getOrCreateAgentSessions(agentId);

    await this.agentConnection.connect(agentId, config);

    // Initialize PromptBuilder for Mesh Protocol injection
    if (config.meshRole && config.meshProtocol?.enabled) {
      const meshConfig: MeshProtocolConfig = {
        enabled: true,
        version: config.meshProtocol.version ?? "2",
        role: config.meshRole,
        agentId: config.id,
        teamId: config.meshProtocol.teamId,
        teamName: config.meshProtocol.teamName,
      };
      this.sessionState.setPromptBuilder(
        agentId,
        new PromptBuilder(meshConfig)
      );
      log.info("Mesh Protocol prompt builder initialized", {
        agentId,
        role: config.meshRole,
        version: config.meshProtocol.version ?? "2",
      });
    }

    this.emit("agentConnected", agentId);
  }

  async disconnectAgent(agentId: string): Promise<void> {
    await this.agentConnection.disconnect(agentId);
    this.sessionState.removeAgent(agentId);
    this.emit("agentDisconnected", agentId);
  }

  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConnection.getAgentConfig(agentId);
  }

  getAgentInfo(agentId: string): AgentInfo | undefined {
    return this.agentConnection.getAgentInfo(agentId);
  }

  getConnection(
    agentId: string
  ): import("@agentclientprotocol/sdk").ClientSideConnection | undefined {
    return this.agentConnection.getConnection(agentId);
  }

  // ========================================================================
  // Session Management (1 agent → N sessions)
  // ========================================================================

  async createSession(agentId: string, cwd?: string): Promise<string> {
    const sessionId = await this.sessionLifecycle.createSession(agentId, cwd);
    this.sessionOverview.emitDebounced();
    this.emit("sessionCreated", { agentId, sessionId, cwd });
    return sessionId;
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    await this.sessionLifecycle.closeSession(agentId, sessionId);
    this.sessionOverview.emitDebounced();
    this.emit("sessionClosed", { agentId, sessionId });
  }

  renameSession(agentId: string, sessionId: string, title: string): void {
    this.sessionLifecycle.renameSession(agentId, sessionId, title);
    this.sessionOverview.emitDebounced();
    this.emit("sessionTitleChanged", { agentId, sessionId, title });
  }

  async forkSession(
    agentId: string,
    sourceSessionId: string
  ): Promise<RestoreResult> {
    const result = await this.sessionLifecycle.forkSession(
      agentId,
      sourceSessionId
    );
    this.sessionOverview.emitDebounced();
    return result;
  }

  async restoreSession(
    agentId: string,
    sourceSessionId: string,
    messages: import("../../domain/models/chat").ChatMessage[],
    cwd?: string
  ): Promise<RestoreResult> {
    const result = await this.sessionLifecycle.restoreSession(
      agentId,
      sourceSessionId,
      messages,
      cwd
    );
    this.sessionOverview.emitDebounced();
    return result;
  }

  // ========================================================================
  // Prompt
  // ========================================================================

  async prompt(
    agentId: string,
    sessionId: string,
    text: string,
    context?: import("./types").PromptContext
  ): Promise<import("./types").QueuedPrompt | undefined> {
    return this.promptExecution.send(agentId, sessionId, text, context);
  }

  async cancel(agentId: string, sessionId: string): Promise<void> {
    await this.promptExecution.cancel(agentId, sessionId);
  }

  // ========================================================================
  // Prompt Queue
  // ========================================================================

  getQueuedPrompts(
    agentId: string,
    sessionId: string
  ): import("./types").QueuedPrompt[] {
    return this.promptExecution.getQueuedPrompts(agentId, sessionId);
  }

  cancelQueuedPrompt(
    agentId: string,
    sessionId: string,
    promptId: string
  ): boolean {
    return this.promptExecution.cancelQueuedPrompt(
      agentId,
      sessionId,
      promptId
    );
  }

  reorderQueuedPrompts(
    agentId: string,
    sessionId: string,
    orderedIds: string[]
  ): void {
    this.promptExecution.reorderQueuedPrompts(agentId, sessionId, orderedIds);
  }

  // ========================================================================
  // Context Compression
  // ========================================================================

  handleContextCompression(
    agentId: string,
    sessionId: string,
    contextWindowMax: number,
    usedBefore: number,
    usedAfter: number
  ): void {
    this.promptExecution.handleContextCompression(
      agentId,
      sessionId,
      contextWindowMax,
      usedBefore,
      usedAfter
    );
  }

  // ========================================================================
  // Message Management
  // ========================================================================

  appendMessage(
    agentId: string,
    sessionId: string,
    message: import("../../domain/models/chat").ChatMessage
  ): void {
    const sessionInfo = this.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    sessionInfo.messages.push(message);
    sessionInfo.updatedAt = new Date();

    const msgToStore = this.serializeMessageForStorage(message);
    this.historyStore?.saveMessages(sessionId, [msgToStore]);

    this.persistSession(sessionId, agentId);
    this.syncSessionHistory(agentId, sessionId, message);
    this.sessionOverview.invalidateCounterCache(agentId, sessionId);
    this.sessionOverview.emitDebounced();

    this.emit("sessionMessage", { agentId, sessionId, message });
  }

  appendMessageSilent(
    agentId: string,
    sessionId: string,
    message: import("../../domain/models/chat").ChatMessage
  ): void {
    const sessionInfo = this.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;
    sessionInfo.messages.push(message);
    sessionInfo.updatedAt = new Date();
  }

  private syncSessionHistory(
    agentId: string,
    sessionId: string,
    lastMessage: import("../../domain/models/chat").ChatMessage
  ): void {
    if (!this.sessionHistoryStore) return;
    const sessionInfo = this.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;

    const entry: HistoryEntry = {
      sessionId,
      agentId,
      title: sessionInfo.title,
      cwd: sessionInfo.cwd,
      status: sessionInfo.status,
      createdAt: sessionInfo.createdAt.toISOString(),
      messageCount: sessionInfo.messages.length,
      tokenUsage: {
        input: sessionInfo.tokenUsage.input,
        output: sessionInfo.tokenUsage.output,
        total: sessionInfo.tokenUsage.total,
      },
      lastMessage: lastMessage.content || undefined,
    };
    void this.sessionHistoryStore.upsertEntry(entry);
  }

  private serializeMessageForStorage(
    msg: import("../../domain/models/chat").ChatMessage
  ): import("../../domain/models/chat").ChatMessage {
    const stored = { ...msg };
    if (msg.toolCalls) {
      (stored as any).toolCallsJson = JSON.stringify(msg.toolCalls);
    }
    return stored;
  }

  private persistSession(sessionId: string, agentId: string): void {
    const sessionInfo = this.sessionState.getSessionInfo(agentId, sessionId);
    if (sessionInfo) {
      this.historyStore?.saveSession(sessionInfo);
    }
  }

  // ========================================================================
  // Pinned Sessions
  // ========================================================================

  pinSession(agentId: string, sessionId: string): void {
    this.sessionState.pinSession(agentId, sessionId);
    this.emit("sessionPinned", { agentId, sessionId });
  }

  unpinSession(agentId: string, sessionId: string): void {
    this.sessionState.unpinSession(agentId, sessionId);
    this.emit("sessionUnpinned", { agentId, sessionId });
  }

  getPinnedSessions(agentId: string): string[] {
    return this.sessionState.getPinnedSessions(agentId);
  }

  isSessionPinned(agentId: string, sessionId: string): boolean {
    return this.sessionState.isSessionPinned(agentId, sessionId);
  }

  // ========================================================================
  // Active Session (per-agent)
  // ========================================================================

  getActiveSessionId(agentId: string): string | undefined {
    return this.sessionState.getActiveSessionId(agentId);
  }

  setActiveSession(agentId: string, sessionId: string): void {
    const agentSessions = this.sessionState.getAgentSessions(agentId);
    if (!agentSessions?.has(sessionId)) {
      log.warn("setActiveSession: session not found, skipping", {
        agentId,
        sessionId,
      });
      return;
    }
    this.sessionState.setActiveSession(agentId, sessionId);
    this.sessionOverview.emitDebounced();
    this.emit("sessionActiveChanged", { agentId, sessionId });
  }

  getActiveSessionInfo(
    agentId: string
  ): import("./types").AppSessionInfo | undefined {
    return this.sessionState.getActiveSessionInfo(agentId);
  }

  getSessionInfo(
    agentId: string,
    sessionId: string
  ): import("./types").AppSessionInfo | undefined {
    return this.sessionState.getSessionInfo(agentId, sessionId);
  }

  // ========================================================================
  // Session Listing
  // ========================================================================

  getSessionsForAgent(agentId: string): import("./types").AppSessionInfo[] {
    return this.sessionState.getSessionsForAgent(agentId);
  }

  getAllSessions(): Map<string, import("./types").AppSessionInfo[]> {
    return this.sessionState.getAllSessions();
  }

  findSessionGlobally(
    sessionId: string
  ): { agentId: string; info: import("./types").AppSessionInfo } | undefined {
    return this.sessionState.findSessionGlobally(sessionId);
  }

  // ========================================================================
  // Cross-Agent Operations
  // ========================================================================

  async promptSession(
    sessionId: string,
    text: string,
    context?: import("./types").PromptContext,
    agentId?: string
  ): Promise<void> {
    if (agentId) {
      void this.prompt(agentId, sessionId, text, context);
      return;
    }
    const found = this.sessionState.findSessionGlobally(sessionId);
    if (!found)
      throw new Error(`Session ${sessionId} not found in any connected agent`);
    void this.prompt(found.agentId, sessionId, text, context);
  }

  async cancelSession(sessionId: string, agentId?: string): Promise<void> {
    if (agentId) return this.cancel(agentId, sessionId);
    const found = this.sessionState.findSessionGlobally(sessionId);
    if (!found)
      throw new Error(`Session ${sessionId} not found in any connected agent`);
    return this.cancel(found.agentId, sessionId);
  }

  appendMessageToSession(
    sessionId: string,
    message: import("../../domain/models/chat").ChatMessage,
    agentId?: string
  ): void {
    if (agentId) return this.appendMessage(agentId, sessionId, message);
    const found = this.sessionState.findSessionGlobally(sessionId);
    if (!found)
      throw new Error(`Session ${sessionId} not found in any connected agent`);
    return this.appendMessage(found.agentId, sessionId, message);
  }

  // ========================================================================
  // Status
  // ========================================================================

  getAllAgents(): AgentStatus[] {
    const result: AgentStatus[] = [];
    const seenAgentIds = new Set<string>();

    for (const agentId of this.agentConnection.getAgentIds()) {
      result.push(this.getAgentStatus(agentId));
      seenAgentIds.add(agentId);
    }
    // Also handle agents that may have been removed from agentConfigs
    // but still have sessions
    for (const [agentId] of this.sessionState.getAllSessions()) {
      if (!seenAgentIds.has(agentId)) {
        result.push(this.getAgentStatus(agentId));
      }
    }
    return result;
  }

  getAgentStatus(agentId: string, config?: AgentConfig): AgentStatus {
    const resolvedConfig =
      config ?? this.agentConnection.getAgentConfig(agentId);
    if (!resolvedConfig) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const connection = this.agentConnection.getConnection(agentId);
    const agentSessions = this.sessionState.getAgentSessions(agentId);
    const activeSessionId = this.sessionState.getActiveSessionId(agentId);

    const sessions: SessionStatusInfo[] = [];
    let totalTokenUsage = { input: 0, output: 0, total: 0 };
    let lastActivity = new Date(0);

    if (agentSessions) {
      for (const [sessionId, info] of agentSessions) {
        sessions.push({
          sessionId,
          title: info.title,
          status: info.status,
          lastTurnOutcome: info.lastTurnOutcome,
          isActive: sessionId === activeSessionId,
          messageCount: info.messages.length,
          tokenUsage: info.tokenUsage,
          contextWindowMax: info.contextWindowMax,
          cwd: info.cwd,
          model: info.model,
          mode: info.mode,
          pinned: this.sessionState.isSessionPinned(agentId, sessionId),
        });
        totalTokenUsage = {
          input: totalTokenUsage.input + info.tokenUsage.input,
          output: totalTokenUsage.output + info.tokenUsage.output,
          total: totalTokenUsage.total + info.tokenUsage.total,
        };
        if (info.updatedAt > lastActivity) lastActivity = info.updatedAt;
      }
    }

    let state: AgentConnectionState = "disconnected";
    if (connection) {
      const proc = this.agentConnection.getProcess(agentId);
      if (proc && proc.exitCode === null) {
        const hasRunning = sessions.some((s) => s.status === "running");
        state = hasRunning ? "busy" : "idle";
      } else {
        state = "disconnected";
      }
    }

    return {
      agentId,
      state,
      sessions,
      activeSessionId,
      totalTokenUsage,
      lastActivity,
    };
  }

  // ========================================================================
  // Session Overview
  // ========================================================================

  getSessionOverview(
    opts: { withRecentResponses?: boolean } = {}
  ): ReturnType<SessionOverview["compute"]> {
    return this.sessionOverview.compute(opts);
  }

  triggerOverviewUpdate(): void {
    this.sessionOverview.emitDebounced();
  }

  // ========================================================================
  // Session Commands
  // ========================================================================

  getSessionCommands(
    agentId: string,
    sessionId: string
  ): import("@agentclientprotocol/sdk").AvailableCommand[] {
    return this.protocolHandler.getSessionCommands(
      sessionKey(agentId, sessionId)
    );
  }

  // Allow protocolHandler to access historyStore
  getHistoryStore(): PersistentHistoryStore | null {
    return this.historyStore;
  }

  getSessionHistoryStore(): SessionHistoryStore | null {
    return this.sessionHistoryStore;
  }

  // ========================================================================
  // Passthrough methods for backward compatibility (tests + external callers)
  // ========================================================================

  /** Passthrough to protocolHandler.handleSessionUpdate — for tests */
  handleSessionUpdate(
    agentId: string,
    notification: import("@agentclientprotocol/sdk").SessionNotification
  ): void {
    this.protocolHandler.handleSessionUpdate(agentId, notification);
  }

  /** Passthrough to sessionLifecycle — for tests */
  chatMessageToContentBlocks(
    msg: import("../../domain/models/chat").ChatMessage
  ): import("@agentclientprotocol/sdk").ContentBlock[] {
    return this.sessionLifecycle.chatMessageToContentBlocks(msg);
  }

  /** Alias for triggerOverviewUpdate — backward compat */
  emitOverviewUpdate(): void {
    this.triggerOverviewUpdate();
  }

  // ========================================================================
  // Test Helpers — expose internal state for unit tests
  // ========================================================================

  /** Expose internal session state maps for testing */
  getInternalState(): {
    sessions: Map<string, Map<string, AppSessionInfo>>;
    streamTextBuffer: Map<string, string>;
    streamMsgRef: Map<
      string,
      { agentId: string; sessionId: string; msgId: string }
    >;
    agentInfoMap: Map<string, AgentInfo>;
    agentConfigs: Map<string, AgentConfig>;
    protocolHandler: ProtocolHandler;
    connections: Map<
      string,
      import("@agentclientprotocol/sdk").ClientSideConnection
    >;
  } {
    return {
      sessions: this.sessionState["sessions"],
      streamTextBuffer: this.sessionState["streamTextBuffer"],
      streamMsgRef: this.sessionState["streamMsgRef"],
      agentInfoMap: this.agentConnection["agentInfoMap"],
      agentConfigs: this.agentConnection["agentConfigs"],
      protocolHandler: this.protocolHandler,
      connections: this.agentConnection["connections"],
    };
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    // Flush all pending sessions to persistent storage
    const allSessions = this.sessionState.getAllSessions();
    for (const [, agentSessions] of allSessions) {
      for (const sessionInfo of agentSessions) {
        this.historyStore?.saveSession(sessionInfo);
        if (sessionInfo.messages.length > 0) {
          const msgs = sessionInfo.messages.map((m) =>
            this.serializeMessageForStorage(m)
          );
          this.historyStore?.saveMessages(sessionInfo.sessionId, msgs);
        }
      }
    }
    this.historyStore?.dispose();
    this.agentConnection.dispose();
    this.sessionState.dispose();
    this.sessionOverview.cancelDebounce();
    this.removeAllListeners();
  }
}
