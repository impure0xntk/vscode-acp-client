// ============================================================================
// TaskBoardStore unit tests
// ============================================================================

import * as assert from "assert";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import type { TaskEntry, MeshTaskStatus } from "../../domain/models/mesh";

const BOARD_PATH = ".acp-mesh/test-team/taskboard.json";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeTask(
  overrides: Partial<TaskEntry> & { id: string }
): Omit<TaskEntry, "createdAt" | "updatedAt"> {
  return {
    title: `Task ${overrides.id}`,
    description: "test task",
    status: "pending",
    createdBy: "agent-lead",
    dependsOn: [],
    subtasks: [],
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("TaskBoardStore", () => {
  let store: TaskBoardStore;

  beforeEach(() => {
    store = new TaskBoardStore();
  });

  afterEach(() => {
    store.dispose();
  });

  describe("create / load", () => {
    it("should create a new task board", () => {
      const board = store.create(BOARD_PATH);
      assert.strictEqual(board.version, "1.0");
      assert.strictEqual(board.teamId, BOARD_PATH);
      assert.deepStrictEqual(board.tasks, []);
      assert.deepStrictEqual(board.fileLocks, []);
      assert.deepStrictEqual(board.messageLog, []);
      assert.ok(board.createdAt);
      assert.ok(board.updatedAt);
    });

    it("should load an existing board", () => {
      store.create(BOARD_PATH);
      const loaded = store.load(BOARD_PATH);
      assert.ok(loaded);
      assert.strictEqual(loaded.teamId, BOARD_PATH);
    });

    it("should return undefined for non-existent board", () => {
      const loaded = store.load(".acp-mesh/nonexistent/taskboard.json");
      assert.strictEqual(loaded, undefined);
    });

    it("should update updatedAt on save", async () => {
      const board = store.create(BOARD_PATH);
      const old = board.updatedAt.getTime();
      await new Promise((r) => setTimeout(r, 5));
      await store.save(BOARD_PATH);
      assert.ok(board.updatedAt.getTime() >= old);
    });
  });

  describe("addTask", () => {
    it("should add a task and set timestamps", () => {
      store.create(BOARD_PATH);
      const task = store.addTask(BOARD_PATH, makeTask({ id: "t1" }));

      assert.strictEqual(task.id, "t1");
      assert.ok(task.createdAt);
      assert.ok(task.updatedAt);
    });

    it("should throw when board does not exist", () => {
      assert.throws(
        () =>
          store.addTask(
            ".acp-mesh/nope/taskboard.json",
            makeTask({ id: "t1" })
          ),
        /TaskBoard not found/
      );
    });
  });

  describe("getTask", () => {
    it("should find a task by ID", () => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1" }));

      const task = store.getTask(BOARD_PATH, "t1");
      assert.ok(task);
      assert.strictEqual(task.id, "t1");
    });

    it("should return undefined for non-existent task", () => {
      store.create(BOARD_PATH);
      const task = store.getTask(BOARD_PATH, "nonexistent");
      assert.strictEqual(task, undefined);
    });

    it("should return undefined for non-existent board", () => {
      const task = store.getTask(".acp-mesh/nope/taskboard.json", "t1");
      assert.strictEqual(task, undefined);
    });
  });

  describe("updateTask", () => {
    it("should update task fields", () => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1" }));

      const updated = store.updateTask(BOARD_PATH, "t1", {
        status: "in_progress",
        assignedTo: "agent-a",
      });

      assert.ok(updated);
      assert.strictEqual(updated.status, "in_progress");
      assert.strictEqual(updated.assignedTo, "agent-a");
    });

    it("should update updatedAt", () => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1" }));
      const before = store.getTask(BOARD_PATH, "t1")!;

      // Small delay so timestamps differ
      const updated = store.updateTask(BOARD_PATH, "t1", {
        status: "completed",
      })!;

      assert.ok(updated.updatedAt >= before.updatedAt);
    });

    it("should return undefined for non-existent task", () => {
      store.create(BOARD_PATH);
      const result = store.updateTask(BOARD_PATH, "nope", {
        status: "completed",
      });
      assert.strictEqual(result, undefined);
    });

    it("should return undefined for non-existent board", () => {
      const result = store.updateTask(".acp-mesh/nope/taskboard.json", "t1", {
        status: "completed",
      });
      assert.strictEqual(result, undefined);
    });
  });

  describe("query helpers", () => {
    beforeEach(() => {
      store.create(BOARD_PATH);
      store.addTask(
        BOARD_PATH,
        makeTask({ id: "t1", assignedTo: "agent-a", status: "in_progress" })
      );
      store.addTask(
        BOARD_PATH,
        makeTask({ id: "t2", assignedTo: "agent-a", status: "completed" })
      );
      store.addTask(
        BOARD_PATH,
        makeTask({ id: "t3", assignedTo: "agent-b", status: "pending" })
      );
    });

    it("should get tasks by agent", () => {
      const tasks = store.getTasksByAgent(BOARD_PATH, "agent-a");
      assert.strictEqual(tasks.length, 2);
      assert.ok(tasks.every((t) => t.assignedTo === "agent-a"));
    });

    it("should get tasks by status", () => {
      const tasks = store.getTasksByStatus(BOARD_PATH, "completed");
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].id, "t2");
    });

    it("should get all tasks", () => {
      const tasks = store.getAllTasks(BOARD_PATH);
      assert.strictEqual(tasks.length, 3);
    });

    it("should return empty array for non-existent board", () => {
      assert.deepStrictEqual(
        store.getAllTasks(".acp-mesh/nope/taskboard.json"),
        []
      );
      assert.deepStrictEqual(
        store.getTasksByAgent(".acp-mesh/nope/taskboard.json", "agent-a"),
        []
      );
      assert.deepStrictEqual(
        store.getTasksByStatus(
          ".acp-mesh/nope/taskboard.json",
          "pending" as MeshTaskStatus
        ),
        []
      );
    });
  });

  describe("file locks mirror", () => {
    it("should set and reflect file locks", () => {
      store.create(BOARD_PATH);
      const locks = [
        {
          filePath: "src/a.ts",
          lockedBy: "agent-a",
          lockedAt: new Date(),
          lockType: "write" as const,
          expiresAt: new Date(),
        },
      ];
      store.setFileLocks(BOARD_PATH, locks);

      const board = store.load(BOARD_PATH);
      assert.ok(board);
      assert.strictEqual(board.fileLocks.length, 1);
    });
  });

  describe("message log", () => {
    it("should append to message log", () => {
      store.create(BOARD_PATH);
      store.appendMessageLog(BOARD_PATH, {
        messageId: "m1",
        type: "question",
        from: "agent-a",
        to: "agent-b",
        timestamp: new Date(),
        summary: "test",
      });

      const log = store.getMessageLog(BOARD_PATH);
      assert.strictEqual(log.length, 1);
      assert.strictEqual(log[0].messageId, "m1");
    });

    it("should return empty array for non-existent board", () => {
      assert.deepStrictEqual(
        store.getMessageLog(".acp-mesh/nope/taskboard.json"),
        []
      );
    });
  });

  describe("dependency helpers", () => {
    beforeEach(() => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1", status: "completed" }));
      store.addTask(
        BOARD_PATH,
        makeTask({ id: "t2", status: "assigned", dependsOn: ["t1"] })
      );
      store.addTask(
        BOARD_PATH,
        makeTask({ id: "t3", status: "pending", dependsOn: ["t1", "t2"] })
      );
    });

    it("should return unresolved dependency IDs", () => {
      const unresolved = store.getUnresolvedDependencies(BOARD_PATH, "t3");
      assert.ok(unresolved.includes("t2"));
      assert.ok(!unresolved.includes("t1"));
    });

    it("should return empty when all deps resolved", () => {
      store.updateTask(BOARD_PATH, "t2", { status: "completed" });
      const unresolved = store.getUnresolvedDependencies(BOARD_PATH, "t3");
      assert.deepStrictEqual(unresolved, []);
    });

    it("should return empty for non-existent task", () => {
      const unresolved = store.getUnresolvedDependencies(BOARD_PATH, "nope");
      assert.deepStrictEqual(unresolved, []);
    });
  });

  describe("cycle detection", () => {
    it("should return no cycles for acyclic graph", () => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1", dependsOn: [] }));
      store.addTask(BOARD_PATH, makeTask({ id: "t2", dependsOn: ["t1"] }));
      store.addTask(BOARD_PATH, makeTask({ id: "t3", dependsOn: ["t2"] }));

      const cycles = store.findCycles(BOARD_PATH);
      assert.deepStrictEqual(cycles, []);
    });

    it("should detect a simple cycle", () => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1", dependsOn: ["t2"] }));
      store.addTask(BOARD_PATH, makeTask({ id: "t2", dependsOn: ["t1"] }));

      const cycles = store.findCycles(BOARD_PATH);
      assert.ok(cycles.length > 0);
    });

    it("should detect self-loop", () => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1", dependsOn: ["t1"] }));

      const cycles = store.findCycles(BOARD_PATH);
      assert.ok(cycles.length > 0);
    });

    it("should return empty for non-existent board", () => {
      const cycles = store.findCycles(".acp-mesh/nope/taskboard.json");
      assert.deepStrictEqual(cycles, []);
    });
  });

  describe("dispose", () => {
    it("should clear all boards", () => {
      store.create(BOARD_PATH);
      store.addTask(BOARD_PATH, makeTask({ id: "t1" }));
      store.dispose();

      assert.strictEqual(store.load(BOARD_PATH), undefined);
      assert.deepStrictEqual(store.getAllTasks(BOARD_PATH), []);
    });
  });
});
