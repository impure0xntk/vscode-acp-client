// ============================================================================
// SupervisorManager decomposition + retry + file lock tests
// ============================================================================

import * as assert from "assert";
import { SupervisorManager } from "../../domain/services/supervisor-manager";
import type { SupervisorManagerDeps } from "../../domain/services/supervisor-manager";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget } from "../../domain/models/mesh";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import { FileLockManager } from "../../domain/services/file-lock-manager";
import {
  MESH_MARKER_V2_OPEN,
  MESH_MARKER_CLOSE,
} from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function createDeps(overrides: {
  promptCalls: Array<{ agentId: string; sessionId: string; text: string }>;
  failAgents?: Set<string>;
}): SupervisorManagerDeps {
  const taskBoardStore = new TaskBoardStore();
  const fileLockManager = new FileLockManager();
  const promptCalls = overrides.promptCalls;

  return {
    sessionOrchestrator: {
      prompt: async (agentId: string, sessionId: string, text: string) => {
        promptCalls.push({ agentId, sessionId, text });
        if (overrides.failAgents?.has(agentId)) {
          throw new Error(`Agent ${agentId} failed`);
        }
      },
      getActiveSessionId: () => "s1",
      getAgentConfig: () => ({ name: "test-agent" }),
      getSessionsForAgent: () => [],
    } as unknown as SessionOrchestrator,
    taskBoardStore,
    fileLockManager,
  };
}

