// ============================================================================
// Plan — Supervisor/Planner domain model
//
// refs: docs/supervisor-planner-design.md Section 3
// ============================================================================

export type PlanStatus =
  | "draft"
  | "pending"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

export type PlanStepStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

export interface PlanStep {
  id: string;
  index: number;
  description: string;
  status: PlanStepStatus;
  assignedTo?: {
    agentId: string;
    sessionId: string;
  };
  taskId?: string;
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  dependsOn?: string[];
}

export interface Plan {
  id: string;
  teamId: string;
  status: PlanStatus;
  steps: PlanStep[];
  plannerAgentId: string;
  plannerSessionId: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  completedAt?: string;
  metadata: {
    userRequest: string;
    contextFiles?: string[];
    tags?: string[];
  };
}

export interface PlanExecutionResult {
  planId: string;
  status: "success" | "partial" | "failed";
  stepResults: Array<{
    stepId: string;
    status: PlanStepStatus;
    agentId: string;
    sessionId: string;
    output?: string;
    error?: string;
    durationMs: number;
  }>;
  summary: string;
  completedAt: string;
}
