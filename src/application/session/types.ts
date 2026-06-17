import type { ChatMessage, TokenUsage } from "../../domain/models/chat";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  SessionInfo,
  SessionStatus,
  TurnOutcome,
} from "../../domain/models/session";

// Re-export domain types so downstream consumers import from one place
export type { SessionInfo, SessionStatus, TurnOutcome, TokenUsage };

// ============================================================================
// Queued Prompt — message buffered while a turn is active
// ============================================================================

export type QueuedPromptStatus = "pending" | "sending" | "sent" | "cancelled";

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
// App Session Info — application-layer extension of domain SessionInfo
//
// domain/SessionInfo is the canonical pure state type (no messages, no
// application-only bookkeeping).  This interface adds fields that only the
// application layer needs (message history, compression tracking).
// ============================================================================

export interface AppSessionInfo extends SessionInfo {
  /** Previous context usage (tokens) — used for compression detection */
  _prevContextUsed?: number;
  /** Messages in the session — used for fork/replay operations */
  messages: ChatMessage[];
}
