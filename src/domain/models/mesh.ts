// ============================================================================
// P2P Mesh — data models for multi-agent orchestration
//
// refs: docs/p2p-mesh-design.md Section 8
// ============================================================================

// ----------------------------------------------------------------------------
// Message types
// ----------------------------------------------------------------------------

export type P2PMessageType =
  | "task_request"
  | "task_response"
  | "task_delegate"
  | "status_update"
  | "file_lock_request"
  | "file_lock_release"
  | "review_request"
  | "review_response"
  | "question"
  | "answer"
  | "broadcast"
  | "ping"
  | "pong";

// ----------------------------------------------------------------------------
// Message payloads
// ----------------------------------------------------------------------------

export interface TaskRequestPayload {
  taskId: string;
  title: string;
  description: string;
  contextFiles?: string[];
  constraints?: string[];
  deadline?: string;
  priority?: "low" | "normal" | "high";
}

export interface TaskResponsePayload {
  taskId: string;
  status: "completed" | "failed" | "partial";
  output: string;
  modifiedFiles: string[];
  tokenUsage: P2PTokenUsage;
  error?: string;
}

export interface StatusUpdatePayload {
  agentId: string;
  status: "idle" | "working" | "waiting" | "error";
  currentTask?: string;
  progress?: number;
  event?: string;
  [key: string]: unknown;
}

export interface FileLockPayload {
  filePath: string;
  action: "acquire" | "release";
  lockType: "read" | "write";
}

export interface ReviewPayload {
  taskId: string;
  files: string[];
  focus: string[];
  criteria: string;
  result?: {
    passed: boolean;
    issues: ReviewIssue[];
  };
}

export interface ReviewIssue {
  severity: "error" | "warning" | "info";
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface QuestionPayload {
  question: string;
  context?: string;
  options?: string[];
}

export interface BroadcastPayload {
  event: string;
  data: Record<string, unknown>;
}

export type MessagePayload =
  | TaskRequestPayload
  | TaskResponsePayload
  | StatusUpdatePayload
  | FileLockPayload
  | ReviewPayload
  | QuestionPayload
  | BroadcastPayload
  | Record<string, unknown>;

// ----------------------------------------------------------------------------
// P2P Message
// ----------------------------------------------------------------------------

export interface P2PMessage {
  id: string;
  type: P2PMessageType;
  from: string;
  to: string; // agentId or "broadcast"
  timestamp: Date;
  payload: MessagePayload;
  metadata?: P2PMessageMetadata;
}

export interface P2PMessageMetadata {
  replyTo?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  ttl?: number; // seconds
}

// ----------------------------------------------------------------------------
// Mesh Team
// ----------------------------------------------------------------------------

export interface MeshTeam {
  id: string;
  name: string;
  description: string;
  leadAgentId: string;
  memberAgentIds: string[];
  taskBoardPath: string;
  createdAt: Date;
  status: "active" | "paused" | "completed";
}

// ----------------------------------------------------------------------------
// TaskBoard entries
// ----------------------------------------------------------------------------

export type MeshTaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "review"
  | "completed"
  | "failed";

export interface TaskEntry {
  id: string;
  title: string;
  description: string;
  status: MeshTaskStatus;
  assignedTo?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  dependsOn: string[];
  subtasks: string[];
  result?: {
    output: string;
    modifiedFiles: string[];
    tokenUsage: P2PTokenUsage;
  };
  metadata?: Record<string, unknown>;
}

export interface FileLockEntry {
  filePath: string;
  lockedBy: string;
  lockedAt: Date;
  lockType: "read" | "write";
  expiresAt?: Date;
}

export interface MessageLogEntry {
  messageId: string;
  type: P2PMessageType;
  from: string;
  to: string;
  timestamp: Date;
  summary: string;
}

export interface TaskBoard {
  version: "1.0";
  teamId: string;
  createdAt: Date;
  updatedAt: Date;
  tasks: TaskEntry[];
  fileLocks: FileLockEntry[];
  messageLog: MessageLogEntry[];
}

// ----------------------------------------------------------------------------
// Token usage (mesh-specific, mirrors chat.TokenUsage)
// ----------------------------------------------------------------------------

export interface P2PTokenUsage {
  input: number;
  output: number;
  total: number;
}

// ----------------------------------------------------------------------------
// Error types
// ----------------------------------------------------------------------------

export type MeshErrorType =
  | "agent_disconnected"
  | "message_timeout"
  | "file_lock_conflict"
  | "task_deadlock"
  | "invalid_message";

export interface MeshError {
  type: MeshErrorType;
  description: string;
  agentId?: string;
  messageId?: string;
  timestamp: Date;
}

// ----------------------------------------------------------------------------
// Marker protocol
// ----------------------------------------------------------------------------

/** Delimiter for embedding P2P messages in agent output streams */
export const MESH_MARKER_OPEN = "[ACP_MESH_MESSAGE]";
export const MESH_MARKER_CLOSE = "[/ACP_MESH_MESSAGE]";

export interface MarkerEnvelope {
  version: "1.0";
  type: P2PMessageType;
  id: string;
  to: string;
  payload: MessagePayload;
  metadata?: P2PMessageMetadata;
}
