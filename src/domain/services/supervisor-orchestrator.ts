// ============================================================================
// SupervisorOrchestrator — plan lifecycle, execution engine, and webview sync
//
// refs: docs/supervisor-planner-design.md Section 6
// ============================================================================

import type {
  Plan,
  PlanStep,
  PlanStatus,
  PlanStepStatus,
  PlanExecutionResult,
} from "../models/plan";
import type {
  P2PMessage,
  P2PMessageMetadata,
  SendTarget,
} from "../models/mesh";
import type { MeshOrchestrator } from "./mesh-orchestrator";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { TaskBoardStore } from "./task-board-store";
import { getLogger } from "../../platform/backends";
import {
  parseMeshMarkers,
  tryRepairJson,
} from "../../shared/util/mesh-marker-parser";

const log = getLogger("supervisor");

// ----------------------------------------------------------------------------
// Webview message types (plan.*)
// ----------------------------------------------------------------------------

interface PlanApproveMessage {
  type: "plan.approve";
  planId: string;
}

interface PlanRejectMessage {
  type: "plan.reject";
  planId: string;
}

interface PlanModifyStepMessage {
  type: "plan.modifyStep";
  planId: string;
  stepId: string;
  newDescription: string;
}

interface PlanAddStepMessage {
  type: "plan.addStep";
  planId: string;
  description: string;
  afterStepId?: string;
}

interface PlanRemoveStepMessage {
  type: "plan.removeStep";
  planId: string;
  stepId: string;
}

interface PlanCancelMessage {
  type: "plan.cancel";
  planId: string;
}

interface PlanReplanMessage {
  type: "plan.replan";
  planId: string;
  failedStepId: string;
  reason: string;
}

type PlanWebviewMessage =
  | PlanApproveMessage
  | PlanRejectMessage
  | PlanModifyStepMessage
  | PlanAddStepMessage
  | PlanRemoveStepMessage
  | PlanCancelMessage
  | PlanReplanMessage;

// ----------------------------------------------------------------------------
// Outbound webview messages
// ----------------------------------------------------------------------------

export interface PlanUpdateMessage {
  type: "plan.update";
  plan: Plan;
}

export interface PlanStepUpdateMessage {
  type: "plan.stepUpdate";
  planId: string;
  stepId: string;
  updates: Partial<PlanStep>;
}

export interface PlanExecutionResultMessage {
  type: "plan.executionResult";
  result: PlanExecutionResult;
}

export type PlanOutboundMessage =
  | PlanUpdateMessage
  | PlanStepUpdateMessage
  | PlanExecutionResultMessage;

// ----------------------------------------------------------------------------
// Webview message union (for postMessage typing)
// ----------------------------------------------------------------------------

export type WebviewMessage = PlanOutboundMessage;

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export interface SupervisorOrchestratorDeps {
  meshOrchestrator: MeshOrchestrator;
  sessionOrchestrator: SessionOrchestrator;
  taskBoardStore: TaskBoardStore;
  postMessage: (msg: WebviewMessage) => void;
}

// ----------------------------------------------------------------------------
// SupervisorOrchestrator
// ----------------------------------------------------------------------------

export class SupervisorOrchestrator {
  private meshOrchestrator: MeshOrchestrator;
  private sessionOrchestrator: SessionOrchestrator;
  private taskBoardStore: TaskBoardStore;
  private postMessage: (msg: WebviewMessage) => void;

  private plans: Map<string, Plan> = new Map();
  private runningTasks: Map<string, Set<string>> = new Map();

  constructor(deps: SupervisorOrchestratorDeps) {
    this.meshOrchestrator = deps.meshOrchestrator;
    this.sessionOrchestrator = deps.sessionOrchestrator;
    this.taskBoardStore = deps.taskBoardStore;
    this.postMessage = deps.postMessage;
  }

  // ========================================================================
  // Plan Lifecycle
  // ========================================================================

