import { EventEmitter } from "events";
import { abbreviatePath } from "../../shared/util/path";
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
} from "@agentclientprotocol/sdk";
import * as child_process from "child_process";
import { Readable, Writable } from "stream";
import type { SessionInfo, SessionStatus } from "./types";
import type { ChatMessage, TokenUsage, ToolCall } from "../../domain/models/chat";
import type { ToolCallContent, AvailableCommand } from "@agentclientprotocol/sdk";
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
  isActive: boolean;
  messageCount: number;
  tokenUsage: TokenUsage;
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

export interface PromptContext {
  files?: string[];
  selection?: string;
  diff?: string;
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
      return; // already connected, no-op
    }

    this.agentConfigs.set(agentId, config);
    this.sessions.set(agentId, new Map());

    // Spawn the agent process
    const proc = child_process.spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.processes.set(agentId, proc);

    // Convert Node.js streams to Web Streams for ndJsonStream
    const stdinWritable = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
    const stdoutReadable = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(stdinWritable, stdoutReadable);

    // Create the VS Code client implementation
    const client = new PlatformAcpClient(
      { fs: this.deps.fs, ui: this.deps.ui },
      (aId, notification) => this.handleSessionUpdate(aId, notification),
      (aId, request) => this.handleRequestPermission(aId, request),
    );
    client.setAgentId(agentId);

    const connection = new ClientSideConnection(() => client, stream);
    this.connections.set(agentId, connection);

    // Handle process exit
    proc.on("close", () => {
      this.handleAgentDisconnected(agentId);
    });
    proc.on("error", (err) => {
      console.error(`Agent ${agentId} process error: ${err.message}`);
    });

    // Initialize the connection
    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    } satisfies InitializeRequest);

    if (!initResponse) {
      throw new Error("Failed to initialize agent connection");
    }

    // Store agent info from InitializeResponse
    const sc = initResponse.agentCapabilities?.sessionCapabilities;
    this.agentInfoMap.set(agentId, {
      name: initResponse.agentInfo?.name ?? agentId,
      title: initResponse.agentInfo?.title ?? undefined,
      version: initResponse.agentInfo?.version ?? undefined,
      protocolVersion: initResponse.protocolVersion,
      capabilities: initResponse.agentCapabilities ? {
        loadSession: initResponse.agentCapabilities.loadSession ?? false,
        promptCapabilities: initResponse.agentCapabilities.promptCapabilities ? {
          image: initResponse.agentCapabilities.promptCapabilities.image ?? false,
          audio: initResponse.agentCapabilities.promptCapabilities.audio ?? false,
          embeddedContext: initResponse.agentCapabilities.promptCapabilities.embeddedContext ?? false,
        } : undefined,
        sessionCapabilities: sc ? {
          fork: sc.fork != null,
          list: sc.list != null,
          resume: sc.resume != null,
          delete: sc.delete != null,
          close: sc.close != null,
          additionalDirectories: sc.additionalDirectories != null,
        } : undefined,
      } : undefined,
    });

    this.emit("agentConnected", agentId);
  }

  async disconnectAgent(agentId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) return;

    this.connections.delete(agentId);

    const proc = this.processes.get(agentId);
    if (proc) {
      proc.kill();
      this.processes.delete(agentId);
    }

    this.sessions.delete(agentId);
    this.activeSessions.delete(agentId);
    this.agentConfigs.delete(agentId);
    this.agentInfoMap.delete(agentId);

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
      throw new Error(`Agent ${agentId} is not connected`);
    }

    const effectiveCwd = cwd ?? process.cwd();

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
      messages: [],
      isTurnActive: false,
      createdAt: now,
      updatedAt: now,
      tokenUsage: { input: 0, output: 0, total: 0 },
      pendingCancel: false,
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

    this.emit("sessionCreated", { agentId, sessionId, cwd: effectiveCwd });
    return sessionId;
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) return;

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

    this.emit("sessionClosed", { agentId, sessionId });
  }

  async prompt(
    agentId: string,
    sessionId: string,
    text: string,
    context?: PromptContext
  ): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      throw new Error(`Agent ${agentId} is not connected`);
    }

    const agentSessions = this.sessions.get(agentId);
    const sessionInfo = agentSessions?.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    sessionInfo.status = "running";
    sessionInfo.updatedAt = new Date();
    sessionInfo.isTurnActive = true;

    // Build prompt with context
    let fullText = text;
    if (context?.files?.length) {
      const fileContexts = context.files.map((f) => `@file:${f}`).join(" ");
      fullText = `${fileContexts}\n\n${text}`;
    }
    if (context?.selection) {
      fullText += `\n\nSelected text:\n${context.selection}`;
    }
    if (context?.diff) {
      fullText += `\n\nDiff:\n${context.diff}`;
    }

    try {
      const response = await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: fullText }],
      } satisfies PromptRequest);

      // Update token usage from PromptResponse.usage (per-turn)
      if (response.usage) {
        sessionInfo.tokenUsage = {
          input: response.usage.inputTokens ?? sessionInfo.tokenUsage.input,
          output: response.usage.outputTokens ?? sessionInfo.tokenUsage.output,
          total: response.usage.totalTokens ?? sessionInfo.tokenUsage.total,
        };
      }

      // Turn is complete when prompt() resolves
      sessionInfo.status = "completed";
      // Flush any remaining buffered tool calls
      this.flushPendingToolCalls(agentId, sessionId);
      this.emit("sessionCompleted", { agentId, sessionId, title: sessionInfo.title });
    } catch (e) {
      sessionInfo.status = "error";
      throw e;
    } finally {
      sessionInfo.isTurnActive = false;
      sessionInfo.updatedAt = new Date();
      this.emit("sessionTurnActiveChanged", { agentId, sessionId, active: false });
    }
  }

  async cancel(agentId: string, sessionId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) return;

    const agentSessions = this.sessions.get(agentId);
    const sessionInfo = agentSessions?.get(sessionId);
    if (sessionInfo) {
      sessionInfo.pendingCancel = true;
      sessionInfo.status = "cancelled";
      sessionInfo.isTurnActive = false;
      sessionInfo.updatedAt = new Date();
      this.emit("sessionTurnActiveChanged", { agentId, sessionId, active: false });
    }

    await connection.cancel({ sessionId } satisfies CancelNotification);
  }

  // ========================================================================
  // Message Management
  // ========================================================================

  /** Emit-backed append (used when the webview doesn't have the message yet) */
  appendMessage(agentId: string, sessionId: string, message: ChatMessage): void {
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
  private syncSessionHistory(agentId: string, sessionId: string, lastMessage: ChatMessage): void {
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
      updatedAt: sessionInfo.updatedAt.toISOString(),
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
  appendMessageSilent(agentId: string, sessionId: string, message: ChatMessage): void {
    const sessionInfo = this.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;
    sessionInfo.messages.push(message);
    sessionInfo.updatedAt = new Date();
  }

  // ========================================================================
  // Tool Call Buffering (group by kind within a single agent turn)
  // ========================================================================

  /** Buffer a tool call grouped by kind; flush previous kind when kind changes */
  private bufferToolCall(agentId: string, sessionId: string, newCall: ToolCall): void {
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
    calls: ToolCall[],
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
  // Turn Active Management
  // ========================================================================

  setIsTurnActive(agentId: string, sessionId: string, active: boolean): void {
    const sessionInfo = this.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    sessionInfo.isTurnActive = active;
    sessionInfo.updatedAt = new Date();

    this.emit("sessionTurnActiveChanged", { agentId, sessionId, active });
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
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    this.activeSessions.set(agentId, sessionId);
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
          isActive: sessionId === activeSessionId,
          messageCount: info.messages.length,
          tokenUsage: info.tokenUsage,
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

  private handleSessionUpdate(agentId: string, notification: SessionNotification): void {
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
        // Flush buffered tool calls before agent text arrives
        this.flushPendingToolCalls(agentId, sessionId);
        const content = update.content;
        const text = content?.type === "text" ? content.text : undefined;
        if (text) {
          const streamingMsg: ChatMessage = {
            id: `stream-${sessionId}-${Date.now()}`,
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
        break;
      case "tool_call": {
        sessionInfo.status = "running";
        const tcLocations = update.locations?.map((loc) => ({ path: loc.path, line: loc.line ?? undefined }));
        const tcDiff = extractDiffContent(update.content);
        const newCall: ToolCall = {
          id: update.toolCallId,
          title: update.title ?? "",
          status: normalizeToolStatus(update.status),
          kind: update.kind ?? "",
          input: typeof update.rawInput === "string" ? update.rawInput : JSON.stringify(update.rawInput),
          output: update.rawOutput !== undefined ? (typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput)) : undefined,
          locations: tcLocations,
          diffContent: tcDiff,
        };
        // Buffer by kind — flush when kind changes or on turn end
        this.bufferToolCall(agentId, sessionId, newCall);
        break;
      }
      case "tool_call_update": {
        const tcUpdateDiff = update.content ? extractDiffContent(update.content) : undefined;
        // Try to update in buffered messages first
        const buffered = this.pendingToolCalls.get(sessionKey(agentId, sessionId));
        if (buffered) {
          let foundInBuffer = false;
          for (const [, calls] of buffered) {
            const tc = calls.find((c) => c.id === update.toolCallId);
            if (tc) {
              if (update.title !== undefined) tc.title = update.title ?? "";
              if (update.status !== undefined) tc.status = normalizeToolStatus(update.status);
              if (update.kind !== undefined) tc.kind = update.kind ?? "";
              if (update.rawInput !== undefined) tc.input = typeof update.rawInput === "string" ? update.rawInput : JSON.stringify(update.rawInput);
              if (update.rawOutput !== undefined) tc.output = typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput);
              if (update.locations) tc.locations = update.locations.map((loc) => ({ path: loc.path, line: loc.line ?? undefined }));
              if (tcUpdateDiff) tc.diffContent = tcUpdateDiff;
              foundInBuffer = true;
              break;
            }
          }
          if (foundInBuffer) break;
        }
        // Fall back: find in emitted messages and update in place
        const sessionMsgs = sessionInfo.messages;
        const existingIdx = sessionMsgs.findIndex(
          (m) => m.toolCalls?.some((tc) => tc.id === update.toolCallId)
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
                  input: update.rawInput !== undefined ? (typeof update.rawInput === "string" ? update.rawInput : JSON.stringify(update.rawInput)) : tc.input,
                  output: update.rawOutput !== undefined ? (typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput)) : tc.output,
                  locations: update.locations?.map((loc) => ({ path: loc.path, line: loc.line ?? undefined })) ?? tc.locations,
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
        this.emit("sessionCommandsUpdated", { agentId, sessionId, commands: update.availableCommands ?? [] });
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
              const selected = flatOptions.find((o: typeof flatOptions[number]) => o.value === currentVal);
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
        // 'used' = cumulative tokens in context (input + output combined).
        // input/output are not separately provided, so we estimate:
        //   - new input  = delta of 'used' from previous total
        //   - output is not yet finalized during a turn, so we rely on
        //     prompt() completion for accurate output counts.
        // However, during the turn the webview needs a live token display,
        // so we attribute the growing 'used' to input (the prompt tokens
        // dominate early in the turn). Output gets corrected on turn end.
        console.log('[ACP] usage_update:', JSON.stringify(notification.update));
        const prevTotal = sessionInfo.tokenUsage.total;
        if (update.used !== undefined && update.used !== null && update.used > 0) {
          sessionInfo.tokenUsage.total = update.used;
          const delta = update.used - prevTotal;
          if (delta > 0) {
            // Attribute delta to input during the turn.
            // prompt() completion will overwrite with precise values.
            sessionInfo.tokenUsage.input += delta;
          }
        }
        if (update.size !== undefined && update.size !== null && update.size > 0) {
          sessionInfo.contextWindowMax = update.size;
        }
        break;
      }
      case "user_message_chunk":
        break;
    }

    // Forward the full notification to extension.ts for UI routing
    this.emit("sessionUpdate", { agentId, sessionId, notification });
  }

  private async handleRequestPermission(
    agentId: string,
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const qpItems = request.options.map((o) => ({
      label: o.name ?? o.optionId,
      description: o.kind ?? undefined,
      picked: false,
    }));

    const kindLabel =
      request.toolCall.kind === "edit" ? "📝 Edit" :
      request.toolCall.kind === "execute" ? "⚡ Execute" :
      request.toolCall.kind === "fetch" ? "🌐 Fetch" :
      request.toolCall.kind ?? "Action";

    const title = `[${agentId}] ${kindLabel}: ${request.toolCall.title ?? "(no title)"}`;

    const result = await this.deps.ui.showQuickPick(qpItems, {
      placeHolder: title,
    });

    if (!result) {
      return { outcome: { outcome: "cancelled" } };
    }

    // Map back to optionId via label match (showQuickPick may return a copy)
    const label = (result as { label: string }).label;
    const matchedOption = request.options.find((o) => (o.name ?? o.optionId) === label);
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
  // Cleanup
  // ========================================================================

  dispose(): void {
    // Flush all pending sessions to persistent storage
    for (const [agentId, agentSessions] of this.sessions) {
      for (const [sessionId, sessionInfo] of agentSessions) {
        this.historyStore?.saveSession(sessionInfo);
        if (sessionInfo.messages.length > 0) {
          const msgs = sessionInfo.messages.map((m) => this.serializeMessageForStorage(m));
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

// ============================================================================
// Normalize tool call status from SDK to webview-compatible values
// ============================================================================

function normalizeToolStatus(
  raw: string | null | undefined,
): "in_progress" | "completed" | "failed" | "cancelled" {
  if (raw === "pending") return "in_progress";
  if (raw === "in_progress" || raw === "completed" || raw === "failed" || raw === "cancelled") {
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
