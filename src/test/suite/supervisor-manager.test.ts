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
  prompt: (agentId: string, sessionId: string, text: string, context?: PromptContext) => Promise<QueuedPrompt | undefined>;
  getActiveSessionId: (agentId: string) => string | undefined;
  getAgentConfig: (agentId: string) => undefined;
  getSessionsForAgent: (agentId: string) => [];
}

function createMockOrchestrator(): MockOrchestrator {
  const calls: Array<{ agentId: string; sessionId: string; text: string }> = [];

  return {
    promptCalls: calls,
    prompt: async (agentId: string, sessionId: string, text: string, _context?: PromptContext) => {
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
    const lead: SendTarget = { agentId: "lead", sessionId: "s1", label: "Lead" };
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
    orchestrator.prompt = async (agentId: string, sessionId: string, text: string, _context?: PromptContext) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
      if (agentId === "lead") throw new Error("Lead agent offline");
      return undefined;
    };

    manager = new SupervisorManager({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
      taskBoardStore,
    });

    const lead: SendTarget = { agentId: "lead", sessionId: "s1", label: "Lead" };
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
    orchestrator.prompt = async (agentId: string, sessionId: string, text: string, _context?: PromptContext) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
      if (agentId === "worker-b") throw new Error("Worker B crashed");
      return undefined;
    };

    manager = new SupervisorManager({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
      taskBoardStore,
    });

    const lead: SendTarget = { agentId: "lead", sessionId: "s1", label: "Lead" };
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

  it("handles empty worker list", async () => {
    const lead: SendTarget = { agentId: "lead", sessionId: "s1", label: "Lead" };

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
