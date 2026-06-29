import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  StopReason,
  ToolCallContent,
  AvailableCommand,
} from "@agentclientprotocol/sdk";
import type { ChatMessage, ToolCall } from "../../domain/models/chat";
import type { AppSessionInfo } from "./types";
import type { AgentConnection } from "./agent-connection";
import type { SessionState } from "./session-state";
import { sessionKey } from "./session-state";
import type { PromptExecution } from "./prompt-execution";
import type { UIAPI } from "../../platform/ui";
import { getLogger } from "../../platform/backends";

const log = getLogger("protocol-handler");

/**
 * Micro-batch buffer for streaming text chunks.
 * Accumulates agent_message_chunk text and flushes on a timer,
 * on tool_call arrival, or on turn end.  This prevents one
 * postMessage per character (Codex/Copilot) from overwhelming
 * the extension host ↔ webview channel.
 */
interface TextBatch {
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
  chunkCount: number;
  /** ACP SDK messageId for this message — used to merge chunks across tool boundaries. */
  messageId?: string | null;
}

const TEXT_BATCH_FLUSH_MS = 150;
const TEXT_BATCH_MAX_CHUNKS = 20;

export interface ProtocolHandlerDeps {
  agentConnection: AgentConnection;
  sessionState: SessionState;
  promptExecution: PromptExecution;
  ui: UIAPI;
  historyStore: import("./persistentHistory").PersistentHistoryStore | null;
  sessionHistoryStore: import("./historyStore").SessionHistoryStore | null;
  /** Callback to emit events to external listeners */
  emit: (event: string, ...args: unknown[]) => void;
}

export class ProtocolHandler {
  private deps: ProtocolHandlerDeps;
  // sessionKey → AvailableCommand[]
  private sessionCommands: Map<string, AvailableCommand[]> = new Map();
  // sessionKey → buffered thought text (flushed on turn end or message chunk)
  private pendingThoughts: Map<string, string> = new Map();
  // sessionKey → micro-batch for agent_message_chunk text
  private pendingTextBatch: Map<string, TextBatch> = new Map();
  constructor(deps: ProtocolHandlerDeps) {
    this.deps = deps;
  }

  private flushTextBatch(agentId: string, sessionId: string, silent = false): void {
    const sKey = sessionKey(agentId, sessionId);
    const batch = this.pendingTextBatch.get(sKey);
    if (!batch) return;

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    const text = batch.text;
    if (!text) {
      this.pendingTextBatch.delete(sKey);
      return;
    }
    this.pendingTextBatch.delete(sKey);

    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;

    if (!silent && !sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }

    this.deps.emit("sessionStreamChunk", { agentId, sessionId, chunk: text, messageId: batch.messageId ?? undefined });
    sessionInfo.lastResponseAt = new Date().toISOString();
  }

  private emitImmediateChunk(
    agentId: string,
    sessionId: string,
    sessionInfo: AppSessionInfo,
    text: string,
    messageId?: string | null
  ): void {
    if (!sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }
    this.deps.emit("sessionStreamChunk", { agentId, sessionId, chunk: text, messageId });
    sessionInfo.lastResponseAt = new Date().toISOString();
  }

  getSessionCommands(sessionKey: string): AvailableCommand[] {
    return this.sessionCommands.get(sessionKey) ?? [];
  }

  handleSessionUpdate(agentId: string, notification: SessionNotification): void {
    const { sessionId, update } = notification;
    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;

    if (sessionInfo.status !== "running" && sessionInfo.status !== "cancelling") {
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
        sessionInfo.status = "running";
        this.flushTextBatch(agentId, sessionId);
        if (!sessionInfo.isStreaming) {
          sessionInfo.isStreaming = true;
          this.deps.emit("sessionStreamStart", { agentId, sessionId });
        }
        {
          const sKey = sessionKey(agentId, sessionId);
          const existing = this.pendingThoughts.get(sKey) ?? "";
          const u = update as { content?: { text?: string } };
          const delta = u.content?.text ?? "";
          this.pendingThoughts.set(sKey, existing + delta);
        }
        break;
      case "tool_call":
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
      this.flushTextBatch(agentId, sessionId, true);
      this.flushThoughts(agentId, sessionId, true);
    }

    this.deps.emit("sessionUpdate", { agentId, sessionId, notification });
  }

