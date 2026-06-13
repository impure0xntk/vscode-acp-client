// ============================================================================
// Task — unit of work for multi-agent orchestration
// ============================================================================

export type TaskType = "single_agent" | "multi_agent" | "pipeline" | "parallel";
/** @deprecated Use Task.status string literal instead. Kept for backwards compat. */
export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  assignedAgentId: string;
  input: unknown;
  output?: unknown;
  subtasks: Task[];
  dependencies: string[]; // task IDs this task depends on
  createdAt: Date;
  completedAt?: Date;
}

export interface TaskDefinition {
  type: TaskType;
  assignedAgentId: string;
  input: unknown;
  dependencies?: string[];
}
