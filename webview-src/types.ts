import React from "react";

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
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
export type TriggerType = "/" | "#";

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
  kind: "file" | "selection" | "diff" | "command" | "symbol";
  label: string;
  /** Relative path for files, command id for commands, symbol name for symbols */
  value: string;
  /** Optional detail line (e.g. file path tail, symbol type, command description) */
  detail?: string;
  /** Icon hint for the renderer */
  icon?: string;
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

// ── Running tool overlay ─────────────────────────────────────────────

export interface ToolCallInfo {
  id: string;
  title: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  kind: string;
  durationMs?: number;
  /** File path being operated on (for read/edit/search tools) */
  filePath?: string;
  /** Short summary of the operation (e.g. command name, search query) */
  summary?: string;
  /** Elapsed time in ms — updated live for in_progress tools */
  elapsedMs?: number;
}
