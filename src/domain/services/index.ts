// ============================================================================
// Barrel export for services
// ============================================================================

export { StateManager } from "./state-manager";
export { SessionManager } from "./session-manager";
export { AgentRegistryService } from "./agent-registry";
export { MessageRouterService } from "./message-router";
export { TaskSchedulerService } from "./task-scheduler";
export { MessageBus } from "./message-bus";
export { FileLockManager } from "./file-lock-manager";
export { TaskBoardStore } from "./task-board-store";
export { MeshOrchestrator } from "./mesh-orchestrator";
export { FanoutExecutor } from "./fanout-executor";
export { PipelineExecutor } from "./pipeline-executor";
export { SupervisorManager } from "./supervisor-manager";
export {
  PromptBuilder,
  buildMeshSystemPrompt,
  buildPlannerSystemPrompt,
  buildWorkerSystemPrompt,
  buildLeadSystemPrompt,
  buildReviewerSystemPrompt,
  buildUserPromptEnvelope,
  buildReinjectionPrompt,
  buildRepromptMessage,
} from "./prompt-builder";
export type {
  MeshAgentRole,
  MeshProtocolConfig,
  InboundMessage,
} from "./prompt-builder";
export { SupervisorOrchestrator } from "./supervisor-orchestrator";
export type {
  SupervisorOrchestratorDeps,
  PlanWebviewMessage,
  PlanOutboundMessage,
  WebviewMessage,
  PlanApproveMessage,
  PlanRejectMessage,
  PlanModifyStepMessage,
  PlanAddStepMessage,
  PlanRemoveStepMessage,
  PlanCancelMessage,
  PlanReplanMessage,
} from "./supervisor-orchestrator";
