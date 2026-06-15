import type {
  ChatMessage,
  ContextAttachment,
  SessionCompressionInfo,
  ToolCall,
} from "../types";

// Re-export types needed by stage modules
export type { ContextAttachment, ToolCall, SessionCompressionInfo };

// ── Raw / classified / filtered (internal pipeline stages) ─────────────────

/** Raw message — alias for ChatMessage from the store */
export type RawMessage = ChatMessage;

/** System message classification */
export type SystemKind =
  | "compression"
  | "mode_change"
  | "error_notice"
  | "custom"
  | "info";

/** Classified message — systemKind assigned */
export interface ClassifiedMessage extends RawMessage {
  systemKind: SystemKind;
}

// ── Resolved tool call / attachment (display helpers) ──────────────────────

export interface ResolvedToolCall {
  id: string;
  title: string;
  kind: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  input: Record<string, unknown> | string | undefined;
  output: string | undefined;
  durationMs: number | undefined;
  locations: { path: string; line?: number }[] | undefined;
  diffContent:
    | { type: "diff"; diff: string; oldPath?: string; newPath?: string }
    | undefined;
}

export interface ResolvedAttachment {
  id: string;
  type: "file" | "selection" | "symbol" | "diff";
  path: string;
  label: string;
  lineRange: [number, number] | undefined;
  tokenCount: number;
  isNavigable: boolean;
  extension: string;
  detail: string;
}

export interface RenderContext {
  filePaths?: Set<string>;
}

// ── PipelineItem — final pipeline output (union) ────────────────────────────

/** Standard chat message rendered by <Message /> */
export interface ChatDisplayItem {
  type: "chat";
  /** Resolved tool calls carried over from merge stage */
  resolvedToolCalls?: ResolvedToolCall[];
  /** Resolved context attachments */
  attachments: ResolvedAttachment[];
  /** Message content (may be partial in incremental mode) */
  content: string;
  /** Stable key for React reconciliation */
  key: string;
  /** Original timestamp */
  timestamp: number | undefined;
  /** Role for styling */
  role: "user" | "agent" | "system" | "tool";
  renderContext: RenderContext | undefined;
  /** Thinking content if present */
  thinking: { content: string; isStreaming: boolean } | undefined;
}

/** Session compression notice rendered by <ContextCompressionNotice /> */
export interface CompressionDisplayItem {
  type: "compression";
  info: SessionCompressionInfo;
  key: string;
  timestamp: number | undefined;
}

/** Mode change notice rendered by <ModeChangeNotice /> */
export interface ModeChangeDisplayItem {
  type: "mode_change";
  content: string;
  key: string;
  timestamp: number | undefined;
}

/** Error notice rendered by <ErrorMessage /> */
export interface ErrorNoticeDisplayItem {
  type: "error_notice";
  content: string;
  key: string;
  timestamp: number | undefined;
}

/** Custom system message rendered by <CustomSystemMessage /> */
export interface CustomSystemDisplayItem {
  type: "custom";
  content: string;
  key: string;
  timestamp: number | undefined;
}

/**
 * Union of all items the pipeline can emit.
 * ChatContainer iterates this array and selects the right component per item.
 */
export type PipelineItem =
  | ChatDisplayItem
  | CompressionDisplayItem
  | ModeChangeDisplayItem
  | ErrorNoticeDisplayItem
  | CustomSystemDisplayItem;

// ── Pipeline context & config ──────────────────────────────────────────────

export interface PipelineContext {
  sessionId: string;
  agentId: string;
  sessionCwd: string | undefined;
  /** Already-processed items (for incremental mode) */
  existingItems: PipelineItem[];
}

export interface FilterConfig {
  hideCompression: boolean;
  hideModeChange: boolean;
  hideErrorNotices: boolean;
  customPredicate?: (msg: ClassifiedMessage) => boolean;
}

export interface MergeConfig {
  enabled: boolean;
  maxGap: number;
}

export interface AnnotateConfig {
  detectInlinePaths: boolean;
  resolveAttachments: boolean;
}

export interface PipelineConfig {
  filter: FilterConfig;
  merge: MergeConfig;
  annotate: AnnotateConfig;
}
