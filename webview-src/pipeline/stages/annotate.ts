import type {
  AnnotateConfig,
  ChatDisplayItem,
  ClassifiedMessage,
  CompressionDisplayItem,
  CustomSystemDisplayItem,
  ErrorNoticeDisplayItem,
  ModeChangeDisplayItem,
  PipelineItem,
  RenderContext,
  ResolvedAttachment,
  ResolvedToolCall,
  SessionCompressionInfo,
} from "../types";
import type { ContextAttachment } from "../../types";
import { extractCandidatePaths } from "../../lib/pathPatterns";

function resolveToolCalls(
  msg: ClassifiedMessage
): ResolvedToolCall[] | undefined {
  const raw = msg.toolCalls as
    | Array<{
        id: string;
        title?: string;
        kind?: string;
        status?: string;
        input?: Record<string, unknown> | string;
        output?: string;
        durationMs?: number;
        locations?: { path: string; line?: number }[];
        diffContent?: {
          type: "diff";
          diff: string;
          oldPath?: string;
          newPath?: string;
        };
      }>
    | undefined;

  if (!raw || raw.length === 0) return undefined;

  return raw.map((tc) => ({
    id: tc.id,
    title: tc.title ?? tc.id,
    kind: tc.kind ?? "generic",
    status: (tc.status as ResolvedToolCall["status"]) ?? "completed",
    input: tc.input,
    output: tc.output,
    durationMs: tc.durationMs,
    locations: tc.locations,
    diffContent: tc.diffContent,
  }));
}

function resolveAttachments(
  msg: ClassifiedMessage,
  _config: AnnotateConfig
): ResolvedAttachment[] {
  const raw = msg.attachments as ContextAttachment[] | undefined;
  if (!raw) return [];

  return raw.map((att, i) => ({
    id: att.id ?? `att-${i}`,
    type: att.type ?? "file",
    path: att.path ?? "",
    label: att.label ?? att.path ?? "attachment",
    lineRange: att.lineRange,
    tokenCount: att.tokenCount ?? 0,
    message: att.message,
    isNavigable: !!att.path,
    extension: (att.path ?? "").split(".").pop() ?? "",
    detail: att.label ?? "",
  }));
}

/**
 * Extract path candidates from inline code spans in the message content.
 * Runs synchronously during annotation — no FS access, just pattern matching.
 */
function buildRenderContext(msg: ClassifiedMessage): RenderContext | undefined {
  const inlineCodeRegex = /`([^`]+)`/g;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = inlineCodeRegex.exec(msg.content)) !== null) {
    const code = match[1];
    const paths = extractCandidatePaths(code);
    candidates.push(...paths);
  }
  if (candidates.length === 0) return undefined;
  return { filePaths: new Set(candidates) };
}

/**
 * Map a classified message to the appropriate PipelineItem variant.
 * Each variant is rendered by a dedicated UI component in ChatContainer.
 * Computes isFirstOfTurn: true only for the first agent/tool message of a turn
 * (i.e., the item immediately following a user/system message or at the start).
 */
interface _TurnState {
  prevWasTurnBoundary: boolean;
}

function toPipelineItem(
  msg: ClassifiedMessage,
  _config: AnnotateConfig,
  state: _TurnState
): PipelineItem | null {
  const baseKey = `${msg.role}-${msg.id ?? msg.timestamp ?? "unknown"}`;
  const ts = msg.timestamp;
  const key = `chat-${baseKey}`;
  const prevWasTurnBoundary = state.prevWasTurnBoundary;
  let isFirstOfTurn = false;

  switch (msg.systemKind) {
    case "compression": {
      const info = msg.compressionInfo as SessionCompressionInfo | undefined;
      state.prevWasTurnBoundary = true;
      if (!info) return null;
      return {
        type: "compression",
        info,
        key: `compression-${baseKey}`,
        timestamp: ts,
      } satisfies CompressionDisplayItem;
    }

    case "mode_change":
      state.prevWasTurnBoundary = true;
      return {
        type: "mode_change",
        content: msg.content,
        key: `mode-${baseKey}`,
        timestamp: ts,
      } satisfies ModeChangeDisplayItem;

    case "error_notice":
      state.prevWasTurnBoundary = true;
      return {
        type: "error_notice",
        content: msg.content,
        key: `error-${baseKey}`,
        timestamp: ts,
      } satisfies ErrorNoticeDisplayItem;

    case "custom":
      state.prevWasTurnBoundary = true;
      return {
        type: "custom",
        content: msg.content,
        key: `custom-${baseKey}`,
        timestamp: ts,
      } satisfies CustomSystemDisplayItem;

    case "info":
    default: {
      const thinking =
        msg.thinking != null
          ? {
              content: msg.thinking.content,
              isStreaming: msg.thinking.isStreaming ?? false,
            }
          : undefined;

      const renderContext: RenderContext | undefined = _config.detectInlinePaths
        ? buildRenderContext(msg)
        : undefined;

      // First-of-turn: true means "this agent/tool message is the first
      // item of a new turn → show the header".  True when preceded by a
      // user message, a system notice, or at the start.
      const isAgentOrTool = msg.role === "agent" || msg.role === "tool";
      isFirstOfTurn = isAgentOrTool && prevWasTurnBoundary && isAgentOrTool;

      // Update turn state for next message.
      if (msg.role === "user") {
        state.prevWasTurnBoundary = true;
      } else if (isFirstOfTurn) {
        // This agent consumed the boundary; subsequent ones are not.
        state.prevWasTurnBoundary = false;
      } else {
        state.prevWasTurnBoundary = false;
      }

      return {
        type: "chat",
        role: msg.role,
        content: msg.content,
        key,
        timestamp: ts,
        agentId: msg.agentId,
        sessionId: msg.sessionId,
        messageId: msg.messageId ?? msg.id,
        resolvedToolCalls: resolveToolCalls(msg),
        attachments: resolveAttachments(msg, _config),
        renderContext,
        thinking,
        isFirstOfTurn,
        stopReason: msg.stopReason,
        writeSeq: msg.writeSeq,
      } satisfies ChatDisplayItem;
    }
  }
}

/**
 * Annotate classified messages into PipelineItem[].
 *
 * Turn-start detection (isFirstOfTurn): an agent/tool message is the first of
 * a new turn when the preceding message is a user message or a system-kind
 * notice (compression, mode_change, error_notice, custom).
 */
export function annotateMessages(
  messages: ClassifiedMessage[],
  config: AnnotateConfig
): PipelineItem[] {
  const items: PipelineItem[] = [];
  // Track seen keys to resolve collisions defensively.
  // If two messages produce the same key (e.g. duplicate tool messages
  // with the same id after merge promotion), append a counter so React
  // children always have unique keys.
  const seenKeys = new Map<string, number>();
  // The previous message was a turn boundary (user/system/start → next agent/tool shows header).
  const state = { prevWasTurnBoundary: true };

  for (const msg of messages) {
    const item = toPipelineItem(msg, config, state);
    if (item) {
      // Resolve key collisions by appending a counter.
      const baseKey = item.key;
      const count = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, count + 1);
      if (count > 0) {
        item.key = `${baseKey}-${count}`;
      }
      items.push(item);
    }
  }

  return items;
}
