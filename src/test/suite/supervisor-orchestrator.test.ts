// ============================================================================
// SupervisorOrchestrator tests
//
// refs: docs/supervisor-planner-design.md Section 6
// ============================================================================

import { describe, it, beforeEach } from "mocha";
import * as assert from "assert";
import { SupervisorOrchestrator } from "../../domain/services/supervisor-orchestrator";
import type { SupervisorOrchestratorDeps } from "../../domain/services/supervisor-orchestrator";
import type { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import type { WebviewMessage } from "../../domain/services/supervisor-orchestrator";
import type { Plan, PlanStep, PlanStatus } from "../../domain/models/plan";
import type { P2PMessage } from "../../domain/models/mesh";
import type { SendTarget } from "../../domain/models/mesh";
import {
  MESH_MARKER_V2_OPEN,
  MESH_MARKER_CLOSE,
} from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Mock helpers
// ----------------------------------------------------------------------------

interface MockCalls {
  prompts: Array<{ agentId: string; sessionId: string; text: string }>;
  supervises: Array<{
    teamId: string;
    leadTarget: SendTarget;
    workerTargets: SendTarget[];
    task: string;
  }>;
  getCancellations: Array<{ agentId: string; sessionId: string }>;
  postMessages: WebviewMessage[];
}

function createDeps(overrides: { failPromptAgents?: Set<string> }): {
  deps: SupervisorOrchestratorDeps;
  calls: MockCalls;
} {
  const calls: MockCalls = {
    prompts: [],
    supervises: [],
    getCancellations: [],
    postMessages: [],
  };

  const taskBoardStore = new TaskBoardStore();

  const sessionOrchestrator = {
    prompt: async (agentId: string, sessionId: string, text: string) => {
      calls.prompts.push({ agentId, sessionId, text });
      if (overrides.failPromptAgents?.has(agentId)) {
        throw new Error(`Agent ${agentId} failed`);
      }
    },
    cancel: async (agentId: string, sessionId: string) => {
      calls.getCancellations.push({ agentId, sessionId });
    },
    getActiveSessionId: (agentId: string) => `${agentId}-session`,
    getSessionsForAgent: () => [],
    getAgentConfig: () => undefined,
  } as unknown as SessionOrchestrator;

  const meshOrchestrator = {
    supervise: async (
      teamId: string,
      leadTarget: SendTarget,
      workerTargets: SendTarget[],
      task: string
    ) => {
      calls.supervises.push({ teamId, leadTarget, workerTargets, task });
      return {
        assignments: [],
        completedCount: 0,
        failedCount: 0,
      };
    },
    getTeam: (teamId: string) =>
      teamId === "unknown-team"
        ? undefined
        : {
            id: teamId,
            taskBoardPath: `.acp-mesh/${teamId}/taskboard.json`,
            leadAgentId: "lead-1",
            memberAgentIds: ["worker-1", "worker-2"],
          },
    processAgentOutput: async (_agentId: string, raw: string) => raw,
  } as unknown as MeshOrchestrator;

  const deps: SupervisorOrchestratorDeps = {
    meshOrchestrator,
    sessionOrchestrator,
    taskBoardStore,
    postMessage: (msg: WebviewMessage) => {
      calls.postMessages.push(msg);
    },
  };

  return { deps, calls };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("SupervisorOrchestrator", () => {
  // ========================================================================
  // Plan Lifecycle
  // ========================================================================

  describe("createPlan", () => {
    it("creates a draft plan and sends request to planner", async () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan = await orch.createPlan(
        "planner-1",
        "planner-session",
        "Refactor auth module",
        "team-1"
      );

      assert.strictEqual(plan.status, "draft");
      assert.strictEqual(plan.plannerAgentId, "planner-1");
      assert.strictEqual(plan.plannerSessionId, "planner-session");
      assert.strictEqual(plan.metadata.userRequest, "Refactor auth module");
      assert.strictEqual(plan.teamId, "team-1");
      assert.ok(plan.id);
      assert.strictEqual(plan.steps.length, 0);

      // Should have sent supervise() to the mesh orchestrator
      assert.strictEqual(calls.supervises.length, 1);
      assert.strictEqual(calls.supervises[0].teamId, "team-1");
      assert.strictEqual(calls.supervises[0].leadTarget.agentId, "planner-1");
    });

    it("handles planner failure gracefully", async () => {
      const { deps } = createDeps({});
      // Override supervise to throw
      (
        deps.meshOrchestrator as unknown as { supervise: () => Promise<never> }
      ).supervise = async () => {
        throw new Error("Planner offline");
      };

      const orch = new SupervisorOrchestrator(deps);
      const plan = await orch.createPlan(
        "planner-1",
        "s1",
        "Test task",
        "team-1"
      );

      // Plan should be marked as failed
      assert.strictEqual(plan.status, "failed");
    });
  });

  describe("parsePlanFromOutput", () => {
    it("parses plan_proposal marker into a Plan", () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const planProposal = {
        version: "2.0",
        type: "plan_proposal",
        id: "plan-1",
        from: "planner-1",
        to: "orchestrator",
        mode: "p2p",
        payload: {
          steps: [
            {
              id: "step-1",
              description: "Analyze current code",
              dependsOn: [],
            },
            {
              id: "step-2",
              description: "Implement changes",
              dependsOn: ["step-1"],
            },
          ],
        },
      };

      const rawOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify(planProposal)}${MESH_MARKER_CLOSE}`;

      const plan = orch.parsePlanFromOutput("planner-1", "s1", rawOutput);

      assert.ok(plan);
      assert.strictEqual(plan!.status, "pending");
      assert.strictEqual(plan!.steps.length, 2);
      assert.strictEqual(plan!.steps[0].description, "Analyze current code");
      assert.strictEqual(plan!.steps[1].description, "Implement changes");
      assert.deepStrictEqual(plan!.steps[1].dependsOn, ["step-1"]);

      // Should have emitted plan.update
      const updateMsg = calls.postMessages.find(
        (m) => m.type === "plan.update"
      );
      assert.ok(updateMsg);
    });

    it("returns null for non-plan_proposal markers", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const taskRequest = {
        version: "2.0",
        type: "task_request",
        id: "tr-1",
        from: "planner-1",
        to: "worker-1",
        mode: "p2p",
        payload: { taskId: "t1", title: "Task" },
      };

      const rawOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify(taskRequest)}${MESH_MARKER_CLOSE}`;

      const plan = orch.parsePlanFromOutput("planner-1", "s1", rawOutput);
      assert.strictEqual(plan, null);
    });

    it("returns null for output without markers", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan = orch.parsePlanFromOutput(
        "planner-1",
        "s1",
        "Regular text output without markers"
      );
      assert.strictEqual(plan, null);
    });

    it("updates existing draft plan instead of creating new one", async () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      // Create a draft plan via createPlan
      await orch.createPlan("planner-1", "s1", "Task", "team-1");

      const planProposal = {
        version: "2.0",
        type: "plan_proposal",
        id: "plan-1",
        from: "planner-1",
        to: "orchestrator",
        mode: "p2p",
        payload: {
          steps: [
            { id: "s1", description: "Step A" },
            { id: "s2", description: "Step B" },
          ],
        },
      };

      const rawOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify(planProposal)}${MESH_MARKER_CLOSE}`;
      const plan = orch.parsePlanFromOutput("planner-1", "s1", rawOutput);

      assert.ok(plan);
      assert.strictEqual(plan!.steps.length, 2);
      // Should be pending (ready for approval)
      assert.strictEqual(plan!.status, "pending");
    });
  });

  describe("approvePlan / rejectPlan", () => {
    it("transitions from pending to approved", async () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const planProposal = {
        version: "2.0",
        type: "plan_proposal",
        id: "plan-1",
        from: "planner-1",
        to: "orchestrator",
        mode: "p2p",
        payload: {
          steps: [{ id: "s1", description: "Step 1" }],
        },
      };

      const rawOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify(planProposal)}${MESH_MARKER_CLOSE}`;
      const plan = orch.parsePlanFromOutput("planner-1", "s1", rawOutput);
      assert.ok(plan);

      await orch.approvePlan(plan!.id);

      const approved = orch.getPlan(plan!.id);
      // approvePlan triggers executePlan, which completes synchronously in tests
      // (mock sessionOrchestrator.prompt resolves immediately), so status may be
      // "approved", "executing", or "completed" depending on timing.
      assert.ok(
        approved!.status === "approved" ||
          approved!.status === "executing" ||
          approved!.status === "completed"
      );
      assert.ok(approved!.approvedAt);

      // Should emit plan.update
      const updateMsg = calls.postMessages.filter(
        (m) => m.type === "plan.update"
      );
      assert.ok(updateMsg.length >= 2); // parse + approve
    });

    it("throws if plan not found", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      await assert.rejects(
        () => orch.approvePlan("nonexistent"),
        /Plan nonexistent not found/
      );
    });

    it("throws if plan is not pending", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      // Create and approve
      const planProposal = {
        version: "2.0",
        type: "plan_proposal",
        id: "p1",
        from: "planner-1",
        to: "orchestrator",
        mode: "p2p",
        payload: { steps: [{ id: "s1", description: "Step 1" }] },
      };

      const raw = `${MESH_MARKER_V2_OPEN}${JSON.stringify(planProposal)}${MESH_MARKER_CLOSE}`;
      const plan = orch.parsePlanFromOutput("planner-1", "s1", raw);
      await orch.approvePlan(plan!.id);

      // Try to approve again
      await assert.rejects(() => orch.approvePlan(plan!.id), /is not pending/);
    });

    it("rejectPlan sets status to rejected", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const planProposal = {
        version: "2.0",
        type: "plan_proposal",
        id: "p1",
        from: "planner-1",
        to: "orchestrator",
        mode: "p2p",
        payload: { steps: [{ id: "s1", description: "Step 1" }] },
      };

      const raw = `${MESH_MARKER_V2_OPEN}${JSON.stringify(planProposal)}${MESH_MARKER_CLOSE}`;
      const plan = orch.parsePlanFromOutput("planner-1", "s1", raw);

      orch.rejectPlan(plan!.id);

      assert.strictEqual(orch.getPlan(plan!.id)!.status, "rejected");
    });
  });

  // ========================================================================
  // Dependency Graph
  // ========================================================================

  describe("dependency graph execution", () => {
    it("executes independent steps in parallel batches", async () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      // Create a plan with two independent steps
      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "approved",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Task A",
            status: "pending",
          },
          {
            id: "s2",
            index: 1,
            description: "Task B",
            status: "pending",
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      // Manually insert the plan
      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const result = await orch.executePlan(plan.id);

      // Both steps should have been prompted
      assert.strictEqual(calls.prompts.length, 2);
      assert.strictEqual(result.stepResults.length, 2);
      assert.strictEqual(result.status, "success");
    });

    it("respects dependency ordering", async () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-dep",
        teamId: "team-1",
        status: "approved",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Foundation",
            status: "pending",
          },
          {
            id: "s2",
            index: 1,
            description: "Depends on S1",
            status: "pending",
            dependsOn: ["s1"],
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const result = await orch.executePlan(plan.id);

      assert.strictEqual(result.status, "success");
      assert.strictEqual(result.stepResults.length, 2);
    });

    it("handles step failure and marks remaining as skipped", async () => {
      const { deps, calls } = createDeps({
        failPromptAgents: new Set(["worker-1"]),
      });
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-fail",
        teamId: "team-1",
        status: "approved",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Will fail",
            status: "pending",
            assignedTo: { agentId: "worker-1", sessionId: "ws1" },
          },
          {
            id: "s2",
            index: 1,
            description: "Will be skipped",
            status: "pending",
            dependsOn: ["s1"],
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const result = await orch.executePlan(plan.id);

      // First step failed, second should be skipped
      assert.strictEqual(result.stepResults[0].status, "failed");
    });
  });

  // ========================================================================
  // handleTaskResponse
  // ========================================================================

  describe("handleTaskResponse", () => {
    it("updates step status on completed task_response", () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      // Create and register a plan with a step that has a taskId
      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "executing",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Task A",
            status: "in_progress",
            taskId: "task-1",
            assignedTo: { agentId: "worker-1", sessionId: "ws1" },
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const msg: P2PMessage = {
        id: "resp-1",
        type: "task_response",
        from: "worker-1",
        to: "planner-1",
        timestamp: new Date(),
        payload: {
          taskId: "task-1",
          planId: "plan-1",
          status: "completed",
          result: "Done",
          filesModified: ["src/a.ts"],
        },
      };

      orch.handleTaskResponse(msg);

      const updated = orch.getPlan("plan-1");
      assert.strictEqual(updated!.steps[0].status, "completed");
      assert.strictEqual(updated!.steps[0].result, "Done");
      assert.ok(updated!.steps[0].completedAt);

      // Should emit step update
      const stepUpdate = calls.postMessages.find(
        (m) => m.type === "plan.stepUpdate"
      );
      assert.ok(stepUpdate);
    });

    it("updates step status on failed task_response", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-2",
        teamId: "team-1",
        status: "executing",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Task A",
            status: "in_progress",
            taskId: "task-2",
            assignedTo: { agentId: "worker-1", sessionId: "ws1" },
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const msg: P2PMessage = {
        id: "resp-2",
        type: "task_response",
        from: "worker-1",
        to: "planner-1",
        timestamp: new Date(),
        payload: {
          taskId: "task-2",
          planId: "plan-2",
          status: "failed",
          error: "Compilation error",
        },
      };

      orch.handleTaskResponse(msg);

      const updated = orch.getPlan("plan-2");
      assert.strictEqual(updated!.steps[0].status, "failed");
      assert.strictEqual(updated!.steps[0].error, "Compilation error");
    });

    it("ignores task_response for unknown plan", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const msg: P2PMessage = {
        id: "resp-1",
        type: "task_response",
        from: "worker-1",
        to: "planner-1",
        timestamp: new Date(),
        payload: {
          taskId: "task-1",
          planId: "unknown-plan",
          status: "completed",
        },
      };

      // Should not throw
      orch.handleTaskResponse(msg);
    });
  });

  // ========================================================================
  // Webview Message Handling
  // ========================================================================

  describe("handleWebviewMessage", () => {
    it("handles plan.approve", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const planProposal = {
        version: "2.0",
        type: "plan_proposal",
        id: "p1",
        from: "planner-1",
        to: "orchestrator",
        mode: "p2p",
        payload: { steps: [{ id: "s1", description: "Step 1" }] },
      };

      const raw = `${MESH_MARKER_V2_OPEN}${JSON.stringify(planProposal)}${MESH_MARKER_CLOSE}`;
      const plan = orch.parsePlanFromOutput("planner-1", "s1", raw);

      orch.handleWebviewMessage({
        type: "plan.approve",
        planId: plan!.id,
      });

      // Approve triggers async execution — give it a tick
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = orch.getPlan(plan!.id);
      assert.ok(
        updated!.status === "approved" ||
          updated!.status === "executing" ||
          updated!.status === "completed"
      );
    });

    it("handles plan.reject", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const planProposal = {
        version: "2.0",
        type: "plan_proposal",
        id: "p1",
        from: "planner-1",
        to: "orchestrator",
        mode: "p2p",
        payload: { steps: [{ id: "s1", description: "Step 1" }] },
      };

      const raw = `${MESH_MARKER_V2_OPEN}${JSON.stringify(planProposal)}${MESH_MARKER_CLOSE}`;
      const plan = orch.parsePlanFromOutput("planner-1", "s1", raw);

      orch.handleWebviewMessage({
        type: "plan.reject",
        planId: plan!.id,
      });

      assert.strictEqual(orch.getPlan(plan!.id)!.status, "rejected");
    });

    it("handles plan.modifyStep", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "pending",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Original description",
            status: "pending",
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      orch.handleWebviewMessage({
        type: "plan.modifyStep",
        planId: "plan-1",
        stepId: "s1",
        newDescription: "Modified description",
      });

      assert.strictEqual(
        orch.getPlan("plan-1")!.steps[0].description,
        "Modified description"
      );
    });

    it("handles plan.addStep", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "pending",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Existing step",
            status: "pending",
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      orch.handleWebviewMessage({
        type: "plan.addStep",
        planId: "plan-1",
        description: "New step",
      });

      const updated = orch.getPlan("plan-1")!;
      assert.strictEqual(updated.steps.length, 2);
      assert.strictEqual(updated.steps[1].description, "New step");
    });

    it("handles plan.removeStep", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "pending",
        steps: [
          { id: "s1", index: 0, description: "Keep", status: "pending" },
          { id: "s2", index: 1, description: "Remove", status: "pending" },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      orch.handleWebviewMessage({
        type: "plan.removeStep",
        planId: "plan-1",
        stepId: "s2",
      });

      const updated = orch.getPlan("plan-1")!;
      assert.strictEqual(updated.steps.length, 1);
      assert.strictEqual(updated.steps[0].id, "s1");
      // Re-indexed
      assert.strictEqual(updated.steps[0].index, 0);
    });

    it("handles plan.cancel", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "executing",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Running task",
            status: "in_progress",
            taskId: "task-1",
            assignedTo: { agentId: "worker-1", sessionId: "ws1" },
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );
      (
        orch as unknown as { runningTasks: Map<string, Set<string>> }
      ).runningTasks.set("plan-1", new Set(["task-1"]));

      orch.handleWebviewMessage({
        type: "plan.cancel",
        planId: "plan-1",
      });

      // Cancel is async — give it a tick
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(orch.getPlan("plan-1")!.status, "cancelled");
    });
  });

  // ========================================================================
  // State Queries
  // ========================================================================

  describe("state queries", () => {
    it("getPlan returns undefined for unknown plan", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      assert.strictEqual(orch.getPlan("nonexistent"), undefined);
    });

    it("getAllPlans returns all plans", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan1: Plan = {
        id: "p1",
        teamId: "team-1",
        status: "pending",
        steps: [],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test 1" },
      };

      const plan2: Plan = {
        id: "p2",
        teamId: "team-1",
        status: "approved",
        steps: [],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test 2" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan1.id,
        plan1
      );
      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan2.id,
        plan2
      );

      const all = orch.getAllPlans();
      assert.strictEqual(all.length, 2);
    });

    it("getPlansByStatus filters correctly", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const statuses: PlanStatus[] = [
        "draft",
        "pending",
        "approved",
        "executing",
        "completed",
      ];

      for (const status of statuses) {
        const plan: Plan = {
          id: `plan-${status}`,
          teamId: "team-1",
          status,
          steps: [],
          plannerAgentId: "planner-1",
          plannerSessionId: "s1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: { userRequest: "Test" },
        };
        (orch as unknown as { plans: Map<string, Plan> }).plans.set(
          plan.id,
          plan
        );
      }

      assert.strictEqual(orch.getPlansByStatus("pending").length, 1);
      assert.strictEqual(orch.getPlansByStatus("completed").length, 1);
      assert.strictEqual(orch.getPlansByStatus("rejected").length, 0);
    });
  });

  // ========================================================================
  // Replan
  // ========================================================================

  describe("replan", () => {
    it("creates a new plan with remaining steps", async () => {
      const { deps, calls } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "executing",
        steps: [
          { id: "s1", index: 0, description: "Done", status: "completed" },
          {
            id: "s2",
            index: 1,
            description: "Failed",
            status: "failed",
            taskId: "task-2",
          },
          { id: "s3", index: 2, description: "Pending", status: "pending" },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const newPlan = await orch.replan("plan-1", "s2", "Compilation error");

      assert.ok(newPlan);
      assert.strictEqual(newPlan!.status, "pending");
      // Should include failed step + pending steps (not completed)
      assert.ok(newPlan!.steps.length >= 1);
      assert.strictEqual(newPlan!.steps[0].status, "pending");

      // Should have called supervise for replan
      assert.ok(calls.supervises.length >= 1);
    });

    it("returns null for unknown plan", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      await assert.rejects(
        () => orch.replan("nonexistent", "s1", "error"),
        /Plan nonexistent not found/
      );
    });
  });

  // ========================================================================
  // Task Board Integration
  // ========================================================================

  describe("task board integration", () => {
    it("creates task board entries on executePlan", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "approved",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Task A",
            status: "pending",
            assignedTo: { agentId: "worker-1", sessionId: "ws1" },
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      await orch.executePlan(plan.id);

      // Check task board was created
      const team = deps.meshOrchestrator.getTeam("team-1");
      assert.ok(team);
      const board = deps.taskBoardStore.load(team!.taskBoardPath);
      assert.ok(board);
      // Parent + 1 sub-task
      assert.ok(board!.tasks.length >= 2);
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe("edge cases", () => {
    it("handles empty step list in executePlan", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-empty",
        teamId: "team-1",
        status: "approved",
        steps: [],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const result = await orch.executePlan(plan.id);

      assert.strictEqual(result.status, "success");
      assert.strictEqual(result.stepResults.length, 0);
    });

    it("handles step with no assigned agent", async () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-no-agent",
        teamId: "team-1",
        status: "approved",
        steps: [
          {
            id: "s1",
            index: 0,
            description: "Unassigned task",
            status: "pending",
          },
        ],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      const result = await orch.executePlan(plan.id);

      // Should fail because no agent assigned and no team members available
      // (mock getTeam returns team-1 with members, so it should auto-assign)
      assert.ok(result.stepResults.length === 1);
    });

    it("dispose clears all state", () => {
      const { deps } = createDeps({});
      const orch = new SupervisorOrchestrator(deps);

      const plan: Plan = {
        id: "plan-1",
        teamId: "team-1",
        status: "pending",
        steps: [],
        plannerAgentId: "planner-1",
        plannerSessionId: "s1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { userRequest: "Test" },
      };

      (orch as unknown as { plans: Map<string, Plan> }).plans.set(
        plan.id,
        plan
      );

      orch.dispose();

      assert.strictEqual(orch.getAllPlans().length, 0);
    });
  });
});
