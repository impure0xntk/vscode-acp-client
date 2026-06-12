// ============================================================================
// Shared chat types (extension-host side & webview)
// ============================================================================

// ============================================================================
// Token Usage (flat format used throughout the extension host)
// ============================================================================

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

// ============================================================================
// Tool Call — in-memory shape (not stored directly)
// ============================================================================

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export interface ToolCallDiffContent {
  oldText?: string;
  newText: string;
  path: string;
}

export interface ToolCall {
  id: string;
  title: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  kind: string;
  input?: string;
  output?: string;
  locations?: ToolCallLocation[];
  diffContent?: ToolCallDiffContent;
  durationMs?: number;
}

// ============================================================================
// Context Attachment — in-memory shape
// ============================================================================

export interface ContextAttachmentDTO {
  id: string;
  type: "file" | "selection" | "symbol" | "diff";
  path: string;
  label: string;
  lineRange?: [number, number];
  tokenCount: number;
  content: string;
}

// ============================================================================
// Chat Message
//
// In-memory:  toolCalls / attachments hold parsed arrays.
// Persistent: toolCallsJson / attachmentsJson hold JSON strings for SQLite.
//              On save the arrays are serialised; on load the JSON strings
//              are present and callers parse them when needed.
// ============================================================================

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system" | "tool";
  content: string;
  timestamp: number;

  /* ── In-memory (runtime) ─────────────────────────────────────────── */
  toolCalls?: ToolCall[];
  attachments?: ContextAttachmentDTO[];

  /* ── Serialized (SQLite round-trip) ──────────────────────────────── */
  toolCallsJson?: string;
  attachmentsJson?: string;

  /* ── Misc ────────────────────────────────────────────────────────── */
  inlineFilePaths?: string[];
  sessionCwd?: string;
  agentId?: string;
  sessionId?: string;
}
