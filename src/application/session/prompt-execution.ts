import type { ContentBlock, StopReason } from "@agentclientprotocol/sdk";
import type { PromptContext, QueuedPrompt } from "./types";
import type { AgentConnection } from "./agent-connection";
import type { ChatMessage } from "../../domain/models/chat";
import { SessionState, sessionKey } from "./session-state";
import type { PersistentHistoryStore } from "./persistentHistory";
import { getLogger } from "../../platform/backends";

const log = getLogger("prompt-execution");

export interface PromptExecutionDeps {
  agentConnection: AgentConnection;
  sessionState: SessionState;
  protocolHandler: import("./protocol-handler").ProtocolHandler;
  historyStore: PersistentHistoryStore | null;
  /** Get global Mesh Protocol enabled state */
  getMeshGlobalEnabled: () => boolean;
  /** Emit event to orchestrator (sessionTurnActiveChanged, etc.) */
  emit: (event: string, ...args: unknown[]) => void;
  /** Append a tool message to the session — used by flushToolCallGroup to surface buffered calls */
  appendToolMessage: (agentId: string, sessionId: string, message: import("../../domain/models/chat").ChatMessage) => void;
}

export class PromptExecution {
  private deps: PromptExecutionDeps;

  constructor(deps: PromptExecutionDeps) {
    this.deps = deps;
  }

  async send(
    agentId: string,
    sessionId: string,
    text: string,
    context?: PromptContext
  ): Promise<QueuedPrompt | undefined> {
    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

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
      this.deps.sessionState.addToQueue(key, entry);
      return entry;
    }

