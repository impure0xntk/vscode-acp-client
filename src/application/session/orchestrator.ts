import { EventEmitter } from "events";
import { abbreviatePath } from "../../shared/util/path";
import { getLogger } from "../../platform/backends";

const log = getLogger("orchestrator");
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  SessionNotification,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  CancelNotification,
  InitializeRequest,
  InitializeResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ReleaseTerminalRequest,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  LoadSessionRequest,
  ListSessionsRequest,
} from "@agentclientprotocol/sdk";
import * as child_process from "child_process";
import { Readable, Writable } from "stream";
import type { SessionInfo, SessionStatus, TurnOutcome, QueuedPrompt } from "./types";
import type {
  ChatMessage,
  TokenUsage,
  ToolCall,
} from "../../domain/models/chat";
import type {
  ContentBlock,
  ToolCallContent,
  AvailableCommand,
} from "@agentclientprotocol/sdk";
import type { PersistentHistoryStore } from "./persistentHistory";
import type { SessionHistoryStore, HistoryEntry } from "./historyStore";

// ============================================================================
// Background session completion event
// ============================================================================

export interface SessionCompletedEvent {
  agentId: string;
  sessionId: string;
  title: string;
}
import { PlatformAcpClient } from "../../adapter/acp/client";
import type { UIAPI } from "../../platform/ui";
import type { FileSystemAPI } from "../../platform/filesystem";

// ============================================================================
// Auto-connect entry (one chat tab)
// ============================================================================

export interface AutoConnectEntry {
  /** Workspace folder path for this session (absolute, or relative to workspace root) */
  workspace?: string;
  /** Human-readable session title (defaults to workspace folder name) */
  sessionName?: string;
}

// ============================================================================
// Agent Config
// ============================================================================

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /**
   * Auto-connect entries. Each entry creates one chat tab on startup.
   * Omit or empty array to disable auto-connect.
   */
  autoConnect?: AutoConnectEntry[];
  /** If true, automatically open the chat panel when this agent auto-connects (default: true) */
  openChat?: boolean;
  icon?: string;
  color?: string;
  maxConcurrentSessions?: number;
}

// ============================================================================
// Agent Status
// ============================================================================

export type AgentConnectionState =
  | "connecting"
  | "connected"
  | "idle"
  | "busy"
  | "error"
  | "disconnected";

export interface SessionStatusInfo {
  sessionId: string;
  title: string;
  status: SessionStatus;
  lastTurnOutcome: TurnOutcome | null;
  isActive: boolean;
  messageCount: number;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  cwd?: string;
  model?: string;
  mode?: string;
}

export interface AgentStatus {
  agentId: string;
  state: AgentConnectionState;
  sessions: SessionStatusInfo[];
  activeSessionId?: string;
  totalTokenUsage: TokenUsage;
  lastError?: string;
  lastActivity: Date;
}

// ============================================================================
// Agent Info (from InitializeResponse)
// ============================================================================

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

// ============================================================================
// Prompt Context (for @file, @selection, @diff)
// ============================================================================

export type PromptContext = ContentBlock[];

// ============================================================================
// Session Restore Result
// ============================================================================

export interface RestoreResult {
  /** New session ID for the restored session */
  sessionId: string;
  /** Whether native session/load was used (true) or bridge replay (false) */
  nativeRestore: boolean;
  /** Number of messages replayed (0 if native restore) */
  replayedMessageCount: number;
}

// ============================================================================
// Session key helper
// ============================================================================

export function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

// ============================================================================
// Session Orchestrator
// ============================================================================

export interface OrchestratorDeps {
  ui: UIAPI;
  fs: FileSystemAPI;
}

export class SessionOrchestrator extends EventEmitter {
  private deps: OrchestratorDeps;
  // agentId → ClientSideConnection
  private connections: Map<string, ClientSideConnection> = new Map();
  // agentId → child process (for cleanup)
  private processes: Map<string, child_process.ChildProcess> = new Map();
  // agentId → (sessionId → SessionInfo)
  private sessions: Map<string, Map<string, SessionInfo>> = new Map();
  // agentId → sessionId (active session per agent)
  private activeSessions: Map<string, string> = new Map();
  // agentId → AgentConfig
  private agentConfigs: Map<string, AgentConfig> = new Map();
  // Track emitted tool call IDs to prevent duplicates
  private emittedToolCallIds: Set<string> = new Set();
  // Buffer tool calls within a single agent turn, grouped by kind
  // Key: `${agentId}:${sessionId}` → Map<kind, ToolCall[]>
  private pendingToolCalls: Map<string, Map<string, ToolCall[]>> = new Map();
  // agentId → AgentInfo (from InitializeResponse)
  private agentInfoMap: Map<string, AgentInfo> = new Map();
  // sessionKey(agentId, sessionId) → AvailableCommand[]
  private sessionCommands: Map<string, AvailableCommand[]> = new Map();
  // Persistent history store (SQLite)
  private historyStore: PersistentHistoryStore | null = null;
  // Session history store (globalState — metadata for history view)
  private sessionHistoryStore: SessionHistoryStore | null = null;
  // Debounce timer for session overview updates
  private sessionOverviewDebounceTimer: ReturnType<typeof setTimeout> | null =
    null;
  // Prompt queue: sessionKey(agentId, sessionId) → QueuedPrompt[]
  private promptQueue: Map<string, QueuedPrompt[]> = new Map();

  constructor(deps: OrchestratorDeps) {
    super();
    this.deps = deps;
  }

  // ========================================================================
  // History Store
  // ========================================================================

  setHistoryStore(store: PersistentHistoryStore): void {
    this.historyStore = store;
  }

  setSessionHistoryStore(store: SessionHistoryStore): void {
    this.sessionHistoryStore = store;
  }

  // ========================================================================
  // Agent Connection Management
  // ========================================================================

