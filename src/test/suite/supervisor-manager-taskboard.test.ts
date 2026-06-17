// ============================================================================
// SupervisorManager TaskBoard integration tests
// ============================================================================

import { describe, it, beforeEach, afterEach } from "mocha";
import * as assert from "assert";
import { SupervisorManager } from "../../domain/services/supervisor-manager";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget } from "../../domain/models/mesh";
import type { PromptContext } from "../../application/session/orchestrator";
import type { QueuedPrompt } from "../../application/session/types";

// ----------------------------------------------------------------------------
// Mock SessionOrchestrator
// ----------------------------------------------------------------------------

interface MockOrchestrator {
  promptCalls: Array<{ agentId: string; sessionId: string; text: string }>;
  prompt: (
    agentId: string,
    sessionId: string,
    text: string,
    context?: PromptContext
  ) => Promise<QueuedPrompt | undefined>;
  getActiveSessionId: (agentId: string) => string | undefined;
  getAgentConfig: (agentId: string) => undefined;
  getSessionsForAgent: (agentId: string) => [];
}

function createMockOrchestrator(): MockOrchestrator {
  const calls: Array<{ agentId: string; sessionId: string; text: string }> = [];

  return {
    promptCalls: calls,
    prompt: async (
      agentId: string,
      sessionId: string,
      text: string,
      _context?: PromptContext
    ) => {
      calls.push({ agentId, sessionId, text });
      return undefined;
    },
    getActiveSessionId: (_agentId: string) => "session-1",
    getAgentConfig: (_agentId: string) => undefined,
    getSessionsForAgent: (_agentId: string) => [],
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("SupervisorManager with TaskBoardStore", () => {
  let orchestrator: MockOrchestrator;
  let taskBoardStore: TaskBoardStore;
  let manager: SupervisorManager;
  const boardPath = "/test/taskboard.json";

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
    taskBoardStore = new TaskBoardStore();
    taskBoardStore.create(boardPath);
    manager = new SupervisorManager({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
      taskBoardStore,
    });
  });

  afterEach(() => {
    taskBoardStore.dispose();
  });

  it("creates parent task when taskBoardPath is provided", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "Implement feature X",
      waitForAll: true,
      taskBoardPath: boardPath,
    });

    assert.ok(result.parentTaskId, "parentTaskId should be set");

    const parentTask = taskBoardStore.getTask(boardPath, result.parentTaskId!);
    assert.ok(parentTask, "parent task should exist");
    assert.strictEqual(parentTask!.title, "Implement feature X");
    assert.strictEqual(parentTask!.status, "completed");
    assert.strictEqual(parentTask!.createdBy, "lead");
  });

  it("creates sub-tasks for each worker", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
      { agentId: "worker-b", sessionId: "s3", label: "Worker B" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "Implement feature X",
      waitForAll: true,
      taskBoardPath: boardPath,
    });

    assert.strictEqual(result.assignments.length, 2);
    assert.ok(result.assignments[0].taskId, "assignment should have taskId");
    assert.ok(result.assignments[1].taskId, "assignment should have taskId");

    const subTask1 = taskBoardStore.getTask(
      boardPath,
      result.assignments[0].taskId!
    );
    const subTask2 = taskBoardStore.getTask(
      boardPath,
      result.assignments[1].taskId!
    );

    assert.ok(subTask1, "sub-task 1 should exist");
    assert.ok(subTask2, "sub-task 2 should exist");
    assert.strictEqual(subTask1!.assignedTo, "worker-a");
    assert.strictEqual(subTask2!.assignedTo, "worker-b");
    assert.strictEqual(subTask1!.dependsOn[0], result.parentTaskId);
    assert.strictEqual(subTask2!.dependsOn[0], result.parentTaskId);
  });

  it("updates sub-task status to completed on success", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test task",
      waitForAll: true,
      taskBoardPath: boardPath,
    });

    const subTask = taskBoardStore.getTask(
      boardPath,
      result.assignments[0].taskId!
    );
    assert.strictEqual(subTask!.status, "completed");
  });

  it("updates sub-task status to failed on error", async () => {
    orchestrator.prompt = async (
      agentId: string,
      sessionId: string,
      text: string,
      _context?: PromptContext
    ) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
      if (agentId === "worker-a") throw new Error("Worker failed");
      return undefined;
    };

    manager = new SupervisorManager({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
      taskBoardStore,
    });

    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test task",
      waitForAll: true,
      taskBoardPath: boardPath,
    });

    const subTask = taskBoardStore.getTask(
      boardPath,
      result.assignments[0].taskId!
    );
    assert.strictEqual(subTask!.status, "failed");
  });

  it("updates parent task status when all workers done", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
      { agentId: "worker-b", sessionId: "s3", label: "Worker B" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test task",
      waitForAll: true,
      taskBoardPath: boardPath,
    });

    const parentTask = taskBoardStore.getTask(boardPath, result.parentTaskId!);
    assert.strictEqual(parentTask!.status, "completed");
  });

  it("updates parent task status to failed when all workers fail", async () => {
    orchestrator.prompt = async (
      agentId: string,
      sessionId: string,
      text: string,
      _context?: PromptContext
    ) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
      if (agentId !== "lead") throw new Error("Worker failed");
      return undefined;
    };

    manager = new SupervisorManager({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
      taskBoardStore,
    });

    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
      { agentId: "worker-b", sessionId: "s3", label: "Worker B" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test task",
      waitForAll: true,
      taskBoardPath: boardPath,
    });

    const parentTask = taskBoardStore.getTask(boardPath, result.parentTaskId!);
    assert.strictEqual(parentTask!.status, "failed");
  });

  it("works without taskBoardPath (backward compat)", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test task",
      waitForAll: true,
    });

    assert.strictEqual(result.parentTaskId, undefined);
    assert.strictEqual(result.completedCount, 1);
    assert.strictEqual(result.failedCount, 0);

    // No tasks should be created on the board
    const allTasks = taskBoardStore.getAllTasks(boardPath);
    assert.strictEqual(allTasks.length, 0);
  });

  it("marks all sub-tasks as failed when lead fails", async () => {
    // Create a new manager with a failing prompt for all agents
    const failingOrchestrator = createMockOrchestrator();
    failingOrchestrator.prompt = async (
      _agentId: string,
      _sessionId: string,
      _text: string,
      _context?: PromptContext
    ) => {
      throw new Error("Agent offline");
    };

    const failingManager = new SupervisorManager({
      sessionOrchestrator:
        failingOrchestrator as unknown as SessionOrchestrator,
      taskBoardStore,
    });

    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
      { agentId: "worker-b", sessionId: "s3", label: "Worker B" },
    ];

    const result = await failingManager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test task",
      taskBoardPath: boardPath,
    });

    assert.strictEqual(result.failedCount, 2);
    // Parent task and sub-tasks are created before lead prompt
    assert.ok(result.parentTaskId, "parentTaskId should be set");

    // Parent task should be marked as failed
    const parentTask = taskBoardStore.getTask(boardPath, result.parentTaskId!);
    assert.strictEqual(parentTask!.status, "failed");

    // Sub-tasks should also be marked as failed
    for (const assignment of result.assignments) {
      const subTask = taskBoardStore.getTask(boardPath, assignment.taskId!);
      assert.strictEqual(subTask!.status, "failed");
    }

    // Total: 1 parent + 2 sub-tasks = 3 tasks
    const allTasks = taskBoardStore.getAllTasks(boardPath);
    assert.strictEqual(allTasks.length, 3);
  });

  it("updates parent subtasks list with sub-task IDs", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
      { agentId: "worker-b", sessionId: "s3", label: "Worker B" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test task",
      waitForAll: true,
      taskBoardPath: boardPath,
    });

    const parentTask = taskBoardStore.getTask(boardPath, result.parentTaskId!);
    assert.strictEqual(parentTask!.subtasks.length, 2);
    assert.ok(parentTask!.subtasks.includes(result.assignments[0].taskId!));
    assert.ok(parentTask!.subtasks.includes(result.assignments[1].taskId!));
  });
});
