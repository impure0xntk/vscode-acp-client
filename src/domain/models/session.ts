// ============================================================================
// Session — runtime state for a single agent session
// ============================================================================

export type SessionStatus = "idle" | "running" | "completed" | "error" | "cancelled";

export type TurnOutcome = "completed" | "error" | "cancelled";

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
  lastTurnOutcome: TurnOutcome | null;
  context: SessionContext;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Session Info — extended runtime state (includes messages, token usage)
// ============================================================================

import type { TokenUsage } from "./chat";

// Re-export for convenience
export type { TokenUsage };

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  title: string;
  cwd: string;
  mode?: string;
  model?: string;
  status: SessionStatus;
  lastTurnOutcome: TurnOutcome | null;
  /** True while streaming content is in progress (between stream start and stream end) */
  isStreaming: boolean;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  createdAt: Date;
  updatedAt: Date;
  pendingCancel: boolean;
}