  async connectAgent(agentId: string, config: AgentConfig): Promise<void> {
    if (this.connections.has(agentId)) {
      log.debug("agent already connected, skipping", { agentId });
      return;
    }

    log.info("connecting agent", { agentId, command: config.command, args: config.args });

    this.agentConfigs.set(agentId, config);
    this.sessions.set(agentId, new Map());

    // Spawn the agent process
    const proc = child_process.spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    log.debug("agent process spawned", { agentId, pid: proc.pid });
    this.processes.set(agentId, proc);

    // Convert Node.js streams to Web Streams for ndJsonStream
    const stdinWritable = Writable.toWeb(
      proc.stdin
    ) as WritableStream<Uint8Array>;
    const stdoutReadable = Readable.toWeb(
      proc.stdout
    ) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(stdinWritable, stdoutReadable);

    // Create the VS Code client implementation
    const client = new PlatformAcpClient(
      { fs: this.deps.fs, ui: this.deps.ui },
      (aId, notification) => this.handleSessionUpdate(aId, notification),
      (aId, request) => this.handleRequestPermission(aId, request)
    );
    client.setAgentId(agentId);

    const connection = new ClientSideConnection(() => client, stream);
    this.connections.set(agentId, connection);

    // Handle process exit
    proc.on("close", (code) => {
      log.info("agent process exited", { agentId, exitCode: code });
      this.handleAgentDisconnected(agentId);
    });
    proc.on("error", (err) => {
      log.error("agent process error", { agentId }, err);
    });

    // Initialize the connection — request embeddedContext so the agent
    // advertises support for ContentBlock::Resource in prompt requests.
    log.debug("sending initialize", { agentId, protocolVersion: PROTOCOL_VERSION });
    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    } satisfies InitializeRequest);

    if (!initResponse) {
      log.error("initialize returned no response", { agentId });
      throw new Error("Failed to initialize agent connection");
    }

    // Store agent info from InitializeResponse
    const sc = initResponse.agentCapabilities?.sessionCapabilities;
    this.agentInfoMap.set(agentId, {
      name: initResponse.agentInfo?.name ?? agentId,
      title: initResponse.agentInfo?.title ?? undefined,
      version: initResponse.agentInfo?.version ?? undefined,
      protocolVersion: initResponse.protocolVersion,
      capabilities: initResponse.agentCapabilities
        ? {
            loadSession: initResponse.agentCapabilities.loadSession ?? false,
            promptCapabilities: initResponse.agentCapabilities
              .promptCapabilities
              ? {
                  image:
                    initResponse.agentCapabilities.promptCapabilities.image ??
                    false,
                  audio:
                    initResponse.agentCapabilities.promptCapabilities.audio ??
                    false,
                  embeddedContext:
                    initResponse.agentCapabilities.promptCapabilities
                      .embeddedContext ?? false,
                }
              : undefined,
            sessionCapabilities: sc
              ? {
                  fork: sc.fork != null,
                  list: sc.list != null,
                  resume: sc.resume != null,
                  delete: sc.delete != null,
                  close: sc.close != null,
                  additionalDirectories: sc.additionalDirectories != null,
                }
              : undefined,
          }
        : undefined,
    });

    log.info("agent connected", {
      agentId,
      name: initResponse.agentInfo?.name,
      version: initResponse.agentInfo?.version,
      protocolVersion: initResponse.protocolVersion,
      loadSession: initResponse.agentCapabilities?.loadSession ?? false,
    });

    this.emit("agentConnected", agentId);
  }

  async disconnectAgent(agentId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      log.debug("disconnectAgent: not connected", { agentId });
      return;
    }

    log.info("disconnecting agent", { agentId });

    this.connections.delete(agentId);

    const proc = this.processes.get(agentId);
    if (proc) {
      proc.kill();
      this.processes.delete(agentId);
      log.debug("agent process killed", { agentId, pid: proc.pid });
    }

    const sessionCount = this.sessions.get(agentId)?.size ?? 0;
    this.sessions.delete(agentId);
    this.activeSessions.delete(agentId);
    this.agentConfigs.delete(agentId);
    this.agentInfoMap.delete(agentId);

    log.info("agent disconnected", { agentId, sessionsCleared: sessionCount });
    this.emit("agentDisconnected", agentId);
  }

  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.get(agentId);
  }

  getAgentInfo(agentId: string): AgentInfo | undefined {
    return this.agentInfoMap.get(agentId);
  }

  getSessionCommands(agentId: string, sessionId: string): AvailableCommand[] {
    return this.sessionCommands.get(sessionKey(agentId, sessionId)) ?? [];
  }

  getConnection(agentId: string): ClientSideConnection | undefined {
    return this.connections.get(agentId);
  }

  // ========================================================================
  // Session Management (1 agent → N sessions)
  // ========================================================================

  async createSession(agentId: string, cwd?: string): Promise<string> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      log.error("createSession: agent not connected", { agentId });
      throw new Error(`Agent ${agentId} is not connected`);
    }

    const effectiveCwd = cwd ?? process.cwd();
    log.info("creating session", { agentId, cwd: effectiveCwd });

    const response = await connection.newSession({
      cwd: effectiveCwd,
      mcpServers: [],
    } satisfies NewSessionRequest);

    const sessionId = response.sessionId;
    const now = new Date();

    const sessionInfo: SessionInfo = {
      sessionId,
      agentId,
      title: abbreviatePath(effectiveCwd),
      cwd: effectiveCwd,
      status: "idle",
      lastTurnOutcome: null,
      messages: [],
      isStreaming: false,
      createdAt: now,
      updatedAt: now,
      lastResponseAt: null,
      tokenUsage: { input: 0, output: 0, total: 0 },
      pendingCancel: false,
      _prevContextUsed: 0,
    };

    const agentSessions = this.sessions.get(agentId)!;
    agentSessions.set(sessionId, sessionInfo);

    // Auto-activate if this is the first session for this agent
    if (!this.activeSessions.has(agentId)) {
      this.activeSessions.set(agentId, sessionId);
      this.emit("sessionActiveChanged", { agentId, sessionId });
    }

    // Persist session metadata
    this.persistSession(sessionId, agentId);

    log.info("session created", { agentId, sessionId, cwd: effectiveCwd });
    this.emit("sessionCreated", { agentId, sessionId, cwd: effectiveCwd });
    this.emitOverviewUpdate();
    return sessionId;
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      log.debug("closeSession: agent not connected", { agentId, sessionId });
      return;
    }

    log.info("closing session", { agentId, sessionId });

    try {
      await connection.closeSession({ sessionId });
    } catch {
      // Not all agents support session/close
    }

    const agentSessions = this.sessions.get(agentId);
    if (agentSessions) {
      agentSessions.delete(sessionId);
    }

    // If this was the active session, clear it
    if (this.activeSessions.get(agentId) === sessionId) {
      this.activeSessions.delete(agentId);
      // Activate another session if available
      const remaining = this.getSessionsForAgent(agentId);
      if (remaining.length > 0) {
        const newActive = remaining[0].sessionId;
        this.activeSessions.set(agentId, newActive);
        this.emit("sessionActiveChanged", { agentId, sessionId: newActive });
      }
    }

    // Clear any queued prompts for the closed session
    const qKey = sessionKey(agentId, sessionId);
    if (this.promptQueue.has(qKey)) {
      this.promptQueue.delete(qKey);
      this.emit("promptQueueUpdated", { agentId, sessionId, queue: [] });
    }

    log.info("session closed", { agentId, sessionId });
    this.emit("sessionClosed", { agentId, sessionId });
    this.emitOverviewUpdate();
  }

  // ========================================================================
  // Session Fork
  // ========================================================================

  /**
   * Fork an active session into a new one, replaying the full conversation
   * so the agent reconstructs identical context.
   *
   * Unlike restore (which loads persisted history from SQLite), fork operates
   * on a live in-memory session. Strategy:
   * 1. Copy ALL messages (including tool/system) to the new session's
   *    in-memory state so the webview renders the full history immediately.
   * 2. Then replay user+agent messages via session/prompt so the agent
   *    reconstructs its internal context window.
   *    (loadSession is not used for forks because the source session is
   *    still active and the agent may not support re-loading a live session.)
   *
   * @param agentId         The agent that owns the source session.
   * @param sourceSessionId The active session to fork from.
   * @returns RestoreResult (nativeRestore is always false for forks).
   */
  async forkSession(
    agentId: string,
    sourceSessionId: string
  ): Promise<RestoreResult> {
    const sourceInfo = this.getSessionInfo(agentId, sourceSessionId);
    if (!sourceInfo) {
      throw new Error(
        `Session ${sourceSessionId} not found for agent ${agentId}`
      );
    }

    const allMessages = sourceInfo.messages.map((m) => ({
      ...m,
      id: m.id || crypto.randomUUID(),
    }));

    const newSessionId = await this.createSession(agentId, sourceInfo.cwd);

    const newInfo = this.getSessionInfo(agentId, newSessionId);
    if (newInfo) {
      newInfo.messages = allMessages;
      newInfo.title = `${sourceInfo.title} (fork)`;
    }

    const replayable = allMessages.filter(
      (m) => m.role === "user" || m.role === "agent"
    );
    let replayed = 0;
    if (replayable.length > 0) {
      this.emit("sessionReplayStart", {
        agentId,
        sessionId: newSessionId,
        totalMessages: replayable.length,
        currentIndex: 0,
      });

      replayed = await this.replayMessages(
        agentId,
        newSessionId,
        replayable
      );

      this.emit("sessionReplayComplete", {
        agentId,
        sessionId: newSessionId,
        replayedMessageCount: replayed,
      });
    }

    return {
      sessionId: newSessionId,
      nativeRestore: false,
      replayedMessageCount: replayed,
    };
  }

  // ========================================================================
  // Session Restore
  // ========================================================================

  /**
   * Restore a historical session by replaying its messages into a new session.
   *
   * Strategy:
   * 1. If the agent advertises `loadSession`, use native `session/load` for
   *    exact state restoration (agent replays internally).
   * 2. Otherwise, fall back to bridge replay: create a new session then
   *    re-send each stored user message via `session/prompt` so the agent
   *    reconstructs the conversation context.
   *
   * @param agentId   The agent that originally owned the session.
   * @param sourceSessionId  The historical session ID to restore from.
   * @param messages  Pre-fetched messages (from PersistentHistoryStore).
   * @returns RestoreResult with the new session ID and replay metadata.
   */
  async restoreSession(
    agentId: string,
    sourceSessionId: string,
    messages: ChatMessage[],
    cwd?: string
  ): Promise<RestoreResult> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      throw new Error(`Agent ${agentId} is not connected`);
    }

    const agentInfo = this.agentInfoMap.get(agentId);
    const sourceInfo = this.getSessionInfo(agentId, sourceSessionId);
    const effectiveCwd = cwd ?? sourceInfo?.cwd ?? process.cwd();

    // --- Strategy 1: Native session/load ---
    if (agentInfo?.capabilities?.loadSession) {
      // loadSession restores the agent-side session state.
      // The agent replays the conversation history internally.
      // We use the SAME sessionId (the agent recognizes it).
      await connection.loadSession({
        sessionId: sourceSessionId,
        cwd: effectiveCwd,
        mcpServers: [],
      } satisfies LoadSessionRequest);

      const now = new Date();

      // Populate messages from the stored history so the webview can
      // render the conversation immediately on session switch.
      const restoredMessages = messages.map((m) => ({
        ...m,
        id: m.id || crypto.randomUUID(),
      }));

      const sessionInfo: SessionInfo = {
        sessionId: sourceSessionId,
        agentId,
        title: sourceInfo?.title ?? `Restored ${sourceSessionId.slice(0, 8)}`,
        cwd: effectiveCwd,
        status: "idle",
        lastTurnOutcome: null,
        messages: restoredMessages,
        isStreaming: false,
        createdAt: now,
        updatedAt: now,
        lastResponseAt: null,
        tokenUsage: { input: 0, output: 0, total: 0 },
        pendingCancel: false,
      };

      const agentSessions = this.sessions.get(agentId) ?? new Map();
      agentSessions.set(sourceSessionId, sessionInfo);
      this.sessions.set(agentId, agentSessions);

      if (!this.activeSessions.has(agentId)) {
        this.activeSessions.set(agentId, sourceSessionId);
        this.emit("sessionActiveChanged", {
          agentId,
          sessionId: sourceSessionId,
        });
      }

      this.persistSession(sourceSessionId, agentId);
      this.emit("sessionCreated", {
        agentId,
        sessionId: sourceSessionId,
        cwd: effectiveCwd,
      });
      this.emitOverviewUpdate();

      return {
        sessionId: sourceSessionId,
        nativeRestore: true,
        replayedMessageCount: 0,
      };
    }

    // --- Strategy 2: Bridge replay ---
    const newSessionId = await this.createSession(agentId, effectiveCwd);

    // Populate messages from stored history BEFORE replay so the webview
    // has the full conversation context immediately.
    const newInfo = this.getSessionInfo(agentId, newSessionId);
    if (newInfo) {
      newInfo.messages = messages.map((m) => ({
        ...m,
        id: m.id || crypto.randomUUID(),
      }));
    }

    const replayed = await this.replayMessages(
      agentId,
      newSessionId,
      messages
    );

    // Update title to indicate restoration
    if (newInfo && sourceInfo) {
      newInfo.title = sourceInfo.title;
    }

    return {
      sessionId: newSessionId,
      nativeRestore: false,
      replayedMessageCount: replayed,
    };
  }

  /**
   * Replay stored user+agent messages into a new session via session/prompt.
   *
   * User and agent messages are replayed to reconstruct the conversation
   * context. Tool and system messages are skipped since they are side-effects
   * of agent turns and will be regenerated.
   *
   * @returns Number of messages replayed.
   */
  private async replayMessages(
    agentId: string,
    sessionId: string,
    messages: ChatMessage[]
  ): Promise<number> {
    // Replay only user + agent messages. Tool messages are excluded because
    // they represent side-effects of agent turns (file writes, command output,
    // search results) that have already been applied — re-sending them would
    // cause duplicate writes or stale tool results in the new session.
    // System messages are infrastructure-level context, not part of conversation.
    const replayable = messages.filter(
      (m) => m.role === "user" || m.role === "agent"
    );
    if (replayable.length === 0) return 0;

    let replayed = 0;
    for (const msg of replayable) {
      const blocks = this.chatMessageToContentBlocks(msg);

      this.emit("sessionReplayStart", {
        agentId,
        sessionId,
        totalMessages: replayable.length,
        currentIndex: replayed,
      });

      try {
        await withTimeout(
          this.prompt(agentId, sessionId, "", blocks),
          30_000,
          `replay message ${msg.id}`
        );
        replayed++;
      } catch (e) {
        log.warn("replay message failed", {
          agentId,
          sessionId,
          messageId: msg.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      this.emit("sessionReplayProgress", {
        agentId,
        sessionId,
        totalMessages: replayable.length,
        currentIndex: replayed,
      });
    }

    this.emit("sessionReplayComplete", {
      agentId,
      sessionId,
      replayedMessageCount: replayed,
    });

    return replayed;
  }

  /**
   * Convert a stored ChatMessage into ACP ContentBlock[] suitable for
   * session/prompt. Handles text content, inline file paths, and
   * serialized attachments.
   */
  private chatMessageToContentBlocks(msg: ChatMessage): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    // Inline file paths → resource_link blocks
    if (msg.inlineFilePaths) {
      for (const fp of msg.inlineFilePaths) {
        blocks.push({
          type: "resource_link",
          uri: fp,
          name: fp,
        });
      }
    }

    // Attachments → embedded resource blocks (from serialized JSON)
    if (msg.attachmentsJson) {
      try {
        const attachments = JSON.parse(msg.attachmentsJson) as Array<{
          type: string;
          path: string;
          content: string;
        }>;
        for (const att of attachments) {
          if (att.type === "file" || att.type === "selection") {
            blocks.push({
              type: "resource",
              resource: {
                uri: att.path,
                text: att.content,
              },
            });
          }
        }
      } catch {
        // Ignore malformed attachment JSON
      }
    }

    // Main text content
    if (msg.content) {
      blocks.push({ type: "text", text: msg.content });
    }

    return blocks;
  }

  /**
   * Send a prompt to an agent session.
   *
   * If the session's turn is already active, the prompt is queued and will
   * be sent automatically when the current turn completes. The webview is
   * notified via the "promptQueued" event so it can reflect the queued state.
   *
   * @returns The QueuedPrompt entry (for queued sends) or undefined (for immediate sends).
   */
  async prompt(
    agentId: string,
    sessionId: string,
    text: string,
    context?: PromptContext
  ): Promise<QueuedPrompt | undefined> {
    const agentSessions = this.sessions.get(agentId);
    const sessionInfo = agentSessions?.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    // If a turn is active, enqueue instead of sending immediately.
    // This ensures messages sent during an active turn are stacked and
    // delivered in order after the turn completes, even if the user
    // switches to a different session tab meanwhile.
    if (sessionInfo.status === "running") {
      const entry: QueuedPrompt = {
        id: crypto.randomUUID(),
        agentId,
        sessionId,
        text,
        context,
        enqueuedAt: new Date().toISOString(),
        status: "pending",
      };

      const key = sessionKey(agentId, sessionId);
      const queue = this.promptQueue.get(key) ?? [];
      queue.push(entry);
      this.promptQueue.set(key, queue);

      this.emit("promptQueued", { agentId, sessionId, entry });
      return entry;
    }

    // Turn is idle — send immediately
    await this._executePrompt(agentId, sessionId, text, context);
    return undefined;
  }

  /**
   * Internal prompt execution — sends to the agent and manages turn lifecycle.
   */
  private async _executePrompt(
    agentId: string,
    sessionId: string,
    text: string,
    context?: PromptContext
  ): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      log.error("_executePrompt: agent not connected", { agentId, sessionId });
      throw new Error(`Agent ${agentId} is not connected`);
    }

    const agentSessions = this.sessions.get(agentId);
    const sessionInfo = agentSessions?.get(sessionId);
    if (!sessionInfo) {
      log.error("_executePrompt: session not found", { agentId, sessionId });
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    log.info("sending prompt", {
      agentId,
      sessionId,
      textLen: text.length,
      contextBlocks: context?.length ?? 0,
    });

    sessionInfo.status = "running";
    sessionInfo.lastTurnOutcome = null;
    sessionInfo.updatedAt = new Date();
    sessionInfo.isStreaming = true;
    log.debug("turn started", { agentId, sessionId });

    const promptBlocks: ContentBlock[] = [
      ...(context ?? []),
      { type: "text", text },
    ];

    try {
      const response = await connection.prompt({
        sessionId,
        prompt: promptBlocks,
      } satisfies PromptRequest);

      if (response.usage) {
        sessionInfo.tokenUsage = {
          input: response.usage.inputTokens ?? sessionInfo.tokenUsage.input,
          output: response.usage.outputTokens ?? sessionInfo.tokenUsage.output,
          total: response.usage.totalTokens ?? sessionInfo.tokenUsage.total,
        };
      }

      log.info("prompt response received", {
        agentId,
        sessionId,
        tokens: sessionInfo.tokenUsage,
      });

      sessionInfo.lastTurnOutcome = "completed";
      sessionInfo.isStreaming = false;
      sessionInfo.lastResponseAt = new Date().toISOString();
      this.flushPendingToolCalls(agentId, sessionId);
      log.info("turn completed", { agentId, sessionId, tokens: sessionInfo.tokenUsage });
      this.emit("sessionCompleted", {
        agentId,
        sessionId,
        title: sessionInfo.title,
      });
    } catch (e) {
      sessionInfo.lastTurnOutcome = "error";
      sessionInfo.isStreaming = false;
      log.warn("turn error", {
        agentId,
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    } finally {
      sessionInfo.status = "idle";
      sessionInfo.updatedAt = new Date();

      this.emit("sessionTurnActiveChanged", {
        agentId,
        sessionId,
        active: false,
      });

      // Process next queued prompt for this session, if any.
      // Fire-and-forget: don't block the current turn's completion.
      this._processNextInQueue(agentId, sessionId);
    }
  }

  /**
   * Dequeue and send the next prompt for a session after its turn completes.
   *
   * The queue is keyed by sessionKey(agentId, sessionId), so switching
   * sessions in the UI does not affect which session receives the queued
   * prompt. Each entry carries the original agentId and sessionId.
   */
  private async _processNextInQueue(
    agentId: string,
    sessionId: string
  ): Promise<void> {
    const key = sessionKey(agentId, sessionId);
    const queue = this.promptQueue.get(key);
    if (!queue || queue.length === 0) return;

    // Another turn may have started (e.g., from a different caller) — skip
    const sessionInfo = this.getSessionInfo(agentId, sessionId);
    if (!sessionInfo || sessionInfo.status === "running") return;

    const next = queue.shift()!;
    next.status = "sending";
    this.emit("promptDequeued", { agentId, sessionId, entry: next });

    try {
      await this._executePrompt(next.agentId, next.sessionId, next.text, next.context);
      next.status = "sent";
    } catch (e) {
      next.status = "cancelled";
      throw e;
    } finally {
      // Clean up empty queues to prevent memory leaks
      if (queue.length === 0) {
        this.promptQueue.delete(key);
      }
      this.emit("promptQueueUpdated", {
        agentId,
        sessionId,
        queue: [...(this.promptQueue.get(key) ?? [])],
      });
    }
  }

  async cancel(agentId: string, sessionId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) return;

    const agentSessions = this.sessions.get(agentId);
    const sessionInfo = agentSessions?.get(sessionId);
    if (sessionInfo) {
      sessionInfo.pendingCancel = true;
      sessionInfo.isStreaming = false;
      sessionInfo.status = "idle";
      sessionInfo.lastTurnOutcome = "cancelled";
      sessionInfo.updatedAt = new Date();

      this.emit("sessionTurnActiveChanged", {
        agentId,
        sessionId,
        active: false,
      });

      log.info("turn cancelled", { agentId, sessionId });
    }

    await connection.cancel({ sessionId } satisfies CancelNotification);
  }

  // ========================================================================
  // Prompt Queue
  // ========================================================================

  /**
   * Get the current prompt queue for a session.
   * Returns a copy to prevent external mutation.
   */
  getQueuedPrompts(agentId: string, sessionId: string): QueuedPrompt[] {
    const key = sessionKey(agentId, sessionId);
    return [...(this.promptQueue.get(key) ?? [])];
  }

  /**
   * Cancel a specific queued prompt by ID.
   * Only "pending" entries can be cancelled; "sending" entries cannot.
   */
  cancelQueuedPrompt(
    agentId: string,
    sessionId: string,
    promptId: string
  ): boolean {
    const key = sessionKey(agentId, sessionId);
    const queue = this.promptQueue.get(key);
    if (!queue) return false;

    const idx = queue.findIndex(
      (e) => e.id === promptId && e.status === "pending"
    );
    if (idx === -1) return false;

    queue.splice(idx, 1);
    if (queue.length === 0) {
      this.promptQueue.delete(key);
    }

    this.emit("promptQueueUpdated", {
      agentId,
      sessionId,
      queue: [...(this.promptQueue.get(key) ?? [])],
    });
    return true;
  }

  /**
   * Reorder queued prompts by specifying the desired order of IDs.
   * Only "pending" entries are affected; "sending" entries stay in place.
   */
  reorderQueuedPrompts(
    agentId: string,
    sessionId: string,
    orderedIds: string[]
  ): void {
    const key = sessionKey(agentId, sessionId);
    const queue = this.promptQueue.get(key);
    if (!queue) return;

    const pending = queue.filter((e) => e.status === "pending");
    const sending = queue.filter((e) => e.status !== "pending");

    const reordered = orderedIds
      .map((id) => pending.find((e) => e.id === id))
      .filter((e): e is QueuedPrompt => e !== undefined);

    // Append any pending entries not in orderedIds (safety net)
    for (const e of pending) {
      if (!orderedIds.includes(e.id)) {
        reordered.push(e);
      }
    }

    const newQueue = [...reordered, ...sending];
    this.promptQueue.set(key, newQueue);

    this.emit("promptQueueUpdated", {
      agentId,
      sessionId,
      queue: [...newQueue],
    });
  }

  // ========================================================================
  // Message Management
  // ========================================================================

  /** Emit-backed append (used when the webview doesn't have the message yet) */
  appendMessage(
    agentId: string,
    sessionId: string,
    message: ChatMessage
  ): void {
    const sessionInfo = this.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    sessionInfo.messages.push(message);
    sessionInfo.updatedAt = new Date();

    // Persist message with tool calls serialized
    const msgToStore = this.serializeMessageForStorage(message);
    this.historyStore?.saveMessages(sessionId, [msgToStore]);
    this.persistSession(sessionId, agentId);

    // Update live session history entry (upsert so it reflects the latest state)
    this.syncSessionHistory(agentId, sessionId, message);

    this.emit("sessionMessage", { agentId, sessionId, message });
  }

  /** Upsert a history entry for a session, keyed by sessionId */
  private syncSessionHistory(
    agentId: string,
    sessionId: string,
    lastMessage: ChatMessage
  ): void {
    if (!this.sessionHistoryStore) return;
    const sessionInfo = this.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;

    const lastContent: string = lastMessage.content;

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
      lastMessage: lastContent || undefined,
    };
    // Fire-and-forget: don't block the message pipeline on history I/O
    void this.sessionHistoryStore.upsertEntry(entry);
  }

  /** Serialize message for SQLite storage */
  private serializeMessageForStorage(msg: ChatMessage): ChatMessage {
    const stored: ChatMessage = { ...msg };
    if (msg.toolCalls) {
      stored.toolCallsJson = JSON.stringify(msg.toolCalls);
    }
    return stored;
  }

  /** Persist session metadata to SQLite */
  private persistSession(sessionId: string, agentId: string): void {
    const sessionInfo = this.getSessionInfo(agentId, sessionId);
    if (sessionInfo) {
      this.historyStore?.saveSession(sessionInfo);
    }
  }

  /** Append without emitting (caller already pushed to webview) */
  appendMessageSilent(
    agentId: string,
    sessionId: string,
    message: ChatMessage
  ): void {
    const sessionInfo = this.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;
    sessionInfo.messages.push(message);
    sessionInfo.updatedAt = new Date();
  }

  // ========================================================================
  // Tool Call Buffering (group by kind within a single agent turn)
  // ========================================================================

  /** Buffer a tool call grouped by kind; flush previous kind when kind changes */
  private bufferToolCall(
    agentId: string,
    sessionId: string,
    newCall: ToolCall
  ): void {
    const key = sessionKey(agentId, sessionId);
    let buffered = this.pendingToolCalls.get(key);
    if (!buffered) {
      buffered = new Map();
      this.pendingToolCalls.set(key, buffered);
    }

    // If a different kind was already buffered, flush it first
    for (const [kind, calls] of buffered) {
      if (kind !== newCall.kind && calls.length > 0) {
        this.flushToolCallGroup(agentId, sessionId, kind, calls);
        buffered.delete(kind);
      }
    }

    const list = buffered.get(newCall.kind) ?? [];
    list.push(newCall);
    buffered.set(newCall.kind, list);
  }

  /** Flush a single kind-group as one ChatMessage */
  private flushToolCallGroup(
    agentId: string,
    sessionId: string,
    kind: string,
    calls: ToolCall[]
  ): void {
    if (calls.length === 0) return;
    const toolCallMsg: ChatMessage = {
      id: `tc-${kind}-${calls[0].id}`,
      role: "tool",
      content: "",
      timestamp: Date.now(),
      agentId,
      sessionId,
      toolCalls: [...calls],
    };
    this.appendMessage(agentId, sessionId, toolCallMsg);
  }

  /** Flush all remaining buffered tool calls (called on turn completion) */
  private flushPendingToolCalls(agentId: string, sessionId: string): void {
    const key = sessionKey(agentId, sessionId);
    const buffered = this.pendingToolCalls.get(key);
    if (!buffered) return;
    for (const [kind, calls] of buffered) {
      this.flushToolCallGroup(agentId, sessionId, kind, calls);
    }
    this.pendingToolCalls.delete(key);
  }

  // ========================================================================
  // Active Session (per-agent)
  // ========================================================================

  getActiveSessionId(agentId: string): string | undefined {
    return this.activeSessions.get(agentId);
  }

  setActiveSession(agentId: string, sessionId: string): void {
    const agentSessions = this.sessions.get(agentId);
    if (!agentSessions?.has(sessionId)) {
      log.warn("setActiveSession: session not found, skipping", {
        agentId,
        sessionId,
      });
      return;
    }

    this.activeSessions.set(agentId, sessionId);
    // Emit overview update BEFORE sessionActiveChanged so the debounced
    // timer is already running when the handler fires. The handler then
    // skips its own getSessionOverview() call (see session-events.ts).
    this.emitOverviewUpdate();
    this.emit("sessionActiveChanged", { agentId, sessionId });
  }

  getActiveSessionInfo(agentId: string): SessionInfo | undefined {
    const sessionId = this.activeSessions.get(agentId);
    if (!sessionId) return undefined;
    return this.sessions.get(agentId)?.get(sessionId);
  }

  getSessionInfo(agentId: string, sessionId: string): SessionInfo | undefined {
    return this.sessions.get(agentId)?.get(sessionId);
  }

  // ========================================================================
  // Session Listing
  // ========================================================================

  getSessionsForAgent(agentId: string): SessionInfo[] {
    const agentSessions = this.sessions.get(agentId);
    if (!agentSessions) return [];
    return Array.from(agentSessions.values());
  }

  getAllSessions(): Map<string, SessionInfo[]> {
    const result = new Map<string, SessionInfo[]>();
    for (const [agentId, agentSessions] of this.sessions) {
      result.set(agentId, Array.from(agentSessions.values()));
    }
    return result;
  }

  // ========================================================================
  // Global Session Lookup (cross-agent)
  // ========================================================================

  /**
   * Find a session by sessionId across all agents.
   * Returns the agentId and SessionInfo, or undefined if not found.
   */
  findSessionGlobally(
    sessionId: string
  ): { agentId: string; info: SessionInfo } | undefined {
    for (const [agentId, agentSessions] of this.sessions) {
      const info = agentSessions.get(sessionId);
      if (info) return { agentId, info };
    }
    return undefined;
  }

  /**
   * Send a prompt to a specific session by sessionId (cross-agent).
   * If agentId is provided, skip the global lookup.
   */
  async promptSession(
    sessionId: string,
    text: string,
    context?: PromptContext,
    agentId?: string
  ): Promise<void> {
    if (agentId) {
      void this.prompt(agentId, sessionId, text, context);
      return;
    }
    const found = this.findSessionGlobally(sessionId);
    if (!found) {
      throw new Error(`Session ${sessionId} not found in any connected agent`);
    }
    void this.prompt(found.agentId, sessionId, text, context);
  }

  /**
   * Cancel a specific session by sessionId (cross-agent).
   */
  async cancelSession(sessionId: string, agentId?: string): Promise<void> {
    if (agentId) {
      return this.cancel(agentId, sessionId);
    }
    const found = this.findSessionGlobally(sessionId);
    if (!found) {
      throw new Error(`Session ${sessionId} not found in any connected agent`);
    }
    return this.cancel(found.agentId, sessionId);
  }

  /**
   * Append a message to a specific session by sessionId (cross-agent).
   */
  appendMessageToSession(
    sessionId: string,
    message: ChatMessage,
    agentId?: string
  ): void {
    if (agentId) {
      return this.appendMessage(agentId, sessionId, message);
    }
    const found = this.findSessionGlobally(sessionId);
    if (!found) {
      throw new Error(`Session ${sessionId} not found in any connected agent`);
    }
    return this.appendMessage(found.agentId, sessionId, message);
  }

  /**
   * Get all sessions as a flat list with agentId attached.
   */
  getAllSessionsFlat(): Array<{
    agentId: string;
    sessionId: string;
    info: SessionInfo;
  }> {
    const result: Array<{
      agentId: string;
      sessionId: string;
      info: SessionInfo;
    }> = [];
    for (const [agentId, agentSessions] of this.sessions) {
      for (const [sessionId, info] of agentSessions) {
        result.push({ agentId, sessionId, info });
      }
    }
    return result;
  }

  // ========================================================================
  // Status
  // ========================================================================

  getAllAgents(): AgentStatus[] {
    const result: AgentStatus[] = [];
    for (const [agentId, config] of this.agentConfigs) {
      result.push(this.getAgentStatus(agentId, config));
    }
    return result;
  }

  getAgentStatus(agentId: string, config?: AgentConfig): AgentStatus {
    const resolvedConfig = config ?? this.agentConfigs.get(agentId);
    if (!resolvedConfig) {
      throw new Error(`Agent ${agentId} not found`);
    }
    const connection = this.connections.get(agentId);
    const agentSessions = this.sessions.get(agentId);
    const activeSessionId = this.activeSessions.get(agentId);

    const sessions: SessionStatusInfo[] = [];
    let totalTokenUsage: TokenUsage = { input: 0, output: 0, total: 0 };
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
        });
        totalTokenUsage.input += info.tokenUsage.input;
        totalTokenUsage.output += info.tokenUsage.output;
        totalTokenUsage.total += info.tokenUsage.total;
        if (info.updatedAt > lastActivity) {
          lastActivity = info.updatedAt;
        }
      }
    }

    let state: AgentConnectionState = "disconnected";
    if (connection) {
      const proc = this.processes.get(agentId);
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
  // Internal Handlers
  // ========================================================================

  private handleSessionUpdate(
    agentId: string,
    notification: SessionNotification
  ): void {
    const { sessionId, update } = notification;
    const agentSessions = this.sessions.get(agentId);
    const sessionInfo = agentSessions?.get(sessionId);
    if (!sessionInfo) return;

    // Guard: reject notifications for sessions that are not actively running a turn.
    // This prevents stale/background updates from being surfaced in the chat UI
    // after the turn has already completed, been cancelled, or errored out.
    if (sessionInfo.status !== "running") {
      return;
    }

    sessionInfo.updatedAt = new Date();

    // update is a discriminated union on `sessionUpdate`
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        sessionInfo.status = "running";
        sessionInfo.lastResponseAt = new Date().toISOString();
        // Track streaming state — emit on transition from non-streaming to streaming
        if (!sessionInfo.isStreaming) {
          sessionInfo.isStreaming = true;
          this.emit("sessionStreamStart", { agentId, sessionId });
        }
        // Flush buffered tool calls before agent text arrives
        this.flushPendingToolCalls(agentId, sessionId);
        const content = update.content;
        const text = content?.type === "text" ? content.text : undefined;
        if (text) {
          const streamingMsg: ChatMessage = {
            id: `stream-${sessionId}-${crypto.randomUUID()}`,
            role: "agent",
            content: text,
            timestamp: Date.now(),
            agentId,
            sessionId,
          };
          this.appendMessage(agentId, sessionId, streamingMsg);
          this.emit("sessionStreamChunk", {
            agentId,
            sessionId,
            chunk: text,
          });
        }
        break;
      }
      case "agent_thought_chunk":
        sessionInfo.status = "running";
        if (!sessionInfo.isStreaming) {
          sessionInfo.isStreaming = true;
          this.emit("sessionStreamStart", { agentId, sessionId });
        }
        break;
      case "tool_call": {
        sessionInfo.status = "running";
        if (!sessionInfo.isStreaming) {
          sessionInfo.isStreaming = true;
          this.emit("sessionStreamStart", { agentId, sessionId });
        }
        const tcLocations = update.locations?.map((loc) => ({
          path: loc.path,
          line: loc.line ?? undefined,
        }));
        const tcDiff = extractDiffContent(update.content);
        const newCall: ToolCall = {
          id: update.toolCallId,
          title: update.title ?? "",
          status: normalizeToolStatus(update.status),
          kind: update.kind ?? "",
          input:
            typeof update.rawInput === "string"
              ? update.rawInput
              : JSON.stringify(update.rawInput),
          output:
            update.rawOutput !== undefined
              ? typeof update.rawOutput === "string"
                ? update.rawOutput
                : JSON.stringify(update.rawOutput)
              : undefined,
          locations: tcLocations,
          diffContent: tcDiff,
        };
        // Buffer by kind — flush when kind changes or on turn end
        this.bufferToolCall(agentId, sessionId, newCall);
        break;
      }
      case "tool_call_update": {
        const tcUpdateDiff = update.content
          ? extractDiffContent(update.content)
          : undefined;
        // Try to update in buffered messages first
        const buffered = this.pendingToolCalls.get(
          sessionKey(agentId, sessionId)
        );
        if (buffered) {
          let foundInBuffer = false;
          for (const [, calls] of buffered) {
            const tc = calls.find((c) => c.id === update.toolCallId);
            if (tc) {
              if (update.title !== undefined) tc.title = update.title ?? "";
              if (update.status !== undefined)
                tc.status = normalizeToolStatus(update.status);
              if (update.kind !== undefined) tc.kind = update.kind ?? "";
              if (update.rawInput !== undefined)
                tc.input =
                  typeof update.rawInput === "string"
                    ? update.rawInput
                    : JSON.stringify(update.rawInput);
              if (update.rawOutput !== undefined)
                tc.output =
                  typeof update.rawOutput === "string"
                    ? update.rawOutput
                    : JSON.stringify(update.rawOutput);
              if (update.locations)
                tc.locations = update.locations.map((loc) => ({
                  path: loc.path,
                  line: loc.line ?? undefined,
                }));
              if (tcUpdateDiff) tc.diffContent = tcUpdateDiff;
              foundInBuffer = true;
              break;
            }
          }
          if (foundInBuffer) break;
        }
        // Fall back: find in emitted messages and update in place
        const sessionMsgs = sessionInfo.messages;
        const existingIdx = sessionMsgs.findIndex((m) =>
          m.toolCalls?.some((tc) => tc.id === update.toolCallId)
        );
        if (existingIdx >= 0) {
          const existing = sessionMsgs[existingIdx];
          const updatedTCs = (existing.toolCalls ?? []).map((tc) =>
            tc.id === update.toolCallId
              ? {
                  ...tc,
                  title: update.title ?? tc.title,
                  status: normalizeToolStatus(update.status ?? tc.status),
                  kind: update.kind ?? tc.kind,
                  input:
                    update.rawInput !== undefined
                      ? typeof update.rawInput === "string"
                        ? update.rawInput
                        : JSON.stringify(update.rawInput)
                      : tc.input,
                  output:
                    update.rawOutput !== undefined
                      ? typeof update.rawOutput === "string"
                        ? update.rawOutput
                        : JSON.stringify(update.rawOutput)
                      : tc.output,
                  locations:
                    update.locations?.map((loc) => ({
                      path: loc.path,
                      line: loc.line ?? undefined,
                    })) ?? tc.locations,
                  diffContent: tcUpdateDiff ?? tc.diffContent,
                }
              : tc
          );
          const updated = { ...existing, toolCalls: updatedTCs };
          sessionMsgs[existingIdx] = updated;
          this.emit("sessionMessage", { agentId, sessionId, message: updated });
        }
        break;
      }
      case "plan":
        break;
      case "plan_update":
        break;
      case "plan_removed":
        break;
      case "available_commands_update": {
        const key = sessionKey(agentId, sessionId);
        this.sessionCommands.set(key, update.availableCommands ?? []);
        this.emit("sessionCommandsUpdated", {
          agentId,
          sessionId,
          commands: update.availableCommands ?? [],
        });
        break;
      }
      case "current_mode_update": {
        sessionInfo.mode = update.currentModeId;
        break;
      }
      case "config_option_update": {
        // Try to extract model from config options (category: "model" or id containing "model")
        for (const opt of update.configOptions) {
          if (opt.category === "model" || opt.id.includes("model")) {
            if (opt.type === "select") {
              const currentVal = opt.currentValue;
              // Flatten: options can be SessionConfigSelectOption[] or SessionConfigSelectGroup[]
              const flatOptions: Array<{ name: string; value: string }> = [];
              for (const item of opt.options) {
                if ("value" in item) {
                  flatOptions.push(item);
                } else if ("options" in item && Array.isArray(item.options)) {
                  for (const sub of item.options) {
                    flatOptions.push(sub);
                  }
                }
              }
              const selected = flatOptions.find(
                (o: (typeof flatOptions)[number]) => o.value === currentVal
              );
              sessionInfo.model = selected?.name ?? currentVal;
            }
          }
        }
        break;
      }
      case "session_info_update":
        if (update.title !== undefined && update.title !== null) {
          sessionInfo.title = update.title;
        }
        break;
      case "usage_update": {
        // UsageUpdate: { size: contextWindowTotal, used: tokensUsed, cost?: Cost }
        // 'used' = tokens currently in context window.
        log.debug("usage_update", {
          agentId,
          sessionId,
          contextWindowTotal: update.size,
          tokensUsed: update.used,
          cost: (update as Record<string, unknown>).cost,
        });
        const prevTotal = sessionInfo.tokenUsage.total;
        const prevContextUsed = sessionInfo._prevContextUsed;
        const newUsed =
          update.used !== undefined && update.used !== null && update.used > 0
            ? update.used
            : prevTotal;

        // Detect context compression: a significant drop in context usage
        // between consecutive usage_update notifications.
        // Threshold: used tokens dropped by ≥25% or ≥2000 tokens (whichever is larger),
        // and the previous value was non-trivial (>1000 tokens).
        // Also ignore when contextWindowMax changes (model switch scenario).
        const contextWindowSize =
          update.size !== undefined && update.size !== null && update.size > 0
            ? update.size
            : sessionInfo.contextWindowMax ?? 0;

        if (
          prevContextUsed !== undefined &&
          prevContextUsed > 1000 &&
          contextWindowSize > 0 &&
          contextWindowSize === sessionInfo.contextWindowMax
        ) {
          const drop = prevContextUsed - newUsed;
          const dropRatio = drop / prevContextUsed;
          const COMPRESSION_RATIO_THRESHOLD = 0.25;
          const COMPRESSION_ABS_THRESHOLD = 2000;
          if (
            drop > 0 &&
            (dropRatio >= COMPRESSION_RATIO_THRESHOLD ||
              drop >= COMPRESSION_ABS_THRESHOLD)
          ) {
            this.emit("sessionContextCompressed", {
              agentId,
              sessionId,
              contextWindowMax: contextWindowSize,
              usedBefore: prevContextUsed,
              usedAfter: newUsed,
            });
          }
        }

        sessionInfo.tokenUsage.total = newUsed;
        if (newUsed > prevTotal) {
          sessionInfo.tokenUsage.input += newUsed - prevTotal;
        }

        if (contextWindowSize > 0) {
          sessionInfo.contextWindowMax = contextWindowSize;
        }
        // Store current used for next comparison
        sessionInfo._prevContextUsed = newUsed;
        break;
      }
      case "user_message_chunk":
        break;
    }

    // Forward the full notification to extension.ts for UI routing
    this.emit("sessionUpdate", { agentId, sessionId, notification });

    // Debounced overview update
    this.emitOverviewUpdate();
  }

  private async handleRequestPermission(
    agentId: string,
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const qpItems = request.options.map((o) => ({
      label: o.name ?? o.optionId,
      description: o.kind ?? undefined,
      picked: false,
    }));

    const kindLabel =
      request.toolCall.kind === "edit"
        ? "📝 Edit"
        : request.toolCall.kind === "execute"
          ? "⚡ Execute"
          : request.toolCall.kind === "fetch"
            ? "🌐 Fetch"
            : (request.toolCall.kind ?? "Action");

    const title = `[${agentId}] ${kindLabel}: ${request.toolCall.title ?? "(no title)"}`;

    const result = await this.deps.ui.showQuickPick(qpItems, {
      placeHolder: title,
    });

    if (!result) {
      return { outcome: { outcome: "cancelled" } };
    }

    // Map back to optionId via label match (showQuickPick may return a copy)
    const label = (result as { label: string }).label;
    const matchedOption = request.options.find(
      (o) => (o.name ?? o.optionId) === label
    );
    const optionId = matchedOption?.optionId;
    if (!optionId) {
      return { outcome: { outcome: "cancelled" } };
    }
    return { outcome: { outcome: "selected", optionId } };
  }

  private handleAgentDisconnected(agentId: string): void {
    this.connections.delete(agentId);
    this.processes.delete(agentId);
    this.activeSessions.delete(agentId);
    this.emit("agentDisconnected", agentId);
  }

  // ========================================================================
  // Session Overview
  // ========================================================================

  getSessionOverview(): {
    sessions: Array<{
      sessionId: string;
      agentId: string;
      title: string;
      status: SessionStatus;
      lastTurnOutcome: TurnOutcome | null;
      model?: string;
      mode?: string;
      progress: {
        elapsedMs: number;
        tokenUsage: { input: number; output: number; total: number };
        contextWindow?: { used: number; max: number; percentage: number };
        messageCount: number;
        toolCallCount: number;
        toolCallsCompleted: number;
      };
      recentResponses: Array<{
        messageId: string;
        role: "agent" | "tool";
        preview: string;
        toolName?: string;
        status?: "completed" | "running" | "failed";
        timestamp: string;
      }>;
      cwd?: string;
      createdAt: string;
      lastResponseAt: string | null;
    }>;
    lastUpdated: string;
  } {
    const sessions: Array<{
      sessionId: string;
      agentId: string;
      title: string;
      status: SessionStatus;
      lastTurnOutcome: TurnOutcome | null;
      model?: string;
      mode?: string;
      progress: {
        elapsedMs: number;
        tokenUsage: { input: number; output: number; total: number };
        contextWindow?: { used: number; max: number; percentage: number };
        messageCount: number;
        toolCallCount: number;
        toolCallsCompleted: number;
      };
      recentResponses: Array<{
        messageId: string;
        role: "agent" | "tool";
        preview: string;
        toolName?: string;
        status?: "completed" | "running" | "failed";
        timestamp: string;
      }>;
      cwd?: string;
      createdAt: string;
      lastResponseAt: string | null;
    }> = [];

    for (const [agentId, agentSessions] of this.sessions) {
      for (const [sessionId, info] of agentSessions) {
        const toolCallCount = info.messages.reduce(
          (count, msg) => count + (msg.toolCalls?.length ?? 0),
          0
        );
        const toolCallsCompleted = info.messages.reduce(
          (count, msg) =>
            count +
            (msg.toolCalls?.filter((tc) => tc.status === "completed").length ??
              0),
          0
        );

        sessions.push({
          sessionId,
          agentId,
          title: info.title,
          status: info.status,
          lastTurnOutcome: info.lastTurnOutcome,
          model: info.model,
          mode: info.mode,
          progress: {
            elapsedMs:
              info.status === "running" && info.lastResponseAt
                ? Date.now() - new Date(info.lastResponseAt).getTime()
                : 0,
            tokenUsage: {
              input: info.tokenUsage.input,
              output: info.tokenUsage.output,
              total: info.tokenUsage.total,
            },
            contextWindow: info.contextWindowMax
              ? {
                  used: info.tokenUsage.total,
                  max: info.contextWindowMax,
                  percentage: Math.round(
                    (info.tokenUsage.total / info.contextWindowMax) * 100
                  ),
                }
              : undefined,
            messageCount: info.messages.length,
            toolCallCount,
            toolCallsCompleted,
          },
          recentResponses: this.extractRecentResponses(info.messages, 3),
          cwd: info.cwd,
          createdAt: info.createdAt.toISOString(),
          lastResponseAt: info.lastResponseAt,
        });
      }
    }

    return {
      sessions,
      lastUpdated: new Date().toISOString(),
    };
  }

  private extractRecentResponses(
    messages: import("../../domain/models/chat").ChatMessage[],
    limit: number
  ): Array<{
    messageId: string;
    role: "agent" | "tool";
    preview: string;
    toolName?: string;
    status?: "completed" | "running" | "failed";
    timestamp: string;
  }> {
    const responses: Array<{
      messageId: string;
      role: "agent" | "tool";
      preview: string;
      toolName?: string;
      status?: "completed" | "running" | "failed";
      timestamp: string;
    }> = [];

    for (let i = messages.length - 1; i >= 0 && responses.length < limit; i--) {
      const msg = messages[i];
      if (msg.role === "agent" && msg.content) {
        responses.unshift({
          messageId: msg.id,
          role: "agent",
          preview: msg.content.slice(0, 120),
          timestamp: new Date(msg.timestamp).toISOString(),
        });
      }
    }

    return responses;
  }

  private emitOverviewUpdate(): void {
    if (this.listenerCount("sessionOverview:update") > 0) {
      if (this.sessionOverviewDebounceTimer) {
        clearTimeout(this.sessionOverviewDebounceTimer);
      }
      this.sessionOverviewDebounceTimer = setTimeout(() => {
        const overview = this.getSessionOverview();
        this.emit("sessionOverview:update", overview);
      }, 100);
    }
  }

  /** Public emit for lifecycle events outside handleSessionUpdate */
  triggerOverviewUpdate(): void {
    this.emitOverviewUpdate();
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    // Flush all pending sessions to persistent storage
    for (const [agentId, agentSessions] of this.sessions) {
      for (const [sessionId, sessionInfo] of agentSessions) {
        this.historyStore?.saveSession(sessionInfo);
        if (sessionInfo.messages.length > 0) {
          const msgs = sessionInfo.messages.map((m) =>
            this.serializeMessageForStorage(m)
          );
          this.historyStore?.saveMessages(sessionId, msgs);
        }
      }
    }
    this.historyStore?.dispose();

    for (const [, proc] of this.processes) {
      proc.kill();
    }
    this.connections.clear();
    this.processes.clear();
    this.sessions.clear();
    this.activeSessions.clear();
    this.agentConfigs.clear();
    this.emittedToolCallIds.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wrap a promise with a timeout. If the promise does not resolve within
 * rejectMs, the returned promise rejects with a TimeoutError.
 * The underlying operation is NOT cancelled — callers must handle that
 * separately if needed.
 */
function withTimeout<T>(
  promise: Promise<T>,
  rejectMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${rejectMs}ms: ${label}`));
    }, rejectMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ============================================================================
// Normalize tool call status from SDK to webview-compatible values
// ============================================================================

function normalizeToolStatus(
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

/** Extract a Diff content block from a ToolCallContent array */
function extractDiffContent(
  content: ToolCallContent[] | undefined
): { oldText?: string; newText: string; path: string } | undefined {
  if (!content) return undefined;
  for (const c of content) {
    if (c.type === "diff") {
      return {
        oldText: c.oldText ?? undefined,
        newText: c.newText,
        path: c.path,
      };
    }
  }
  return undefined;
}
