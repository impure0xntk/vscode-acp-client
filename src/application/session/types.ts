import type { ChatMessage, TokenUsage } from "../../domain/models/chat";
import type { ContentBlock } from "@agentclientprotocol/sdk";

export type { ChatMessage, TokenUsage };

// ============================================================================
// Queued Prompt — message buffered while a turn is active
// ============================================================================

export type QueuedPromptStatus =
  | "pending"
  | "sending"
  | "sent"
  | "cancelled";

export interface QueuedPrompt {
  id: string;
  agentId: string;
  sessionId: string;
  text: string;
  context?: ContentBlock[];
  /** ISO timestamp when the prompt was enqueued */
  enqueuedAt: string;
  status: QueuedPromptStatus;
}

// ============================================================================
// Session Status
// ============================================================================

export type SessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

// ============================================================================
// Session Info — single source of truth for runtime session state
// ============================================================================

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  title: string;
  cwd: string;
  mode?: string;
  model?: string;
  status: SessionStatus;
  messages: ChatMessage[];
  isTurnActive: boolean;
  /** True while streaming content is in progress */
  isStreaming: boolean;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  createdAt: Date;
  updatedAt: Date;
  /** ISO string of last agent response; null if no response yet. Used for elapsed time anchoring in the webview. */
  lastResponseAt: string | null;
  pendingCancel: boolean;
  /** Previous context usage (tokens) — used for compression detection */
  _prevContextUsed?: number;
}
