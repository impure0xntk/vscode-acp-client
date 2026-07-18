import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolCallContent,
  AvailableCommand,
} from "@agentclientprotocol/sdk";
import type { ToolCall } from "../../domain/models/chat";
import type { AppSessionInfo } from "./types";
import type { SessionState } from "./session-state";
import { sessionKey } from "./session-state";
import type { PromptExecution } from "./prompt-execution";
import type { UIAPI } from "../../platform/ui";
import { getLogger } from "../../platform/backends";
import { mapToolKind } from "../../adapter/acp/tool-utils";
import {
  getStandardPermissionOptions,
  requestPermissionViaQuickPick,
} from "../../adapter/acp/permissions";
import { Ref } from "../../shared/util/ref";

const log = getLogger("protocol-handler");

/**
 * Micro-batch buffer for streaming text chunks.
 * Accumulates agent_message_chunk text and flushes on a timer,
 * on tool_call arrival, or on turn end.
 */
interface TextBatch {
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
  messageId?: string | null;
}

const TEXT_BATCH_FLUSH_MS = 150;

export interface ProtocolHandlerDeps {
  /** Forward ref — set by orchestrator after PromptExecution is created. */
  promptExecution: Ref<PromptExecution>;
  sessionState: SessionState;
  ui: UIAPI;
  /** Callback to emit events to external listeners */
  emit: (event: string, ...args: unknown[]) => void;
}

export class ProtocolHandler {
  private deps: ProtocolHandlerDeps;
  // sessionKey → AvailableCommand[]
  private sessionCommands: Map<string, AvailableCommand[]> = new Map();
  // sessionKey → buffered thought chunk + timer (flushed as agent_thought_chunk)
  private pendingThoughts: Map<
    string,
    {
      text: string;
      messageId?: string | null;
      timer: ReturnType<typeof setTimeout> | null;
    }
  > = new Map();
  // sessionKey → micro-batch for agent_message_chunk text
  private pendingTextBatch: Map<string, TextBatch> = new Map();
  // sessionKey → last seen ACP messageId (for step boundary detection)
  private lastSeenMessageId: Map<string, string | null> = new Map();
  /** Drain window for late notifications after turn end. */
  private turnEndedAt: Map<string, number> = new Map();
  private static readonly DRAIN_WINDOW_MS = 2000;

  constructor(deps: ProtocolHandlerDeps) {
    this.deps = deps;
  }

  private flushTextBatch(
    agentId: string,
    sessionId: string,
    silent = false
  ): void {
    const sKey = sessionKey(agentId, sessionId);
    const batch = this.pendingTextBatch.get(sKey);
    if (!batch) return;

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    const text = batch.text;
    const batchMessageId = batch.messageId ?? undefined;
    if (!text) {
      this.pendingTextBatch.delete(sKey);
      return;
    }
    this.pendingTextBatch.delete(sKey);

    const sessionInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      sessionId
    );
    if (!sessionInfo) return;

    if (!silent && !sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }

