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

/**
 * Check if the previous chat item has resolved tool calls.
 * Used to detect tool-call boundaries where a subsequent agent message
 * should NOT be treated as consecutive (it's a new step after tool execution).
 */
function previousHasToolCalls(
  items: PipelineItem[]
): boolean {
  if (items.length === 0) return false;
  const prev = items[items.length - 1];
  if (prev.type !== "chat") return false;
  const tcs = (prev as ChatDisplayItem).resolvedToolCalls;
  return tcs != null && tcs.length > 0;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
 * Build the group key used to detect consecutive messages from the same source.
 * Messages sharing the same groupKey as their predecessor are marked consecutive
 * (header hidden).
 */
function groupKeyOf(msg: ClassifiedMessage): string {
  if (msg.systemKind !== "info") return "";
  // Note: msg.role may be "agent" for tool messages promoted by merge.
  // We use msg.role (not originalRole) so that promoted tool messages share
  // the same "agent:xxx" groupKey as subsequent real agent messages.
  // The annotateMessages function and SessionChatContainer use originalRole
  // separately to determine which messages qualify as final responses.
  switch (msg.role) {
    case "agent":
      return `agent:${msg.agentId ?? "unknown"}`;
    case "tool":
      return `tool:${msg.agentId ?? "unknown"}`;
    case "system":
      return "system";
    case "user":
      return "user";
    default:
      return msg.role;
  }
}

// ── ClassifiedMessage → PipelineItem ────────────────────────────────────────

/**
 * Map a classified message to the appropriate PipelineItem variant.
 * Each variant is rendered by a dedicated UI component in ChatContainer.
 * Also computes isConsecutive / groupKey for header omission.
 */
function toPipelineItem(
  msg: ClassifiedMessage,
  _config: AnnotateConfig,
  prevGroupKey: string
): { item: PipelineItem | null; groupKey: string } {
  const baseKey = `${msg.role}-${msg.id ?? msg.timestamp ?? "unknown"}`;
  const ts = msg.timestamp;
  const key = `chat-${baseKey}`;
  const gk = groupKeyOf(msg);
  const isConsecutive = gk !== "" && gk === prevGroupKey;

  switch (msg.systemKind) {
    case "compression": {
      const info = msg.compressionInfo as SessionCompressionInfo | undefined;
      if (!info) return { item: null, groupKey: "" };
      return {
        item: {
          type: "compression",
          info,
          key: `compression-${baseKey}`,
          timestamp: ts,
        } satisfies CompressionDisplayItem,
        groupKey: "",
      };
    }

    case "mode_change":
      return {
        item: {
          type: "mode_change",
          content: msg.content,
          key: `mode-${baseKey}`,
          timestamp: ts,
        } satisfies ModeChangeDisplayItem,
        groupKey: "",
      };

    case "error_notice":
      return {
        item: {
          type: "error_notice",
          content: msg.content,
          key: `error-${baseKey}`,
          timestamp: ts,
        } satisfies ErrorNoticeDisplayItem,
        groupKey: "",
      };

    case "custom":
      return {
        item: {
          type: "custom",
          content: msg.content,
          key: `custom-${baseKey}`,
          timestamp: ts,
        } satisfies CustomSystemDisplayItem,
        groupKey: "",
      };

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

      return {
        item: {
          type: "chat",
          role: msg.role,
          content: msg.content,
          key,
          timestamp: ts,
          agentId: msg.agentId,
          resolvedToolCalls: resolveToolCalls(msg),
          attachments: resolveAttachments(msg, _config),
          renderContext,
          thinking,
          isConsecutive,
          groupKey: gk,
          originalRole: msg.originalRole,
          stopReason: msg.stopReason,
        } satisfies ChatDisplayItem,
        groupKey: gk,
      };
    }
  }
}

/**
 * Annotate classified messages into PipelineItem[].
 * Computes isConsecutive so that <Message /> can hide the header for
 * consecutive messages from the same source.
 *
 * Consecutive detection resets when the role changes (e.g. user → agent),
 * ensuring the first agent message after a user message always shows its
 * header even if the groupKey happens to match a stale previous value.
 */
export function annotateMessages(
  messages: ClassifiedMessage[],
  config: AnnotateConfig,
  initialGroupKey: string = "",
  previousItemHadToolCalls = false
): PipelineItem[] {
  const items: PipelineItem[] = [];
  let prevGroupKey = initialGroupKey;
  let prevRole = "";
  let isFirst = true;
  // Track seen keys to resolve collisions defensively.
  // If two messages produce the same key (e.g. duplicate tool messages
  // with the same id after merge promotion), append a counter so React
  // children always have unique keys.
  const seenKeys = new Map<string, number>();

  for (const msg of messages) {
    // Use msg.role (not originalRole) for consecutive detection.
    // Promoted tool messages have role="agent" (same as real agent messages),
    // so a real agent following a promoted tool is correctly detected as
    // consecutive (same groupKey "agent:xxx").
    // originalRole is preserved on the PipelineItem for downstream use
    // (e.g. groupByUserBoundary uses it to exclude promoted tools from
    // final response selection).
    if (!(isFirst && initialGroupKey !== "") && msg.role !== prevRole) {
      prevGroupKey = "";
    }

    // After tool execution completes, the next agent message is a new
    // logical step — it must show its header.  We detect this boundary
    // when the immediately preceding item carries resolvedToolCalls
    // (merged from tool messages) and the current message is an agent.
    const isToolCallBoundary =
      msg.role === "agent" &&
      (previousItemHadToolCalls ||
        (items.length > 0 &&
          items[items.length - 1].type === "chat" &&
          (items[items.length - 1] as ChatDisplayItem).resolvedToolCalls &&
          (items[items.length - 1] as ChatDisplayItem).resolvedToolCalls!
            .length > 0));
    if (isToolCallBoundary) {
      prevGroupKey = "";
    }

    isFirst = false;
    let { item, groupKey } = toPipelineItem(msg, config, prevGroupKey);
    if (item) {
      // Resolve key collisions by appending a counter.
      const baseKey = item.key;
      const count = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, count + 1);
      if (count > 0) {
        item = { ...item, key: `${baseKey}-${count}` };
      }
      items.push(item);
    }
    // Non-info messages (compression, mode_change, etc.) reset the group
    // so the next info message always shows its header.
    prevGroupKey = groupKey;
    prevRole = msg.role;
  }

  return items;
}
