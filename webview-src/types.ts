import React from "react";

// ── Session Overview ─────────────────────────────────────────────────────────

export interface SessionProgress {
  elapsedMs: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  contextWindow?: {
    used: number;
    max: number;
    percentage: number;
  };
  messageCount: number;
  toolCallCount: number;
  toolCallsCompleted: number;
}

export interface ResponsePreview {
  messageId: string;
  role: "agent" | "tool";
  preview: string;
  toolName?: string;
  status?: "completed" | "running" | "failed";
  timestamp: string;
}

export interface SessionOverviewItem {
  sessionId: string;
  agentId: string;
  title: string;
  status: string;
  model?: string;
  mode?: string;
  progress: SessionProgress;
  recentResponses: ResponsePreview[];
  cwd?: string;
  createdAt: string;
  /** ISO date string — last time agent produced output. Null if never. */
  lastResponseAt: string | null;
}

/** Filter modes — "none" means no filter active (show all) */
export type SessionOverviewFilter = "all" | "running" | "completed" | "error" | "cancelled";
export type SessionOverviewActiveFilter = SessionOverviewFilter; // alias for clarity

/** Status values that can be used for filtering */
export const FILTERABLE_STATUSES = ["running", "completed", "error", "cancelled"] as const;
export type FilterableStatus = (typeof FILTERABLE_STATUSES)[number];

export interface SessionOverviewState {
  filter: SessionOverviewFilter;
  expandedSessions: string[];
  /** Selected session IDs for batch operations */
  selectedSessionIds: string[];
  /** Whether selection mode is active (long-press to select) */
  selectionMode: boolean;
}

export interface MessageContent {
  type: "text";
  text: string;
}

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export interface ToolCallDiffContent {
  type: "diff";
  diff: string;
  oldPath?: string;
  newPath?: string;
}

export interface ToolCall {
  id: string;
  title: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  kind: string;
  content?: MessageContent[];
  input?: Record<string, unknown> | string;
  output?: string;
  durationMs?: number;
  locations?: ToolCallLocation[];
  diffContent?: ToolCallDiffContent;
}

export interface ThinkingContent {
  type: "thinking";
  content: string;
  isStreaming?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: ThinkingContent;
  /** Agent identifier — used to detect consecutive messages from the same agent */
  agentId?: string;
  /** Session identifier — used to scope consecutive-agent detection per session */
  sessionId?: string;
  /** Session cwd — used to resolve relative file paths in inline code references */
  sessionCwd?: string;
  /** File paths confirmed to exist — inline code matching these becomes clickable links */
  inlineFilePaths?: string[];
  /** Context attachments (files, selections, symbols, diffs) */
  attachments?: ContextAttachment[];
  /** Context compression info — present when role="system" and compression was detected */
  compressionInfo?: SessionCompressionInfo;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ContextAttachment {
  id: string;
  type: "file" | "selection" | "symbol" | "diff";
  path: string;
  label: string;
  lineRange?: [number, number];
  tokenCount: number;
  content: string;
}

// ── Triggered autocomplete ──────────────────────────────────────────

/**
 * Trigger characters that open the suggestion panel.
 * # is the primary trigger; queries are disambiguated by prefix:
 *   #file.py or just # → file search
 *   #symbol → symbol search
 */
export type TriggerType = "/" | "#" | "@";

/** A file candidate returned by the extension host */
export interface FileCandidate {
  relativePath: string;
  name: string;
  absolutePath?: string;
}

/**
 * Unified suggestion item for the autocomplete panel.
 * Query format per trigger:
 *   /   → "command"
 *   #   → "file" | "selection" | "diff" (when query is empty or starts with non-"symbol" prefix)
 *   #symbol → "symbol"
 */
export interface SuggestionItem {
  id: string;
  kind: "file" | "selection" | "diff" | "command" | "symbol" | "action" | "session";
  label: string;
  /** Relative path for files, command id for commands, symbol name for symbols, action id for actions, "agentId:sessionId" for sessions */
  value: string;
  /** Optional detail line (e.g. file path tail, symbol type, command description, agentId for sessions) */
  detail?: string;
  /** Icon hint for the renderer */
  icon?: string;
  /** Agent identifier — populated for session suggestions */
  agentId?: string;
  /** Session identifier — populated for session suggestions */
  sessionId?: string;
  /** Session status — populated for session suggestions (mirrors SessionInfoSnapshot.status) */
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
}

export interface SessionCompressionInfo {
  contextWindowMax: number;
  usedTokens: number;
  usedBefore?: number;
}

export interface StreamChunk {
  type: "streamChunk";
  chunk: string;
}

export interface FullState {
  type: "fullState";
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
  isTurnActive: boolean;
}

// ── Mesh Orchestrator types ──────────────────────────────────────────

export type MeshMessageType =
  | "task_request"
  | "task_response"
  | "task_delegate"
  | "status_update"
  | "file_lock_request"
  | "file_lock_release"
  | "review_request"
  | "review_response"
  | "question"
  | "answer"
  | "broadcast"
  | "ping"
  | "pong";

export type CommunicationMode =
  | "direct"
  | "fanout"
  | "supervisor"
  | "pipeline"
  | "p2P";

export interface SendTarget {
  agentId: string;
  sessionId: string;
  label: string;
  status?: "idle" | "running" | "completed" | "error";
}

export interface MeshAgentStatus {
  agentId: string;
  state: "idle" | "working" | "waiting" | "error" | "disconnected";
  sessions: Array<{
    sessionId: string;
    title: string;
    status: string;
  }>;
  currentTask?: string;
  progress?: number;
  role?: "lead" | "worker" | "reviewer";
}

export interface MeshTaskEntry {
  id: string;
  title: string;
  description: string;
  status: "pending" | "assigned" | "in_progress" | "review" | "completed" | "failed";
  assignedTo?: string;
  progress?: number;
}

export interface MeshRecentMessage {
  messageId: string;
  type: string;
  from: string;
  to: string;
  timestamp: string;
  summary: string;
}
