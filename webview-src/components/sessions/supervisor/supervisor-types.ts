// Supervisor-mode-specific type definitions

export type SupervisorRole = "lead" | "worker" | "reviewer";
export type SupervisorViewMode = "overview" | "focus";

export interface SessionOverviewCardItem {
  sessionKey: string;
  agentId: string;
  sessionId: string;
  title: string;
  agentName?: string;
  role: SupervisorRole;
  status:
    | "idle"
    | "running"
    | "cancelling"
    | "completed"
    | "error"
    | "cancelled";
  assignedStepId?: string;
  lastOutput?: string;
  progress?: number;
  tokenUsage: { input: number; output: number };
  elapsedMs?: number;
  agentColor?: string;
  hasUnread: boolean;
}