  /**
   * Request a plan from the planner agent.
   * Sends the user request to the planner via MeshOrchestrator.supervise(),
   * then parses the output into a Plan.
   */
  async createPlan(
    plannerAgentId: string,
    plannerSessionId: string,
    userRequest: string,
    teamId: string
  ): Promise<Plan> {
    const planId = crypto.randomUUID();
    const now = new Date().toISOString();

    const plan: Plan = {
      id: planId,
      teamId,
      status: "draft",
      steps: [],
      plannerAgentId,
      plannerSessionId,
      createdAt: now,
      updatedAt: now,
      metadata: { userRequest },
    };

    this.plans.set(planId, plan);
    log.info("plan created", { planId, teamId, plannerAgentId });

    // Send the planning request to the planner agent
    const plannerTarget: SendTarget = {
      agentId: plannerAgentId,
      sessionId: plannerSessionId,
      label: "Planner",
    };

    try {
      await this.meshOrchestrator.supervise(
        teamId,
        plannerTarget,
        [], // no workers — planner only
        userRequest,
        false
      );
    } catch (e) {
      log.error("planner request failed", { planId }, e as Error);
      plan.status = "failed";
      plan.updatedAt = new Date().toISOString();
      this.syncPlanToWebview(plan);
    }

    return plan;
  }

  /**
   * Parse a Plan from planner agent output.
   * Called as part of session/update streaming.
   * Looks for plan_proposal markers in the output.
   */
  parsePlanFromOutput(
    plannerAgentId: string,
    plannerSessionId: string,
    output: string
  ): Plan | null {
    const { messages } = parseMeshMarkers(output, plannerAgentId);

    for (const msg of messages) {
      if (msg.type !== "plan_proposal") continue;

      const payload = msg.payload as
        | {
            planId?: string;
            steps?: Array<{
              id?: string;
              description?: string;
              assignedTo?: string;
              dependsOn?: string[];
            }>;
          }
        | undefined;

      if (!payload?.steps || payload.steps.length === 0) continue;

      // Find existing draft plan for this planner, or create new
      let plan = this.findDraftPlan(plannerAgentId, plannerSessionId);
      const now = new Date().toISOString();

      if (!plan) {
        plan = {
          id: payload.planId ?? crypto.randomUUID(),
          teamId: "",
          status: "pending",
          steps: [],
          plannerAgentId,
          plannerSessionId,
          createdAt: now,
          updatedAt: now,
          metadata: { userRequest: "" },
        };
      }

      // Map steps
      plan.steps = payload.steps.map((s, idx) => ({
        id: s.id ?? crypto.randomUUID(),
        index: idx,
        description: s.description ?? `Step ${idx + 1}`,
        status: "pending" as PlanStepStatus,
        assignedTo: s.assignedTo
          ? { agentId: s.assignedTo, sessionId: "" }
          : undefined,
        dependsOn: s.dependsOn,
      }));

      plan.status = "pending";
      plan.updatedAt = now;

      this.plans.set(plan.id, plan);
      this.syncPlanToWebview(plan);
      log.info("plan parsed from output", {
        planId: plan.id,
        stepCount: plan.steps.length,
      });

      return plan;
    }

    return null;
  }

  /**
   * Approve a plan — triggers execution.
   */
  async approvePlan(planId: string): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    if (plan.status !== "pending")
      throw new Error(`Plan ${planId} is not pending (status: ${plan.status})`);

    const now = new Date().toISOString();
    plan.status = "approved";
    plan.approvedAt = now;
    plan.updatedAt = now;

    log.info("plan approved", { planId });
    this.syncPlanToWebview(plan);

