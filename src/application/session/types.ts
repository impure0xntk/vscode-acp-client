import type { ChatMessage, TokenUsage } from "../../domain/models/chat";

export type { ChatMessage, TokenUsage };

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
  pendingCancel: boolean;
}
