import type { SessionStatus } from "./session";

// ============================================================================
// Agent Definition — static configuration for an agent
// ============================================================================

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  model?: string;
  handoffs?: string[];
}

// ============================================================================
// Agent Info — runtime metadata from InitializeResponse
// ============================================================================

export interface AgentInfo {
  name: string;
  title?: string;
  version?: string;
  protocolVersion: number;
  capabilities?: AgentCapabilities;
}

export interface AgentCapabilities {
  loadSession: boolean;
  promptCapabilities?: {
    image: boolean;
    audio: boolean;
    embeddedContext: boolean;
  };
  sessionCapabilities?: {
    fork: boolean;
    list: boolean;
    resume: boolean;
    delete: boolean;
    close: boolean;
    additionalDirectories: boolean;
  };
}

// ============================================================================
// Agent Connection State
// ============================================================================

export type AgentConnectionState =
  | "connecting"
  | "connected"
  | "idle"
  | "busy"
  | "error"
  | "disconnected";

// ============================================================================
// Token Usage
// ============================================================================

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

// ============================================================================
// Session Status Info
// ============================================================================

export interface SessionStatusInfo {
  sessionId: string;
  title: string;
  status: SessionStatus;
  isActive: boolean;
  messageCount: number;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  cwd?: string;
  model?: string;
  mode?: string;
}

// ============================================================================
// Agent Status — aggregated runtime status
// ============================================================================

export interface AgentStatus {
  agentId: string;
  state: AgentConnectionState;
  sessions: SessionStatusInfo[];
  activeSessionId?: string;
  totalTokenUsage: TokenUsage;
  lastError?: string;
  lastActivity: Date;
}
