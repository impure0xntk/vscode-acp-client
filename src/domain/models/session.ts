// ============================================================================
// Session — runtime state for a single agent session
// ============================================================================

export type SessionStatus =
  | "idle"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "error"
  | "cancelled";

export interface SessionContext {
  variables: Record<string, unknown>;
  parentSessionId?: string;
  childSessionIds: string[];
  metadata: Record<string, unknown>;
}

export interface Session {
  id: string;
  agentId: string;
  status: SessionStatus;
  context: SessionContext;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Session Info — extended runtime state (includes messages, token usage)
// ============================================================================

import type { ChatMessage, TokenUsage } from "./chat";

// Re-export for convenience
export type { ChatMessage, TokenUsage };

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
  /** True while streaming content is in progress (between stream start and stream end) */
  isStreaming: boolean;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  createdAt: Date;
  updatedAt: Date;
  pendingCancel: boolean;
}
