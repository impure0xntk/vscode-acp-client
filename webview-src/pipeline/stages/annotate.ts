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

function resolveToolCalls(msg: ClassifiedMessage): ResolvedToolCall[] | undefined {
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
        diffContent?: { type: "diff"; diff: string; oldPath?: string; newPath?: string };
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
  _config: AnnotateConfig,
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

function buildRenderContext(
  _msg: ClassifiedMessage,
  _config: AnnotateConfig,
): { filePaths: Set<string> } | undefined {
  // TODO: extract inline file paths from content when detectInlinePaths is true
  return undefined;
}

// ── ClassifiedMessage → PipelineItem ────────────────────────────────────────

/**
 * Map a classified message to the appropriate PipelineItem variant.
 * Each variant is rendered by a dedicated UI component in ChatContainer.
 */
function toPipelineItem(msg: ClassifiedMessage, config: AnnotateConfig): PipelineItem | null {
  const baseKey = `${msg.role}-${msg.id ?? msg.timestamp ?? "unknown"}`;
  const ts = msg.timestamp;

  switch (msg.systemKind) {
    case "compression": {
      const info = msg.compressionInfo as SessionCompressionInfo | undefined;
      if (!info) return null;
      return {
        type: "compression",
        info,
        key: `compression-${baseKey}`,
        timestamp: ts,
      } satisfies CompressionDisplayItem;
    }

    case "mode_change":
      return {
        type: "mode_change",
        content: msg.content,
        key: `mode-${baseKey}`,
        timestamp: ts,
      } satisfies ModeChangeDisplayItem;

    case "error_notice":
      return {
        type: "error_notice",
        content: msg.content,
        key: `error-${baseKey}`,
        timestamp: ts,
      } satisfies ErrorNoticeDisplayItem;

    case "custom":
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
          ? { content: msg.thinking.content, isStreaming: msg.thinking.isStreaming ?? false }
          : undefined;

      return {
        type: "chat",
        role: msg.role,
        content: msg.content,
        key: `chat-${baseKey}`,
        timestamp: ts,
        resolvedToolCalls: resolveToolCalls(msg),
        attachments: resolveAttachments(msg, config),
        renderContext: buildRenderContext(msg, config),
        thinking,
      } satisfies ChatDisplayItem;
    }
  }
}

/**
 * Annotate classified messages into PipelineItem[].
 */
export function annotateMessages(
  messages: ClassifiedMessage[],
  config: AnnotateConfig,
): PipelineItem[] {
  const items: PipelineItem[] = [];
  for (const msg of messages) {
    const item = toPipelineItem(msg, config);
    if (item) items.push(item);
  }
  return items;
}