  private flushThoughts(agentId: string, sessionId: string, silent = false): void {
    const sKey = sessionKey(agentId, sessionId);
    const buffered = this.pendingThoughts.get(sKey);
    if (!buffered || buffered.length === 0) {
      this.pendingThoughts.delete(sKey);
      return;
    }
    this.pendingThoughts.delete(sKey);

    const sessionInfo = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    if (!sessionInfo) return;

    this.flushTextBatch(agentId, sessionId, silent);

    if (!silent && !sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }

    const existing = this.deps.sessionState.getStreamMsgRef(sKey);
    if (existing) {
      this.deps.sessionState.appendStreamText(sKey, buffered);
    } else {
      const msgId = `stream-${sessionId}-${crypto.randomUUID()}`;
      this.deps.sessionState.setStreamMsgRef(sKey, { agentId, sessionId, msgId });
      this.deps.sessionState.setStreamText(sKey, buffered);
    }
    this.deps.emit("sessionStreamChunk", { agentId, sessionId, chunk: buffered });
    sessionInfo.lastResponseAt = new Date().toISOString();
  }

  private handleAgentMessageChunk(
    agentId: string,
    sessionId: string,
    sessionInfo: AppSessionInfo,
    update: unknown
  ): void {
    sessionInfo.status = "running";
    sessionInfo.lastResponseAt = new Date().toISOString();

    this.deps.promptExecution.flushPendingToolCalls(agentId, sessionId);

    const u = update as Record<string, unknown>;
    const content = u.content as Record<string, unknown> | undefined;
    const text = content?.type === "text" ? (content.text as string) : undefined;
    // ACP SDK messageId — identifies the logical message this chunk belongs to.
    // When a tool_call interrupts streaming, subsequent chunks with the same
    // messageId belong to the same message and must be merged.
    const messageId = (u.messageId as string | null) ?? null;

    if (!sessionInfo.isStreaming) {
      sessionInfo.isStreaming = true;
      this.deps.emit("sessionStreamStart", { agentId, sessionId });
    }

    this.flushThoughts(agentId, sessionId);

    if (text) {
      const sKey = sessionKey(agentId, sessionId);
      const existing = this.pendingTextBatch.get(sKey);
      if (existing) {
        existing.text += text;
        // Track messageId so flushTextBatch can propagate it.
        if (messageId != null && existing.messageId == null) {
          existing.messageId = messageId;
        }
        existing.chunkCount++;
        if (existing.chunkCount >= TEXT_BATCH_MAX_CHUNKS) {
          this.flushTextBatch(agentId, sessionId);
        }
      } else {
        this.emitImmediateChunk(agentId, sessionId, sessionInfo, text, messageId);
        const batch: TextBatch = { text: "", timer: null, chunkCount: 0, messageId };
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
    const tcLocations = (u.locations as Array<{ path: string; line?: number }> | undefined)?.map((loc) => ({
      path: loc.path,
      line: loc.line ?? undefined,
    }));
    const tcDiff = extractDiffContent(u.content as ToolCallContent[] | undefined);

    const inputSummary = truncateForLog(
      typeof u.rawInput === "string" ? u.rawInput as string : JSON.stringify(u.rawInput),
      200,
    );

    const newCall: ToolCall = {
      id: u.toolCallId as string,
      title: (u.title as string) ?? "",
      status: normalizeToolStatus(u.status as string | null | undefined),
      kind: (u.kind as string) ?? "",
      input: typeof u.rawInput === "string" ? u.rawInput as string : JSON.stringify(u.rawInput),
      output: u.rawOutput !== undefined
        ? (typeof u.rawOutput === "string" ? u.rawOutput as string : JSON.stringify(u.rawOutput))
        : undefined,
      locations: tcLocations,
      diffContent: tcDiff,
    };

    log.info("tool_call", {
      agentId,
      sessionId,
      toolCallId: newCall.id,
      title: newCall.title,
      kind: newCall.kind,
      status: newCall.status,
      inputSummary,
      hasLocations: (tcLocations?.length ?? 0) > 0,
      hasDiff: tcDiff !== undefined,
    });

    this.deps.promptExecution.bufferToolCall(agentId, sessionId, newCall);
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
          if (u.status !== undefined) tc.status = normalizeToolStatus(u.status as string | null | undefined);
          if (u.kind !== undefined) tc.kind = (u.kind as string) ?? "";
          if (u.rawInput !== undefined) {
            tc.input = typeof u.rawInput === "string" ? u.rawInput as string : JSON.stringify(u.rawInput);
          }
          if (u.rawOutput !== undefined) {
            tc.output = typeof u.rawOutput === "string" ? u.rawOutput as string : JSON.stringify(u.rawOutput);
          }
          if (u.locations) {
            tc.locations = (u.locations as Array<{ path: string; line?: number }>).map((loc) => ({ path: loc.path, line: loc.line ?? undefined }));
          }
          const tcDiff = u.content ? extractDiffContent(u.content as ToolCallContent[]) : undefined;
          if (tcDiff) tc.diffContent = tcDiff;

          const outputSummary = u.rawOutput !== undefined
            ? truncateForLog(
                typeof u.rawOutput === "string" ? u.rawOutput as string : JSON.stringify(u.rawOutput),
                200,
              )
            : undefined;

          log.info("tool_call_update", {
            agentId,
            sessionId,
            toolCallId: tc.id,
            status: tc.status,
            outputSummary,
            hasDiff: tcDiff !== undefined,
          });
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
              flatOptions.push({ value: item.value, name: (item.name as string) ?? "" });
            } else if ("options" in item && Array.isArray(item.options)) {
              for (const sub of item.options as Array<Record<string, unknown>>) {
                if ("value" in sub && typeof sub.value === "string") {
                  flatOptions.push({ value: sub.value, name: (sub.name as string) ?? "" });
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
    const newUsed = (used !== undefined && used !== null && used > 0)
      ? used
      : prevTotal;

    const contextWindowSize = (size !== undefined && size !== null && size > 0)
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
        (dropRatio >= COMPRESSION_RATIO_THRESHOLD || drop >= COMPRESSION_ABS_THRESHOLD)
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
    const qpItems = request.options.map((o) => ({
      label: o.name ?? o.optionId,
      description: o.kind ?? undefined,
      picked: false,
    }));

    const kindLabel =
      request.toolCall.kind === "edit" ? "Edit"
      : request.toolCall.kind === "execute" ? "Execute"
      : request.toolCall.kind === "fetch" ? "Fetch"
      : (request.toolCall.kind ?? "Action");

    const title = `[${agentId}] ${kindLabel}: ${request.toolCall.title ?? "(no title)"}`;

    const result = await this.deps.ui.showQuickPick(qpItems, { placeHolder: title });

    if (!result) {
      return { outcome: { outcome: "cancelled" } };
    }

    const label = (result as { label: string }).label;
    const matchedOption = request.options.find((o) => (o.name ?? o.optionId) === label);
    const optionId = matchedOption?.optionId;
    if (!optionId) {
      return { outcome: { outcome: "cancelled" } };
    }
    return { outcome: { outcome: "selected", optionId } };
  }

  private flushPendingToolCalls(agentId: string, sessionId: string): void {
    const key = sessionKey(agentId, sessionId);
    this.flushTextBatch(agentId, sessionId);
    this.deps.sessionState.clearPendingToolCalls(key);
  }

  flushAllBatches(agentId: string, sessionId: string): void {
    this.flushTextBatch(agentId, sessionId);
    this.flushThoughts(agentId, sessionId);
  }
}

function truncateForLog(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + `...(${value.length - maxLen} more chars)`;
}

function normalizeToolStatus(
  raw: string | null | undefined
): "in_progress" | "completed" | "failed" | "cancelled" {
  if (raw === "pending") return "in_progress";
  if (raw === "in_progress" || raw === "completed" || raw === "failed" || raw === "cancelled") {
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
