import type { SessionStatus, TurnOutcome } from "./session";

// ============================================================================
// Preset — startup configuration for unified chat auto-launch
// ============================================================================

/** A single session entry within a preset */
export interface PresetSessionEntry {
  /** Agent id (must match a key in acp.agents) */
  agent: string;
  /** Workspace folder path (absolute or relative to workspace root) */
  workspace?: string;
  /** Human-readable title for the session tab */
  sessionName?: string;
  /** Agent mode to set after connection */
  mode?: string;
  /** Whether the auto-created session should be pinned. Defaults to true. */
  pinned?: boolean;
}

/** A named preset configuration */
export interface PresetConfig {
  label: string;
  /** Layout mode for the unified chat panel */
  layout?: "single" | "split" | "grid";
  /** Split ratio for split layout (0.0 = top 100%, 1.0 = bottom 100%) */
  splitRatio?: number;
  /** Sessions to create on startup */
  sessions: PresetSessionEntry[];
}

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
  lastTurnOutcome: TurnOutcome | null;
  isActive: boolean;
  messageCount: number;
  tokenUsage: TokenUsage;
  contextWindowMax?: number;
  cwd?: string;
  model?: string;
  mode?: string;
  pinned: boolean;
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
