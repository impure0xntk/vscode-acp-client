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
  | "pong"
  | "plan_update"
  | "plan_proposal"
  | "task_plan";

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

/** Identifies a specific agent session within a team */
export interface MeshSessionRef {
  agentId: string;
  sessionId: string;
}

export interface MeshTeam {
  id: string;
  name: string;
  description: string;
  lead: MeshSessionRef;
  members: MeshSessionRef[];
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

// ============================================================================
// Mesh Orchestrator Communication Model (v2)
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4
// ============================================================================

// ----------------------------------------------------------------------------
// Communication modes
// ----------------------------------------------------------------------------

export type CommunicationMode =
  | "direct" // 1:1 direct message (extension of existing @send)
  | "fanout" // 1:N broadcast (same task to multiple agents)
  | "supervisor" // 1->N->1 lead-worker pattern
  | "pipeline" // sequential chain (A->B->C)
  | "p2P"; // agent-initiated P2P (marker-based, no human)

// ----------------------------------------------------------------------------
// Message source identification
// ----------------------------------------------------------------------------

export type MessageSource =
  | { type: "user"; agentId: string; sessionId: string } // Webview-originated
  | { type: "agent"; agentId: string } // agent output marker
  | { type: "orchestrator" }; // system-generated

// ----------------------------------------------------------------------------
// User message payload (Webview-originated messages)
// ----------------------------------------------------------------------------

export interface UserMessagePayload {
  text: string;
  contextFiles?: string[];
  attachments?: unknown[]; // ContextAttachmentDTO[] from chat.ts (avoid circular dep)
  priority?: "low" | "normal" | "high" | "urgent";
  requireResponse?: boolean;
  timeout?: number; // seconds
}

// ----------------------------------------------------------------------------
// Extended payload union
// ----------------------------------------------------------------------------

export type MeshPayload = MessagePayload | UserMessagePayload;

// ----------------------------------------------------------------------------
// Unified mesh message (superset of P2PMessage)
// ----------------------------------------------------------------------------

export interface MeshMessage {
  id: string;
  type: P2PMessageType;
  from: string; // agentId or "user"
  to: string; // agentId or "broadcast" or agentId[]
  timestamp: Date;
  mode: CommunicationMode;
  payload: MeshPayload;
  metadata?: MeshMessageMetadata;
}

export interface MeshMessageMetadata {
  replyTo?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  ttl?: number;
  source?: MessageSource;
}

// ----------------------------------------------------------------------------
// Send target (Composer multi-@)
// ----------------------------------------------------------------------------

export interface SendTarget {
  agentId: string;
  sessionId: string;
  label: string;
  status?: "idle" | "running" | "completed" | "error";
}

// ----------------------------------------------------------------------------
// Multi-send result
// ----------------------------------------------------------------------------

export interface MultiSendResult {
  results: Array<{
    target: SendTarget;
    status: "sent" | "failed";
    error?: string;
  }>;
}

// ----------------------------------------------------------------------------
// Agent status for MeshPanel
// ----------------------------------------------------------------------------

export interface MeshAgentStatus {
  agentId: string;
  state: "idle" | "working" | "waiting" | "error" | "disconnected";
  sessions: Array<{
    sessionId: string;
    title: string;
    status: string;
  }>;
  currentTask?: string;
  progress?: number;
}

// ----------------------------------------------------------------------------
// Marker protocol v2 (agent output embedding)
// ----------------------------------------------------------------------------

export const MESH_MARKER_V2_OPEN = "[ACP_MESH_MESSAGE v2]";
export const MESH_MARKER_V2_CLOSE = "[/ACP_MESH_MESSAGE]";

export interface MeshMarkerEnvelope {
  version: "2.0";
  type: P2PMessageType;
  id: string;
  from: string;
  to: string;
  mode: CommunicationMode;
  payload: MeshPayload;
  metadata?: MeshMessageMetadata & { source?: MessageSource };
}