    log.trace("flushTextBatch", {
      agentId,
      sessionId,
      messageId: batchMessageId,
      chunkLen: text.length,
    });
    this.deps.emit("sessionStreamChunk", {
      agentId,
      sessionId,
      chunk: text,
      messageId: batchMessageId,
      sessionUpdate: "agent_message_chunk",
    });
    sessionInfo.lastResponseAt = new Date().toISOString();
  }

  getSessionCommands(sessionKey: string): AvailableCommand[] {
    return this.sessionCommands.get(sessionKey) ?? [];
  }

  handleSessionUpdate(
    agentId: string,
    notification: SessionNotification
  ): void {
    const { sessionId, update } = notification;
    const sessionInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      sessionId
    );
    if (!sessionInfo) return;

    if (
      sessionInfo.status !== "running" &&
      sessionInfo.status !== "cancelling"
    ) {
      const sKey = sessionKey(agentId, sessionId);
      const endedAt = this.turnEndedAt.get(sKey);
      if (endedAt == null) return;
      const elapsed = Date.now() - endedAt;
      if (elapsed > ProtocolHandler.DRAIN_WINDOW_MS) {
        this.turnEndedAt.delete(sKey);
        return;
      }
      log.debug("late notification drained", {
        agentId,
        sessionId,
        kind: update.sessionUpdate,
        elapsedMs: elapsed,
      });
      this.deps.emit("sessionUpdate", { agentId, sessionId, notification });
      return;
    }

    if (sessionInfo.status === "cancelling") {
      sessionInfo.status = "idle";
      sessionInfo.lastTurnOutcome = "cancelled";
      sessionInfo.pendingCancel = false;
      sessionInfo.isStreaming = false;
      sessionInfo.updatedAt = new Date();
      this.deps.emit("sessionTurnActiveChanged", {
        agentId,
        sessionId,
        active: false,
        stopReason: "cancelled",
      });
      return;
    }

    sessionInfo.updatedAt = new Date();

    const kind = update.sessionUpdate;

    switch (kind) {
      case "agent_message_chunk":
        this.handleAgentMessageChunk(agentId, sessionId, sessionInfo, update);
        break;
      case "agent_thought_chunk":
        this.handleAgentThoughtChunk(agentId, sessionId, sessionInfo, update);
        break;
      case "tool_call":
        this.flushThoughts(agentId, sessionId, true);
        this.flushTextBatch(agentId, sessionId);
        this.handleToolCall(agentId, sessionId, sessionInfo, update);
        break;
      case "tool_call_update":
        this.handleToolCallUpdate(agentId, sessionId, sessionInfo, update);
        break;
      case "plan":
      case "plan_update":
      case "plan_removed":
        break;
      case "available_commands_update": {
        const key = sessionKey(agentId, sessionId);
        const u3 = update as { availableCommands?: AvailableCommand[] };
        this.sessionCommands.set(key, u3.availableCommands ?? []);
        this.deps.emit("sessionCommandsUpdated", {
          agentId,
          sessionId,
          commands: u3.availableCommands ?? [],
        });
        break;
      }
      case "current_mode_update":
        sessionInfo.mode = (update as { currentModeId: string }).currentModeId;
        break;
      case "config_option_update":
        this.handleConfigOptionUpdate(sessionInfo, update);
        break;
      case "session_info_update": {
        const u2 = update as { title?: string | null };
        if (u2.title !== undefined && u2.title !== null) {
          sessionInfo.title = u2.title;
        }
        break;
      }
      case "usage_update":
        this.handleUsageUpdate(agentId, sessionId, sessionInfo, update);
        break;
      case "user_message_chunk":
        break;
    }

    if (kind === "session_info_update" || kind === "usage_update") {
      this.flushThoughts(agentId, sessionId, true);
      this.flushTextBatch(agentId, sessionId, true);
    }

    this.deps.emit("sessionUpdate", { agentId, sessionId, notification });
  }

  private flushThoughts(
    agentId: string,
    sessionId: string,
    silent = false
  ): void {
    const sKey = sessionKey(agentId, sessionId);
    const entry = this.pendingThoughts.get(sKey);
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.pendingThoughts.delete(sKey);
    if (entry.text.length === 0) return;

    const sessionInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      sessionId
    );
    if (!sessionInfo) return;

    if (!silent && !sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }

    const buffered = entry.text;
    const existing = this.deps.sessionState.getStreamMsgRef(sKey);
    if (existing) {
      this.deps.sessionState.appendStreamText(sKey, buffered);
    } else {
      const msgId =
        entry.messageId ?? `stream-${sessionId}-${crypto.randomUUID()}`;
      this.deps.sessionState.setStreamMsgRef(sKey, {
        agentId,
        sessionId,
        msgId,
      });
      this.deps.sessionState.setStreamText(sKey, buffered);
    }
    this.deps.emit("sessionStreamChunk", {
      agentId,
      sessionId,
      chunk: buffered,
      messageId: entry.messageId ?? undefined,
      sessionUpdate: "agent_thought_chunk",
    });
    sessionInfo.lastResponseAt = new Date().toISOString();
  }

  private handleAgentThoughtChunk(
    agentId: string,
    sessionId: string,
    sessionInfo: AppSessionInfo,
    update: unknown
  ): void {
    sessionInfo.status = "running";
    if (!sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }
    const sKey = sessionKey(agentId, sessionId);
    const u = update as {
      content?: { text?: string };
      messageId?: string | null;
    };
    const delta = u.content?.text ?? "";
    if (!delta) return;
    const existingThought = this.pendingThoughts.get(sKey);
    if (existingThought) {
      existingThought.text += delta;
      if (u.messageId != null && existingThought.messageId == null) {
        existingThought.messageId = u.messageId;
      }
    } else {
      const thought = {
        text: delta,
        messageId: u.messageId ?? null,
        timer: null as ReturnType<typeof setTimeout> | null,
      };
      thought.timer = setTimeout(() => {
        this.flushThoughts(agentId, sessionId);
      }, TEXT_BATCH_FLUSH_MS);
      this.pendingThoughts.set(sKey, thought);
    }
  }

  private handleAgentMessageChunk(
    agentId: string,
    sessionId: string,
    sessionInfo: AppSessionInfo,
    update: unknown
  ): void {
    sessionInfo.status = "running";
    sessionInfo.lastResponseAt = new Date().toISOString();

    this.deps.promptExecution.value.flushPendingToolCalls(agentId, sessionId);

    const u = update as Record<string, unknown>;
    const content = u.content as Record<string, unknown> | undefined;
    const text =
      content?.type === "text" ? (content.text as string) : undefined;
    const messageId = (u.messageId as string | null) ?? null;

    const sKey = sessionKey(agentId, sessionId);
    if (!sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }

    if (text) {
      const existing = this.pendingTextBatch.get(sKey);
      if (existing) {
        existing.text += text;
        if (messageId != null && existing.messageId == null) {
          existing.messageId = messageId;
        }
      } else {
        const batch: TextBatch = { text, timer: null, messageId };
        batch.timer = setTimeout(() => {
          this.flushTextBatch(agentId, sessionId);
        }, TEXT_BATCH_FLUSH_MS);
        this.pendingTextBatch.set(sKey, batch);
      }
      sessionInfo.lastResponseAt = new Date().toISOString();
    }
  }

  private handleToolCall(
    agentId: string,
    sessionId: string,
    sessionInfo: AppSessionInfo,
    update: unknown
  ): void {
    sessionInfo.status = "running";
    if (!sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }

    const u = update as Record<string, unknown>;
    const tcMessageId = (u.messageId as string | null) ?? null;
    const sKey = sessionKey(agentId, sessionId);
    const tcLocations = (
      u.locations as Array<{ path: string; line?: number }> | undefined
    )?.map((loc) => ({
      path: loc.path,
      line: loc.line ?? undefined,
    }));
    const tcDiff = extractDiffContent(
      u.content as ToolCallContent[] | undefined
    );

    const toolName = (u.title as string) ?? "";
    const newCall: ToolCall = {
      id: u.toolCallId as string,
      title: toolName,
      status: normalizeToolStatus(u.status as string | null | undefined),
      kind: (u.kind as string) ?? mapToolKind(toolName),
      input:
        typeof u.rawInput === "string"
          ? (u.rawInput as string)
          : safeJsonStringify(u.rawInput),
      output:
        u.rawOutput !== undefined
          ? typeof u.rawOutput === "string"
            ? (u.rawOutput as string)
            : safeJsonStringify(u.rawOutput)
          : undefined,
      locations: tcLocations,
      diffContent: tcDiff,
    };

    if (tcMessageId !== null) {
      this.lastSeenMessageId.set(sKey, tcMessageId);
    }

    this.deps.promptExecution.value.bufferToolCall(agentId, sessionId, newCall);
  }

  private handleToolCallUpdate(
    agentId: string,
    sessionId: string,
    _sessionInfo: AppSessionInfo,
    update: unknown
  ): void {
    const sKey = sessionKey(agentId, sessionId);
    const buffered = this.deps.sessionState.getPendingToolCalls(sKey);
    const u = update as Record<string, unknown>;

    if (buffered) {
      for (const [, calls] of buffered) {
        const tc = calls.find((c) => c.id === (u.toolCallId as string));
        if (tc) {
          if (u.title !== undefined) tc.title = (u.title as string) ?? "";
          if (u.status !== undefined)
            tc.status = normalizeToolStatus(
              u.status as string | null | undefined
            );
          if (u.kind !== undefined) tc.kind = (u.kind as string) ?? "";
          if (u.rawInput !== undefined) {
            tc.input =
              typeof u.rawInput === "string"
                ? (u.rawInput as string)
                : safeJsonStringify(u.rawInput);
          }
          if (u.rawOutput !== undefined) {
            tc.output =
              typeof u.rawOutput === "string"
                ? (u.rawOutput as string)
                : safeJsonStringify(u.rawOutput);
          }
          if (u.locations) {
            tc.locations = (
              u.locations as Array<{ path: string; line?: number }>
            ).map((loc) => ({ path: loc.path, line: loc.line ?? undefined }));
          }
          const tcDiff = u.content
            ? extractDiffContent(u.content as ToolCallContent[])
            : undefined;
          if (tcDiff) tc.diffContent = tcDiff;
          return;
        }
      }
    }
  }

  private handleConfigOptionUpdate(
    sessionInfo: AppSessionInfo,
    update: unknown
  ): void {
    const u = update as { configOptions: Array<Record<string, unknown>> };
    for (const opt of u.configOptions) {
      const category = opt.category as string | undefined;
      const id = opt.id as string;
      if (category === "model" || id.includes("model")) {
        const type = opt.type as string | undefined;
        if (type === "select") {
          const currentVal = opt.currentValue as string | undefined;
          const flatOptions: Array<{ name: string; value: string }> = [];
          const rawOptions = opt.options as Array<Record<string, unknown>>;
          for (const item of rawOptions) {
            if ("value" in item && typeof item.value === "string") {
              flatOptions.push({
                value: item.value,
                name: (item.name as string) ?? "",
              });
            } else if ("options" in item && Array.isArray(item.options)) {
              for (const sub of item.options as Array<
                Record<string, unknown>
              >) {
                if ("value" in sub && typeof sub.value === "string") {
                  flatOptions.push({
                    value: sub.value,
                    name: (sub.name as string) ?? "",
                  });
                }
              }
            }
          }
          const selected = flatOptions.find((o) => o.value === currentVal);
          sessionInfo.model = selected?.name ?? currentVal;
        }
      }
    }
  }

  private handleUsageUpdate(
    agentId: string,
    sessionId: string,
    sessionInfo: AppSessionInfo,
    update: unknown
  ): void {
    const u = update as Record<string, unknown>;
    const size = u.size as number | null | undefined;
    const used = u.used as number | null | undefined;
    const prevTotal = sessionInfo.tokenUsage.total;
    const prevContextUsed = sessionInfo._prevContextUsed;
    const newUsed =
      used !== undefined && used !== null && used > 0 ? used : prevTotal;

    const contextWindowSize =
      size !== undefined && size !== null && size > 0
        ? size
        : (sessionInfo.contextWindowMax ?? 0);

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
        this.deps.emit("sessionContextCompressed", {
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
    sessionInfo._prevContextUsed = newUsed;
  }

  async handleRequestPermission(
    agentId: string,
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    return requestPermissionViaQuickPick(
      { ui: this.deps.ui },
      agentId,
      request
    );
  }

  flushAllBatches(agentId: string, sessionId: string): void {
    this.flushThoughts(agentId, sessionId);
    this.flushTextBatch(agentId, sessionId);
  }

  /** Get the last seen ACP messageId for a session (for step boundary logging). */
  getLastSeenMessageId(
    agentId: string,
    sessionId: string
  ): string | null | undefined {
    return this.lastSeenMessageId.get(sessionKey(agentId, sessionId));
  }

  /** Reset step boundary tracking for a session (called on turn end). */
  resetStepTracking(agentId: string, sessionId: string): void {
    const sKey = sessionKey(agentId, sessionId);
    this.lastSeenMessageId.delete(sKey);
    this.turnEndedAt.set(sKey, Date.now());
  }
}

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
