import type {
  ChatMessage,
  ContextAttachment,
  SessionCompressionInfo,
  ToolCall,
} from "../types";

// Re-export types needed by stage modules
export type { ContextAttachment, ToolCall, SessionCompressionInfo };

/** Raw message — alias for ChatMessage from the store */
export type RawMessage = ChatMessage;

/**
 * stopReason from ACP session/prompt response.
 * Used to determine the final response boundary in the pipeline.
 */
export type StopReason = string;

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
  /** ACP stopReason from session/prompt response — signals end of turn */
  stopReason?: string;
}

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
  /** Candidate paths extracted from inline code during annotation */
  filePaths: Set<string>;
}

/** File edit summary entry — one file written via ACP fs/write_text_file in the turn */
export interface FileEditEntry {
  /** Absolute or workspace-relative file path */
  path: string;
  /** Number of added lines (LCS-based diff from original → latest written) */
  lineCount: number;
  /** Number of deleted lines (LCS-based diff from original → latest written) */
  deletedLines: number;
  /** Tool kind — always "fs/write_text_file" for ACP filesystem writes */
  kind: string;
  /** Original content before this write (for revert/diff) — oldest across all steps for this path */
  originalContent: string | null;
  /** Latest written content across all steps for this path (for inline diff preview) */
  writtenContent: string | null;
}

export interface ChatDisplayItem {
  type: "chat";
  /** Agent identifier — used for per-agent grouping */
  agentId?: string;
  /** Session identifier — used to scope file write lookups per session */
  sessionId?: string;
  /**
   * ACP SDK messageId — identifies the logical message this item belongs to.
   * Used by splitIntoSteps to detect whether a new agent message belongs to
   * the same step (same messageId) or starts a new step (different messageId).
   */
  messageId?: string;
  /** Resolved tool calls (populated by annotate from raw msg.toolCalls) */
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
  /** ACP stopReason from session/prompt — marks this message as the final response of a turn */
  stopReason?: string;
  /** Thinking content if present */
  thinking: { content: string; isStreaming: boolean } | undefined;
  /** True when this message is the first item of a turn — header should be shown */
  isFirstOfTurn: boolean;
  /** Extracted path candidates for inline code linking */
  renderContext?: RenderContext;
  /**
   * File-write sequence counter at the time this message was created/finalized.
   * Used by grouping.ts to partition file writes per step.
   */
  writeSeq?: number;
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
 * A single intermediate step within an agent response group.
 *
 * Each step consists of an optional agent message followed by tool calls.
 * - Pre-agent tool calls (no agent message yet) → agentMessage is null
 * - Agent step → agentMessage is the chat message, toolCalls are subsequent tool items
 *
 * Rendering: when a step has both agentMessage and toolCalls, the agent
 * message header is shown and tool calls are rendered as a single batch.
 */
export interface IntermediateStep {
  /** The agent message for this step (null for pre-agent tool calls) */
  agentMessage: ChatDisplayItem | null;
  /** Tool calls in this step (ChatDisplayItem with role="tool") */
  toolCalls: ChatDisplayItem[];
  /** Pre-agent tool calls have no agent message yet */
  readonly isPreAgent: boolean;
  /** File edit summary — writes attributed to this step via writeSeq partitioning */
  fileEditSummary?: FileEditEntry[];
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

export interface AnnotateConfig {
  resolveAttachments: boolean;
  /** Extract path candidates from inline code for speculative linking */
  detectInlinePaths: boolean;
}

export interface PipelineConfig {
  filter: FilterConfig;
  annotate: AnnotateConfig;
}
