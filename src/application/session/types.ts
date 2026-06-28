import type { ChatMessage, TokenUsage } from "../../domain/models/chat";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  SessionInfo,
  SessionStatus,
  TurnOutcome,
} from "../../domain/models/session";
import type { StopReason } from "@agentclientprotocol/sdk";

export type { SessionInfo, SessionStatus, TurnOutcome, TokenUsage };

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

/**
 * domain/SessionInfo is the canonical pure state type (no messages, no
 * application-only bookkeeping).  This interface adds fields that only the
 * application layer needs (message history, compression tracking).
 */
export interface AppSessionInfo extends SessionInfo {
  /** Previous context usage (tokens) — used for compression detection */
  _prevContextUsed?: number;
  /** Messages in the session — used for fork/replay operations */
  messages: ChatMessage[];
}

export interface AutoConnectEntry {
  workspace?: string;
  sessionName?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  autoConnect?: AutoConnectEntry[];
  openChat?: boolean;
  icon?: string;
  color?: string;
  maxConcurrentSessions?: number;
  meshRole?: import("../../domain/services/prompt-builder").MeshAgentRole;
  meshProtocol?: {
    enabled: boolean;
    version: "1" | "2";
    teamId?: string;
    teamName?: string;
  };
}

export interface AgentInfo {
  name: string;
  title?: string;
  version?: string;
  protocolVersion: number;
  capabilities?: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
    sessionCapabilities?: {
      fork?: boolean;
      list?: boolean;
      resume?: boolean;
      delete?: boolean;
      close?: boolean;
      additionalDirectories?: boolean;
    };
  };
}

export type AgentConnectionState =
  | "connecting"
  | "connected"
  | "idle"
  | "busy"
  | "error"
  | "disconnected";

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

export interface AgentStatus {
  agentId: string;
  state: AgentConnectionState;
  sessions: SessionStatusInfo[];
  activeSessionId?: string;
  totalTokenUsage: TokenUsage;
  lastError?: string;
  lastActivity: Date;
}

export interface RestoreResult {
  sessionId: string;
  nativeRestore: boolean;
  replayedMessageCount: number;
}

export interface SessionCompletedEvent {
  agentId: string;
  sessionId: string;
  title: string;
  stopReason: StopReason;
}

export type PromptContext = ContentBlock[];