function makeTarget(agentId: string, sessionId = "s1"): SendTarget {
  return { agentId, sessionId, label: agentId };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("supervisor-manager decomposition", () => {
  // -----------------------------------------------------------------------
  // 1. Lead output with v2 task_delegate markers
  // -----------------------------------------------------------------------

  describe("lead output decomposition", () => {
    it("should extract sub-tasks from v2 task_delegate markers in lead output", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      const mgr = new SupervisorManager(deps);

      const leadOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify({
        version: "2.0",
        type: "task_delegate",
        id: "td-1",
        from: "lead-agent",
        to: "worker-0",
        mode: "supervisor",
        payload: { agentIndex: 0, description: "Implement auth module" },
      })}${MESH_MARKER_CLOSE}`;

      await mgr.supervise(
        {
          leadTarget: makeTarget("lead-agent"),
          workerTargets: [makeTarget("worker-0"), makeTarget("worker-1")],
          task: "Build the auth system",
          waitForAll: true,
        },
        leadOutput
      );

      // worker-0 should have received the decomposed sub-task
      const worker0Call = promptCalls.find(
        (c) => c.agentId === "worker-0"
      );
      assert.ok(worker0Call, "worker-0 should have received a prompt");
      assert.strictEqual(worker0Call!.text, "Implement auth module");

      // worker-1 should have received the original task (no marker for it)
      const worker1Call = promptCalls.find(
        (c) => c.agentId === "worker-1"
      );
      assert.ok(worker1Call, "worker-1 should have received a prompt");
      assert.strictEqual(worker1Call!.text, "Build the auth system");
    });
  });

  // -----------------------------------------------------------------------
  // 2. No lead output → falls back to original task text
  // -----------------------------------------------------------------------

  describe("no lead output fallback", () => {
    it("should use original task text when no lead output provided", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      const mgr = new SupervisorManager(deps);

      await mgr.supervise({
        leadTarget: makeTarget("lead-agent"),
        workerTargets: [makeTarget("worker-0")],
        task: "Review the code",
        waitForAll: true,
      });

      const workerCall = promptCalls.find((c) => c.agentId === "worker-0");
      assert.ok(workerCall);
      assert.strictEqual(workerCall!.text, "Review the code");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Backward compat: no decomposition config
  // -----------------------------------------------------------------------

  describe("backward compatibility", () => {
    it("should work without taskBoardPath (no TaskBoard sync)", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      const mgr = new SupervisorManager(deps);

      const result = await mgr.supervise({
        leadTarget: makeTarget("lead-agent"),
        workerTargets: [makeTarget("worker-0")],
        task: "Simple task",
        waitForAll: true,
      });

      assert.strictEqual(result.completedCount, 1);
      assert.strictEqual(result.failedCount, 0);
      assert.strictEqual(result.parentTaskId, undefined);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Unknown "to" field in task_delegate → ignored gracefully
  // -----------------------------------------------------------------------

  describe("unknown worker mapping", () => {
    it("should ignore task_delegate markers with unknown agentIndex", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      const mgr = new SupervisorManager(deps);

      const leadOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify({
        version: "2.0",
        type: "task_delegate",
        id: "td-1",
        from: "lead-agent",
        to: "unknown-worker",
        mode: "supervisor",
        payload: { agentIndex: 99, description: "This should be ignored" },
      })}${MESH_MARKER_CLOSE}`;

      const result = await mgr.supervise(
        {
          leadTarget: makeTarget("lead-agent"),
          workerTargets: [makeTarget("worker-0")],
          task: "Original task",
          waitForAll: true,
        },
        leadOutput
      );

      // worker-0 should still get the original task (agentIndex 99 is out of range)
      const workerCall = promptCalls.find((c) => c.agentId === "worker-0");
      assert.ok(workerCall);
      assert.strictEqual(workerCall!.text, "Original task");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Multiple task_delegate markers for different workers
  // -----------------------------------------------------------------------

  describe("multiple task_delegate markers", () => {
    it("should handle multiple task_delegate markers mapping to different workers", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      const mgr = new SupervisorManager(deps);

      const marker1 = `${MESH_MARKER_V2_OPEN}${JSON.stringify({
        version: "2.0",
        type: "task_delegate",
        id: "td-1",
        from: "lead-agent",
        to: "worker-0",
        mode: "supervisor",
        payload: { agentIndex: 0, description: "Write tests" },
      })}${MESH_MARKER_CLOSE}`;

      const marker2 = `${MESH_MARKER_V2_OPEN}${JSON.stringify({
        version: "2.0",
        type: "task_delegate",
        id: "td-2",
        from: "lead-agent",
        to: "worker-1",
        mode: "supervisor",
        payload: { agentIndex: 1, description: "Write docs" },
      })}${MESH_MARKER_CLOSE}`;

      const leadOutput = `Here's my plan:\n${marker1}\n${marker2}`;

      const result = await mgr.supervise(
        {
          leadTarget: makeTarget("lead-agent"),
          workerTargets: [makeTarget("worker-0"), makeTarget("worker-1")],
          task: "Build feature X",
          waitForAll: true,
        },
        leadOutput
      );

      const w0 = promptCalls.find((c) => c.agentId === "worker-0");
      const w1 = promptCalls.find((c) => c.agentId === "worker-1");
      assert.strictEqual(w0!.text, "Write tests");
      assert.strictEqual(w1!.text, "Write docs");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Retry: worker fails once then succeeds
  // -----------------------------------------------------------------------

  describe("retry support", () => {
    it("should retry failed workers up to maxRetries", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      let callCount = 0;
      const deps: SupervisorManagerDeps = {
        sessionOrchestrator: {
          prompt: async (agentId: string, sessionId: string, text: string) => {
            promptCalls.push({ agentId, sessionId, text });
            if (agentId === "worker-0") {
              callCount++;
              if (callCount === 1) throw new Error("transient error");
            }
          },
          getActiveSessionId: () => "s1",
          getAgentConfig: () => ({ name: "test-agent" }),
          getSessionsForAgent: () => [],
        } as unknown as SessionOrchestrator,
        taskBoardStore: new TaskBoardStore(),
        fileLockManager: new FileLockManager(),
      };
      const mgr = new SupervisorManager(deps);

      const result = await mgr.supervise({
        leadTarget: makeTarget("lead-agent"),
        workerTargets: [makeTarget("worker-0")],
        task: "Retry task",
        waitForAll: true,
        maxRetries: 2,
      });

      assert.strictEqual(result.completedCount, 1);
      assert.strictEqual(result.failedCount, 0);
      // worker-0 should have been called twice (1 failure + 1 success)
      const w0Calls = promptCalls.filter((c) => c.agentId === "worker-0");
      assert.strictEqual(w0Calls.length, 2);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Retry exhausted: worker fails all attempts
  // -----------------------------------------------------------------------

  describe("retry exhausted", () => {
    it("should mark worker as failed when retries exhausted", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls, failAgents: new Set(["worker-0"]) });
      const mgr = new SupervisorManager(deps);

      const result = await mgr.supervise({
        leadTarget: makeTarget("lead-agent"),
        workerTargets: [makeTarget("worker-0")],
        task: "Always fails",
        waitForAll: true,
        maxRetries: 2,
      });

      assert.strictEqual(result.completedCount, 0);
      assert.strictEqual(result.failedCount, 1);
      // worker-0 should have been called 3 times (1 initial + 2 retries)
      const w0Calls = promptCalls.filter((c) => c.agentId === "worker-0");
      assert.strictEqual(w0Calls.length, 3);
    });
  });

  // -----------------------------------------------------------------------
  // 8. File lock integration
  // -----------------------------------------------------------------------

  describe("file lock integration", () => {
    it("should acquire and release file locks around worker execution", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      const mgr = new SupervisorManager(deps);

      const result = await mgr.supervise({
        leadTarget: makeTarget("lead-agent"),
        workerTargets: [makeTarget("worker-0")],
        task: "Edit shared file",
        waitForAll: true,
        lockFiles: ["src/shared.ts"],
      });

      // Lock should be released after completion
      assert.ok(!deps.fileLockManager!.isLocked("src/shared.ts"));
    });

    it("should throw if file lock cannot be acquired", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      const mgr = new SupervisorManager(deps);

      // Pre-lock the file with a different agent
      await deps.fileLockManager!.acquire("src/shared.ts", "other-agent", "write");

      await assert.rejects(
        () =>
          mgr.supervise({
            leadTarget: makeTarget("lead-agent"),
            workerTargets: [makeTarget("worker-0")],
            task: "Edit shared file",
            lockFiles: ["src/shared.ts"],
          }),
        /Failed to acquire file lock/
      );
    });
  });

  // -----------------------------------------------------------------------
  // 9. TaskBoard integration with decomposition
  // -----------------------------------------------------------------------

  describe("task board with decomposition", () => {
    it("should create parent and sub-tasks with decomposed descriptions", async () => {
      const promptCalls: Array<{ agentId: string; sessionId: string; text: string }> = [];
      const deps = createDeps({ promptCalls });
      // Pre-create the task board since we're not going through MeshOrchestrator.startTeam()
      deps.taskBoardStore.create(".acp-mesh/test/taskboard.json");
      const mgr = new SupervisorManager(deps);

      const leadOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify({
        version: "2.0",
        type: "task_delegate",
        id: "td-1",
        from: "lead-agent",
        to: "worker-0",
        mode: "supervisor",
        payload: { agentIndex: 0, description: "Sub-task A" },
      })}${MESH_MARKER_CLOSE}`;

      const result = await mgr.supervise(
        {
          leadTarget: makeTarget("lead-agent"),
          workerTargets: [makeTarget("worker-0")],
          task: "Parent task",
          waitForAll: true,
          taskBoardPath: ".acp-mesh/test/taskboard.json",
        },
        leadOutput
      );

      assert.ok(result.parentTaskId);
      const board = deps.taskBoardStore!.load(".acp-mesh/test/taskboard.json");
      assert.ok(board);
      assert.strictEqual(board!.tasks.length, 2); // parent + 1 sub-task

      const parentTask = board!.tasks.find((t) => t.id === result.parentTaskId);
      assert.ok(parentTask);
      assert.strictEqual(parentTask!.status, "completed");

      const subTask = board!.tasks.find((t) => t.assignedTo === "worker-0");
      assert.ok(subTask);
      assert.strictEqual(subTask!.description, "Sub-task A");
      assert.strictEqual(subTask!.status, "completed");
    });
  });
});
