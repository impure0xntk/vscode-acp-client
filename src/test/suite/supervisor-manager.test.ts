// ============================================================================
// SupervisorManager tests
// ============================================================================

import { describe, it, beforeEach } from "mocha";
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

describe("SupervisorManager", () => {
  let orchestrator: MockOrchestrator;
  let taskBoardStore: TaskBoardStore;
  let manager: SupervisorManager;

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
    taskBoardStore = new TaskBoardStore();
    manager = new SupervisorManager({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
      taskBoardStore,
    });
  });

  it("sends task to lead then distributes to workers", async () => {
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
    });

    const totalProcessed = result.completedCount + result.failedCount;
    assert.strictEqual(totalProcessed, 2);

    assert.strictEqual(orchestrator.promptCalls[0].agentId, "lead");
    assert.strictEqual(orchestrator.promptCalls[0].text, "Implement feature X");
    assert.strictEqual(orchestrator.promptCalls[1].agentId, "worker-a");
    assert.strictEqual(orchestrator.promptCalls[2].agentId, "worker-b");
  });

  it("handles lead failure gracefully", async () => {
    orchestrator.promptCalls.length = 0;
    orchestrator.prompt = async (
      agentId: string,
      sessionId: string,
      text: string,
      _context?: PromptContext
    ) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
      if (agentId === "lead") throw new Error("Lead agent offline");
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
      task: "test",
    });

    assert.strictEqual(result.failedCount, 1);
    assert.strictEqual(result.completedCount, 0);
    assert.strictEqual(result.assignments[0].status, "failed");
  });

  it("tracks worker failures without stopping other workers", async () => {
    orchestrator.promptCalls.length = 0;
    orchestrator.prompt = async (
      agentId: string,
      sessionId: string,
      text: string,
      _context?: PromptContext
    ) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
      if (agentId === "worker-b") throw new Error("Worker B crashed");
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
      { agentId: "worker-c", sessionId: "s4", label: "Worker C" },
    ];

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: workers,
      task: "test",
      waitForAll: true,
    });

    assert.strictEqual(result.completedCount, 2);
    assert.strictEqual(result.failedCount, 1);
    assert.strictEqual(result.assignments[0].status, "completed");
    assert.strictEqual(result.assignments[1].status, "failed");
    assert.strictEqual(result.assignments[2].status, "completed");
  });

  it("parses task_plan markers from lead output", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
      { agentId: "worker-b", sessionId: "s3", label: "Worker B" },
    ];

    const leadOutput =
      "Here is my plan.\n" +
      "[ACP_MESH_MESSAGE v2]" +
      JSON.stringify({
        version: "2.0",
        type: "task_plan",
        id: "plan-1",
        from: "lead",
        to: "orchestrator",
        mode: "supervisor",
        payload: {
          parentTaskId: "task-1",
          subtasks: [
            {
              index: 0,
              description: "Implement OAuth2 flow",
              complexity: "high",
            },
            { index: 1, description: "Write tests", complexity: "low" },
          ],
        },
      }) +
      "[/ACP_MESH_MESSAGE]";

    const result = await manager.supervise(
      {
        leadTarget: lead,
        workerTargets: workers,
        task: "Refactor auth",
        waitForAll: true,
      },
      leadOutput
    );

    assert.strictEqual(result.assignments[0].subTask, "Implement OAuth2 flow");
    assert.strictEqual(result.assignments[1].subTask, "Write tests");
  });

  it("parses task_delegate markers from lead output", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
      { agentId: "worker-b", sessionId: "s3", label: "Worker B" },
    ];

    const leadOutput =
      "[ACP_MESH_MESSAGE v2]" +
      JSON.stringify({
        version: "2.0",
        type: "task_delegate",
        id: "del-1",
        from: "lead",
        to: "orchestrator",
        mode: "supervisor",
        payload: { agentIndex: 1, description: "Write unit tests" },
      }) +
      "[/ACP_MESH_MESSAGE]";

    const result = await manager.supervise(
      {
        leadTarget: lead,
        workerTargets: workers,
        task: "Refactor auth",
        waitForAll: true,
      },
      leadOutput
    );

    // worker-a keeps default task (agentIndex 0 not specified)
    assert.strictEqual(result.assignments[0].subTask, "Refactor auth");
    // worker-b gets the delegated description
    assert.strictEqual(result.assignments[1].subTask, "Write unit tests");
  });

  it("handles task_plan with out-of-range index gracefully", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
    ];

    const leadOutput =
      "[ACP_MESH_MESSAGE v2]" +
      JSON.stringify({
        version: "2.0",
        type: "task_plan",
        id: "plan-1",
        from: "lead",
        to: "orchestrator",
        mode: "supervisor",
        payload: {
          subtasks: [
            { index: 0, description: "Valid task" },
            { index: 5, description: "Out of range" },
            { index: -1, description: "Negative index" },
          ],
        },
      }) +
      "[/ACP_MESH_MESSAGE]";

    const result = await manager.supervise(
      {
        leadTarget: lead,
        workerTargets: workers,
        task: "Refactor auth",
        waitForAll: true,
      },
      leadOutput
    );

    assert.strictEqual(result.assignments[0].subTask, "Valid task");
  });

  it("handles task_plan with missing subtasks field", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };
    const workers: SendTarget[] = [
      { agentId: "worker-a", sessionId: "s2", label: "Worker A" },
    ];

    const leadOutput =
      "[ACP_MESH_MESSAGE v2]" +
      JSON.stringify({
        version: "2.0",
        type: "task_plan",
        id: "plan-1",
        from: "lead",
        to: "orchestrator",
        mode: "supervisor",
        payload: { parentTaskId: "task-1" },
      }) +
      "[/ACP_MESH_MESSAGE]";

    const result = await manager.supervise(
      {
        leadTarget: lead,
        workerTargets: workers,
        task: "Refactor auth",
        waitForAll: true,
      },
      leadOutput
    );

    // Falls back to default task
    assert.strictEqual(result.assignments[0].subTask, "Refactor auth");
  });

  it("handles empty worker list", async () => {
    const lead: SendTarget = {
      agentId: "lead",
      sessionId: "s1",
      label: "Lead",
    };

    const result = await manager.supervise({
      leadTarget: lead,
      workerTargets: [],
      task: "solo task",
    });

    assert.strictEqual(result.assignments.length, 0);
    assert.strictEqual(result.completedCount, 0);
    assert.strictEqual(result.failedCount, 0);
    assert.strictEqual(orchestrator.promptCalls.length, 1);
  });
});
