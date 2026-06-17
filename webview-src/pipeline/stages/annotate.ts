import type {
  AnnotateConfig,
  ChatDisplayItem,
  ClassifiedMessage,
  CompressionDisplayItem,
  CustomSystemDisplayItem,
  ErrorNoticeDisplayItem,
  ModeChangeDisplayItem,
  PipelineItem,
  ResolvedAttachment,
  ResolvedToolCall,
  SessionCompressionInfo,
} from "../types";
import type { ContextAttachment } from "../../types";

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
 * Build the group key used to detect consecutive messages from the same source.
 * Messages sharing the same groupKey as their predecessor are marked consecutive
 * (header hidden).
 */
function groupKeyOf(msg: ClassifiedMessage): string {
  if (msg.systemKind !== "info") return "";
  switch (msg.role) {
    case "agent":
      return `agent:${msg.agentId ?? "unknown"}`;
    case "tool":
      return `agent:${msg.agentId ?? "unknown"}`;
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

          thinking,
          isConsecutive,
          groupKey: gk,
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
 */
export function annotateMessages(
  messages: ClassifiedMessage[],
  config: AnnotateConfig,
  initialGroupKey: string = ""
): PipelineItem[] {
  const items: PipelineItem[] = [];
  let prevGroupKey = initialGroupKey;

  for (const msg of messages) {
    const { item, groupKey } = toPipelineItem(msg, config, prevGroupKey);
    if (item) items.push(item);
    // Non-info messages (compression, mode_change, etc.) reset the group
    // so the next info message always shows its header.
    prevGroupKey = groupKey;
  }

  return items;
}