    // Begin execution
    await this.executePlan(planId);
  }

  /**
   * Reject a plan.
   */
  rejectPlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    plan.status = "rejected";
    plan.updatedAt = new Date().toISOString();

    log.info("plan rejected", { planId });
    this.syncPlanToWebview(plan);
  }

  /**
   * Cancel an executing plan.
   */
  async cancelPlan(planId: string): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const running = this.runningTasks.get(planId);
    if (running) {
      // Cancel all active sessions for this plan
      for (const taskId of running) {
        for (const step of plan.steps) {
          if (step.taskId === taskId && step.assignedTo) {
            try {
              await this.sessionOrchestrator.cancel(
                step.assignedTo.agentId,
                step.assignedTo.sessionId
              );
            } catch {
              // Best-effort cancel
            }
          }
        }
      }
      running.clear();
    }

    plan.status = "cancelled";
    plan.updatedAt = new Date().toISOString();

    // Update task board
    this.cancelTaskBoardEntries(plan);

    log.info("plan cancelled", { planId });
    this.syncPlanToWebview(plan);
  }

  // ========================================================================
  // Plan Execution
  // ========================================================================

  /**
   * Execute an approved plan.
   * Builds a dependency graph, topologically sorts steps, and executes
   * independent batches in parallel.
   */
  async executePlan(planId: string): Promise<PlanExecutionResult> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    if (plan.status !== "approved")
      throw new Error(
        `Plan ${planId} is not approved (status: ${plan.status})`
      );

    plan.status = "executing";
    plan.updatedAt = new Date().toISOString();
    this.syncPlanToWebview(plan);

    log.info("plan execution started", {
      planId,
      stepCount: plan.steps.length,
    });

    // Register running tasks set
    this.runningTasks.set(planId, new Set());

    // Build task board entries
    this.createTaskBoardEntries(plan);

    // Build dependency graph and get execution batches
    const batches = this.buildExecutionBatches(plan.steps);

    const stepResults: PlanExecutionResult["stepResults"] = [];
    let overallStatus: PlanExecutionResult["status"] = "success";

    for (const batch of batches) {
      // Execute batch in parallel
      const batchResults = await Promise.all(
        batch.map((step) => this.executeStep(plan, step))
      );

      stepResults.push(...batchResults);

      // Check for failures
      const failed = batchResults.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        overallStatus = "partial";

        // Attempt replan for the first failure
        const firstFail = failed[0];
        const failStep = plan.steps.find((s) => s.id === firstFail.stepId);
        if (failStep) {
          log.warn("step failed, attempting replan", {
            planId,
            stepId: failStep.id,
            error: firstFail.error,
          });

          try {
            const newPlan = await this.replan(
              planId,
              failStep.id,
              firstFail.error ?? "Unknown error"
            );
            if (newPlan && newPlan.status === "pending") {
              // Wait for user approval of new plan
              this.syncPlanToWebview(newPlan);
              overallStatus = "partial";
              return this.buildResult(planId, overallStatus, stepResults);
            }
          } catch (e) {
            log.error("replan failed", { planId }, e as Error);
          }
        }

        // If replan didn't produce a new approved plan, mark remaining as skipped
        for (const remainingStep of plan.steps) {
          if (remainingStep.status === "pending") {
            remainingStep.status = "skipped";
            this.syncStepToWebview(planId, remainingStep.id, {
              status: "skipped",
            });
          }
        }
        break;
      }
    }

    // Determine final status
    const allCompleted = plan.steps.every((s) => s.status === "completed");
    const anyFailed = plan.steps.some((s) => s.status === "failed");
    plan.status = allCompleted
      ? "completed"
      : anyFailed
        ? "failed"
        : "completed";
    plan.completedAt = new Date().toISOString();
    plan.updatedAt = plan.completedAt;

    if (!allCompleted && !anyFailed) {
      overallStatus = "partial";
    } else if (anyFailed && !allCompleted) {
      overallStatus = "failed";
    }

    // Update task board
    this.updateTaskBoardParentStatus(plan);

    // Clean up running tasks
    this.runningTasks.delete(planId);

    const result = this.buildResult(planId, overallStatus, stepResults);

    log.info("plan execution completed", {
      planId,
      status: plan.status,
      completedCount: stepResults.filter((r) => r.status === "completed")
        .length,
      failedCount: stepResults.filter((r) => r.status === "failed").length,
    });

    this.syncPlanToWebview(plan);
    this.postMessage({ type: "plan.executionResult", result });

    return result;
  }

  /**
   * Execute a single plan step.
   * Sends the task to the assigned worker agent via MeshOrchestrator.
   */
  private async executeStep(
    plan: Plan,
    step: PlanStep
  ): Promise<PlanExecutionResult["stepResults"][number]> {
    const startedAt = Date.now();
    step.status = "in_progress";
    step.startedAt = new Date().toISOString();
    this.syncStepToWebview(plan.id, step.id, {
      status: "in_progress",
      startedAt: step.startedAt,
    });

    // Update task board
    this.updateTaskBoardStepStatus(plan, step, "in_progress");

    // If no assigned agent, try to find one from the team
    if (!step.assignedTo) {
      const team = this.meshOrchestrator.getTeam(plan.teamId);
      if (team && team.memberAgentIds.length > 0) {
        const agentId =
          team.memberAgentIds[step.index % team.memberAgentIds.length];
        const activeSessionId =
          this.sessionOrchestrator.getActiveSessionId(agentId);
        step.assignedTo = {
          agentId,
          sessionId: activeSessionId ?? "",
        };
      }
    }

    if (!step.assignedTo || !step.assignedTo.sessionId) {
      step.status = "failed";
      step.error = "No available worker agent";
      step.completedAt = new Date().toISOString();
      this.syncStepToWebview(plan.id, step.id, {
        status: "failed",
        error: step.error,
        completedAt: step.completedAt,
      });
      return {
        stepId: step.id,
        status: "failed",
        agentId: step.assignedTo?.agentId ?? "",
        sessionId: step.assignedTo?.sessionId ?? "",
        error: step.error,
        durationMs: Date.now() - startedAt,
      };
    }

    const taskId = crypto.randomUUID();
    step.taskId = taskId;
    const running = this.runningTasks.get(plan.id);
    if (running) running.add(taskId);

    try {
      // Build task request message
      const taskMessage: P2PMessage = {
        id: taskId,
        type: "task_request",
        from: plan.plannerAgentId,
        to: step.assignedTo.agentId,
        timestamp: new Date(),
        payload: {
          taskId,
          title: step.description.substring(0, 50),
          description: step.description,
          priority: "normal",
        },
        metadata: {
          replyTo: plan.id,
          source: { type: "orchestrator" },
        } as P2PMessageMetadata,
      };

      // Send via sessionOrchestrator (direct prompt with marker)
      const { serializeToMarker } =
        await import("../../shared/util/mesh-marker-parser.js");
      const markerText = serializeToMarker(taskMessage, "2");

      await this.sessionOrchestrator.prompt(
        step.assignedTo.agentId,
        step.assignedTo.sessionId,
        markerText
      );

      // For now, mark as completed after successful send.
      // In a full implementation, we'd wait for the task_response marker.
      step.status = "completed";
      step.completedAt = new Date().toISOString();

      if (running) running.delete(taskId);

      this.syncStepToWebview(plan.id, step.id, {
        status: "completed",
        completedAt: step.completedAt,
      });
      this.updateTaskBoardStepStatus(plan, step, "completed");

      return {
        stepId: step.id,
        status: "completed",
        agentId: step.assignedTo.agentId,
        sessionId: step.assignedTo.sessionId,
        durationMs: Date.now() - startedAt,
      };
    } catch (e) {
      step.status = "failed";
      step.error = e instanceof Error ? e.message : String(e);
      step.completedAt = new Date().toISOString();

      if (running) running.delete(taskId);

      this.syncStepToWebview(plan.id, step.id, {
        status: "failed",
        error: step.error,
        completedAt: step.completedAt,
      });
      this.updateTaskBoardStepStatus(plan, step, "failed");

      return {
        stepId: step.id,
        status: "failed",
        agentId: step.assignedTo.agentId,
        sessionId: step.assignedTo.sessionId,
        error: step.error,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Handle task_response messages from worker agents.
   * Called from the message bus subscription.
   */
  handleTaskResponse(message: P2PMessage): void {
    const payload = message.payload as
      | {
          taskId?: string;
          planId?: string;
          status?: string;
          result?: string;
          filesModified?: string[];
          error?: string;
        }
      | undefined;

    if (!payload?.planId || !payload?.taskId) return;

    const plan = this.plans.get(payload.planId);
    if (!plan) return;

    const step = plan.steps.find((s) => s.taskId === payload.taskId);
    if (!step) return;

    const now = new Date().toISOString();

    if (payload.status === "completed") {
      step.status = "completed";
      step.result = payload.result;
      step.completedAt = now;
      this.syncStepToWebview(plan.id, step.id, {
        status: "completed",
        result: payload.result,
        completedAt: now,
      });
      this.updateTaskBoardStepStatus(plan, step, "completed");
    } else if (payload.status === "failed") {
      step.status = "failed";
      step.error = payload.error ?? "Worker reported failure";
      step.completedAt = now;
      this.syncStepToWebview(plan.id, step.id, {
        status: "failed",
        error: step.error,
        completedAt: now,
      });
      this.updateTaskBoardStepStatus(plan, step, "failed");
    }

    plan.updatedAt = now;
  }

  // ========================================================================
  // Replan
  // ========================================================================

  /**
   * Replan after a step failure.
   * Sends the failure context to the planner and creates a new plan.
   */
  async replan(
    planId: string,
    failedStepId: string,
    reason: string
  ): Promise<Plan | null> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    log.info("replan initiated", { planId, failedStepId, reason });

    const failedStep = plan.steps.find((s) => s.id === failedStepId);
    if (!failedStep) return null;

    // Ask the planner to revise the plan
    const replanRequest = `Step "${failedStep.description}" failed: ${reason}. Please revise the plan from this step onward.`;

    try {
      await this.meshOrchestrator.supervise(
        plan.teamId,
        {
          agentId: plan.plannerAgentId,
          sessionId: plan.plannerSessionId,
          label: "Planner",
        },
        [],
        replanRequest,
        false
      );

      // The planner's response will come through parsePlanFromOutput
      // For now, create a new plan with remaining steps
      const now = new Date().toISOString();
      const remainingSteps = plan.steps
        .filter(
          (s) =>
            s.status === "pending" ||
            s.status === "failed" ||
            s.id === failedStepId
        )
        .map((s, idx) => ({
          ...s,
          id: s.id === failedStepId ? s.id : crypto.randomUUID(),
          index: idx,
          status: "pending" as PlanStepStatus,
          error: undefined,
          result: undefined,
          startedAt: undefined,
          completedAt: undefined,
        }));

      const newPlan: Plan = {
        id: crypto.randomUUID(),
        teamId: plan.teamId,
        status: "pending",
        steps: remainingSteps,
        plannerAgentId: plan.plannerAgentId,
        plannerSessionId: plan.plannerSessionId,
        createdAt: now,
        updatedAt: now,
        metadata: {
          ...plan.metadata,
          userRequest: `${plan.metadata.userRequest} (replan: ${reason})`,
        },
      };

      this.plans.set(newPlan.id, newPlan);
      this.syncPlanToWebview(newPlan);

      return newPlan;
    } catch (e) {
      log.error("replan failed", { planId }, e as Error);
      return null;
    }
  }

  // ========================================================================
  // Step Modification (user edits)
  // ========================================================================

  modifyStep(planId: string, stepId: string, newDescription: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return;

    step.description = newDescription;
    plan.updatedAt = new Date().toISOString();

    this.syncStepToWebview(planId, stepId, { description: newDescription });
    this.syncPlanToWebview(plan);
  }

  addStep(planId: string, description: string, afterStepId?: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    const newStep: PlanStep = {
      id: crypto.randomUUID(),
      index: plan.steps.length,
      description,
      status: "pending",
    };

    if (afterStepId) {
      const afterIdx = plan.steps.findIndex((s) => s.id === afterStepId);
      if (afterIdx >= 0) {
        plan.steps.splice(afterIdx + 1, 0, newStep);
        // Re-index
        plan.steps.forEach((s, i) => (s.index = i));
      } else {
        plan.steps.push(newStep);
      }
    } else {
      plan.steps.push(newStep);
    }

    plan.updatedAt = new Date().toISOString();
    this.syncPlanToWebview(plan);
  }

  removeStep(planId: string, stepId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    const idx = plan.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return;

    plan.steps.splice(idx, 1);
    plan.steps.forEach((s, i) => (s.index = i));
    plan.updatedAt = new Date().toISOString();

    this.syncPlanToWebview(plan);
  }

  // ========================================================================
  // State Queries
  // ========================================================================

  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  getAllPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  getPlansByStatus(status: PlanStatus): Plan[] {
    return Array.from(this.plans.values()).filter((p) => p.status === status);
  }

  // ========================================================================
  // Dependency Graph + Topological Sort
  // ========================================================================

  /**
   * Build execution batches from steps based on dependency graph.
   * Each batch contains steps that can execute in parallel.
   */
  private buildExecutionBatches(steps: PlanStep[]): PlanStep[][] {
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const batches: PlanStep[][] = [];

    const visit = (step: PlanStep, batchIndex: number): void => {
      if (visited.has(step.id)) return;
      visited.add(step.id);

      // Determine the earliest batch this step can go into
      let targetBatch = batchIndex;
      for (const depId of step.dependsOn ?? []) {
        const dep = stepMap.get(depId);
        if (dep && !visited.has(dep.id)) {
          visit(dep, batchIndex + 1);
          targetBatch = Math.max(targetBatch, batchIndex + 1);
        } else if (dep) {
          // Find which batch the dep is in
          for (let i = 0; i < batches.length; i++) {
            if (batches[i].some((s) => s.id === depId)) {
              targetBatch = Math.max(targetBatch, i + 1);
              break;
            }
          }
        }
      }

      while (batches.length <= targetBatch) {
        batches.push([]);
      }
      batches[targetBatch].push(step);
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        visit(step, 0);
      }
    }

    return batches.filter((b) => b.length > 0);
  }

  // ========================================================================
  // Task Board Integration
  // ========================================================================

  private createTaskBoardEntries(plan: Plan): void {
    const team = this.meshOrchestrator.getTeam(plan.teamId);
    if (!team) return;

    const path = team.taskBoardPath;
    if (!this.taskBoardStore.load(path)) {
      this.taskBoardStore.create(path);
    }

    // Parent task
    const parent = this.taskBoardStore.addTask(path, {
      id: plan.id,
      title: plan.metadata.userRequest.substring(0, 50),
      description: plan.metadata.userRequest,
      status: "in_progress",
      createdBy: plan.plannerAgentId,
      dependsOn: [],
      subtasks: [],
    });

    // Sub-tasks for each step
    for (const step of plan.steps) {
      const subTask = this.taskBoardStore.addTask(path, {
        id: step.id,
        title: step.description.substring(0, 50),
        description: step.description,
        status: "pending",
        assignedTo: step.assignedTo?.agentId,
        createdBy: plan.plannerAgentId,
        dependsOn: step.dependsOn ?? [],
        subtasks: [],
      });
      parent.subtasks.push(subTask.id);
    }
  }

  private updateTaskBoardStepStatus(
    plan: Plan,
    step: PlanStep,
    status: "pending" | "in_progress" | "completed" | "failed"
  ): void {
    const team = this.meshOrchestrator.getTeam(plan.teamId);
    if (!team) return;

    this.taskBoardStore.updateTask(team.taskBoardPath, step.id, { status });
  }

  private updateTaskBoardParentStatus(plan: Plan): void {
    const team = this.meshOrchestrator.getTeam(plan.teamId);
    if (!team) return;

    const allCompleted = plan.steps.every((s) => s.status === "completed");
    const anyFailed = plan.steps.some((s) => s.status === "failed");

    this.taskBoardStore.updateTask(team.taskBoardPath, plan.id, {
      status: allCompleted ? "completed" : anyFailed ? "failed" : "completed",
    });
  }

  private cancelTaskBoardEntries(plan: Plan): void {
    const team = this.meshOrchestrator.getTeam(plan.teamId);
    if (!team) return;

    for (const step of plan.steps) {
      if (step.status !== "completed") {
        this.taskBoardStore.updateTask(team.taskBoardPath, step.id, {
          status: "failed",
        });
      }
    }
    this.taskBoardStore.updateTask(team.taskBoardPath, plan.id, {
      status: "failed",
    });
  }

  // ========================================================================
  // Webview Sync
  // ========================================================================

  private syncPlanToWebview(plan: Plan): void {
    this.postMessage({ type: "plan.update", plan });
  }

  private syncStepToWebview(
    planId: string,
    stepId: string,
    updates: Partial<PlanStep>
  ): void {
    this.postMessage({ type: "plan.stepUpdate", planId, stepId, updates });
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private findDraftPlan(
    plannerAgentId: string,
    plannerSessionId: string
  ): Plan | undefined {
    for (const plan of this.plans.values()) {
      if (
        plan.plannerAgentId === plannerAgentId &&
        plan.plannerSessionId === plannerSessionId &&
        (plan.status === "draft" || plan.status === "pending")
      ) {
        return plan;
      }
    }
    return undefined;
  }

  private buildResult(
    planId: string,
    status: PlanExecutionResult["status"],
    stepResults: PlanExecutionResult["stepResults"]
  ): PlanExecutionResult {
    const completedCount = stepResults.filter(
      (r) => r.status === "completed"
    ).length;
    const failedCount = stepResults.filter((r) => r.status === "failed").length;

    return {
      planId,
      status,
      stepResults,
      summary: `Plan ${planId}: ${completedCount} completed, ${failedCount} failed`,
      completedAt: new Date().toISOString(),
    };
  }

  // ========================================================================
  // Teardown
  // ========================================================================

  dispose(): void {
    this.plans.clear();
    this.runningTasks.clear();
  }
}