    await this.execute(agentId, sessionId, text, context);
    return undefined;
  }

  async execute(
    agentId: string,
    sessionId: string,
    text: string,
    context?: PromptContext
  ): Promise<void> {
    const connection = this.deps.agentConnection.getConnection(agentId);
    if (!connection) {
      throw new Error(`Agent ${agentId} is not connected`);
    }

    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }

    let finalText = text;
    const meshGlobalEnabled = this.deps.getMeshGlobalEnabled();
    const builder = this.deps.sessionState.getPromptBuilder(agentId);
    if (meshGlobalEnabled && builder && text.length > 0) {
      const lastInbound = this.deps.sessionState.getLastInboundMessage(agentId);
      finalText = builder.buildUserPrompt({ text, mode: "direct", inboundMessage: lastInbound });
    }

    const turnMessageId = crypto.randomUUID();
    sessionInfo.lastTurnMessageId = turnMessageId;
    log.info("sending prompt", {
      agentId,
      sessionId,
      messageId: turnMessageId,
      textLen: finalText.length,
      contextBlocks: context?.length ?? 0,
      meshInjected: builder !== undefined && text.length > 0,
    });

    sessionInfo.status = "running";
    sessionInfo.lastTurnOutcome = null;
    sessionInfo.updatedAt = new Date();
    sessionInfo.isStreaming = true;

    const promptBlocks: ContentBlock[] = [...(context ?? []), { type: "text", text: finalText }];

    let stopReason: StopReason | undefined;
    try {
      const response = await connection.prompt({
        sessionId,
        prompt: promptBlocks,
      });

      if (response.usage) {
        sessionInfo.tokenUsage = {
          input: response.usage.inputTokens ?? sessionInfo.tokenUsage.input,
          output: response.usage.outputTokens ?? sessionInfo.tokenUsage.output,
          total: response.usage.totalTokens ?? sessionInfo.tokenUsage.total,
        };
      }

      stopReason = response.stopReason;
      sessionInfo.lastTurnOutcome = "completed";
      sessionInfo.isStreaming = false;
      sessionInfo.lastResponseAt = new Date().toISOString();

      this.flushPendingToolCalls(agentId, sessionId);
      this.deps.protocolHandler.flushAllBatches(agentId, sessionId);

      const sKey = sessionKey(agentId, sessionId);
      this.deps.sessionState.clearStreamText(sKey);
      this.deps.sessionState.clearStreamMsgRef(sKey);

      log.info("turn completed", { agentId, sessionId, messageId: turnMessageId, tokens: sessionInfo.tokenUsage, stopReason });
    } catch (e) {
      sessionInfo.lastTurnOutcome = "error";
      sessionInfo.isStreaming = false;
      log.warn("turn error", { agentId, sessionId, messageId: turnMessageId, error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      sessionInfo.status = "idle";
      sessionInfo.updatedAt = new Date();
      // When the agent produces only tool calls (no text), stopReason
      // may be undefined — default to "end_turn" so the UI turn boundary
      // is always closed.
      const resolvedStopReason = stopReason ?? "end_turn";
      this.deps.emit("sessionTurnActiveChanged", {
        agentId,
        sessionId,
        active: false,
        stopReason: resolvedStopReason,
      });
      this.processNextInQueue(agentId, sessionId);
    }
  }

  async cancel(agentId: string, sessionId: string): Promise<void> {
    const connection = this.deps.agentConnection.getConnection(agentId);
    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);

    if (sessionInfo) {
      sessionInfo.pendingCancel = true;
      sessionInfo.isStreaming = false;
      sessionInfo.status = "cancelling";
      sessionInfo.updatedAt = new Date();
    }

    this.deps.protocolHandler.flushAllBatches(agentId, sessionId);

    const sKey = sessionKey(agentId, sessionId);
    this.deps.sessionState.clearStreamText(sKey);
    this.deps.sessionState.clearStreamMsgRef(sKey);

    if (connection) {
      await connection.cancel({ sessionId });
    }
  }

  private async processNextInQueue(agentId: string, sessionId: string): Promise<void> {
    const key = sessionKey(agentId, sessionId);
    const queue = this.deps.sessionState.getQueue(key);
    if (queue.length === 0) return;

    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo || sessionInfo.status === "running") return;

    const next = queue.shift()!;
    next.status = "sending";

    try {
      await this.execute(next.agentId, next.sessionId, next.text, next.context);
      next.status = "sent";
    } catch (e) {
      next.status = "cancelled";
      throw e;
    } finally {
      if (queue.length === 0) {
        this.deps.sessionState.setQueue(key, []);
      }
    }
  }

  getQueuedPrompts(agentId: string, sessionId: string): QueuedPrompt[] {
    return this.deps.sessionState.getQueue(sessionKey(agentId, sessionId));
  }

  cancelQueuedPrompt(agentId: string, sessionId: string, promptId: string): boolean {
    return this.deps.sessionState.removeFromQueue(sessionKey(agentId, sessionId), promptId);
  }

  reorderQueuedPrompts(agentId: string, sessionId: string, orderedIds: string[]): void {
    const key = sessionKey(agentId, sessionId);
    const queue = this.deps.sessionState.getQueue(key);
    const pending = queue.filter((e) => e.status === "pending");
    const sending = queue.filter((e) => e.status !== "pending");

    const reordered = orderedIds
      .map((id) => pending.find((e) => e.id === id))
      .filter((e): e is QueuedPrompt => e !== undefined);

    for (const e of pending) {
      if (!orderedIds.includes(e.id)) {
        reordered.push(e);
      }
    }

    this.deps.sessionState.setQueue(key, [...reordered, ...sending]);
  }

  handleContextCompression(
    agentId: string,
    sessionId: string,
    contextWindowMax: number,
    usedBefore: number,
    usedAfter: number
  ): void {
    const builder = this.deps.sessionState.getPromptBuilder(agentId);
    if (!builder) return;

    const now = Date.now();
    const lastReinjection = this.deps.sessionState.getLastReinjectionAt(agentId);
    if (now - lastReinjection < 60_000) return;

    this.deps.sessionState.setLastReinjectionAt(agentId, now);

    const lastInbound = this.deps.sessionState.getLastInboundMessage(agentId);
    const reinjectionText = builder.buildReinjection(lastInbound);
    if (!reinjectionText) return;

    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    log.info("scheduling reinjection after context compression", { agentId, sessionId, messageId: sessionInfo?.lastTurnMessageId });

    const entry: QueuedPrompt = {
      id: crypto.randomUUID(),
      agentId,
      sessionId,
      text: reinjectionText,
      context: undefined,
      enqueuedAt: new Date().toISOString(),
      status: "pending",
    };

    const key = sessionKey(agentId, sessionId);
    const queue = this.deps.sessionState.getQueue(key);
    queue.unshift(entry);
    this.deps.sessionState.setQueue(key, queue);
  }

  bufferToolCall(agentId: string, sessionId: string, newCall: import("../../domain/models/chat").ToolCall): void {
    const key = sessionKey(agentId, sessionId);
    let buffered = this.deps.sessionState.getPendingToolCalls(key);
    if (!buffered) {
      buffered = new Map();
      this.deps.sessionState.setPendingToolCalls(key, buffered);
    }

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

  private flushToolCallGroup(
    agentId: string,
    sessionId: string,
    kind: string,
    calls: import("../../domain/models/chat").ToolCall[]
  ): void {
    if (calls.length === 0) return;
    // grouped tool calls become a single ChatMessage so the
    // webview pipeline can render them as one ToolCallCard.
    const toolMsg: ChatMessage = {
      id: `tool-${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      role: "tool",
      content: "",
      timestamp: Date.now(),
      agentId,
      sessionId,
      toolCalls: calls,
    };
    this.deps.appendToolMessage(agentId, sessionId, toolMsg);
  }

  /** Flush buffered tool calls as ChatMessage → appendToolMessage → sessionMessage event. */
  public flushPendingToolCalls(agentId: string, sessionId: string): void {
    const key = sessionKey(agentId, sessionId);
    const buffered = this.deps.sessionState.getPendingToolCalls(key);
    if (buffered) {
      for (const [kind, calls] of buffered) {
        if (calls.length > 0) {
          this.flushToolCallGroup(agentId, sessionId, kind, calls);
        }
      }
    }
    this.deps.sessionState.clearPendingToolCalls(key);
  }
}
