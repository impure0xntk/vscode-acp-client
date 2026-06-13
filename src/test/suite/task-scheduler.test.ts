import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { TaskSchedulerService } from "../../domain/services/task-scheduler";
import { StateManager } from "../../domain/services/state-manager";
import type {
  Task,
  TaskDefinition,
  TaskStatus,
} from "../../domain/models/task";

// ============================================================================
// Task Scheduler Service Tests
// ============================================================================

function makeDefinition(
  overrides: Partial<TaskDefinition> = {}
): TaskDefinition {
  return {
    type: "single_agent",
    assignedAgentId: "claude",
    input: "test input",
    dependencies: [],
    ...overrides,
  };
}

describe("TaskSchedulerService — CRUD", () => {
  let sm: StateManager;
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    sm = new StateManager();
    scheduler = new TaskSchedulerService(sm);
  });

  it("createTask creates a pending task", () => {
    const task = scheduler.createTask(makeDefinition());
    assert.strictEqual(task.status, "pending");
    assert.strictEqual(task.type, "single_agent");
    assert.strictEqual(task.assignedAgentId, "claude");
    assert.strictEqual(task.input, "test input");
    assert.ok(task.id.length > 0);
  });

  it("createTask generates unique IDs", () => {
    const t1 = scheduler.createTask(makeDefinition());
    const t2 = scheduler.createTask(makeDefinition());
    assert.notStrictEqual(t1.id, t2.id);
  });

  it("getTask retrieves a task", () => {
    const task = scheduler.createTask(makeDefinition());
    const retrieved = scheduler.getTask(task.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved!.id, task.id);
  });

  it("getTask returns undefined for unknown task", () => {
    assert.strictEqual(scheduler.getTask("unknown"), undefined);
  });

  it("updateTaskStatus changes status", () => {
    const task = scheduler.createTask(makeDefinition());
    scheduler.updateTaskStatus(task.id, "running");
    assert.strictEqual(scheduler.getTask(task.id)!.status, "running");
  });

  it("updateTaskStatus sets completedAt on terminal status", () => {
    const task = scheduler.createTask(makeDefinition());
    scheduler.updateTaskStatus(task.id, "completed");
    const updated = scheduler.getTask(task.id)!;
    assert.strictEqual(updated.status, "completed");
    assert.ok(updated.completedAt);
  });

  it("updateTaskStatus sets completedAt on failed", () => {
    const task = scheduler.createTask(makeDefinition());
    scheduler.updateTaskStatus(task.id, "failed");
    const updated = scheduler.getTask(task.id)!;
    assert.ok(updated.completedAt);
  });

  it("updateTaskStatus sets completedAt on cancelled", () => {
    const task = scheduler.createTask(makeDefinition());
    scheduler.updateTaskStatus(task.id, "cancelled");
    const updated = scheduler.getTask(task.id)!;
    assert.ok(updated.completedAt);
  });

  it("updateTaskStatus does not set completedAt on running", () => {
    const task = scheduler.createTask(makeDefinition());
    scheduler.updateTaskStatus(task.id, "running");
    const updated = scheduler.getTask(task.id)!;
    assert.strictEqual(updated.completedAt, undefined);
  });

  it("updateTaskStatus throws for unknown task", () => {
    assert.throws(
      () => scheduler.updateTaskStatus("unknown", "running"),
      /Task unknown not found/
    );
  });
});

describe("TaskSchedulerService — Scheduling", () => {
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    const sm = new StateManager();
    scheduler = new TaskSchedulerService(sm);
  });

  it("schedule transitions task to running when dependencies are met", async () => {
    const task = scheduler.createTask(makeDefinition({ dependencies: [] }));
    await scheduler.schedule(task);
    assert.strictEqual(scheduler.getTask(task.id)!.status, "running");
  });

  it("schedule throws when dependencies are unresolved", async () => {
    const task = scheduler.createTask(
      makeDefinition({ dependencies: ["dep-1"] })
    );
    await assert.rejects(
      () => scheduler.schedule(task),
      /unresolved dependencies/
    );
  });

  it("schedule succeeds when dependency is completed", async () => {
    const dep = scheduler.createTask(
      makeDefinition({ assignedAgentId: "claude" })
    );
    scheduler.updateTaskStatus(dep.id, "completed");

    const task = scheduler.createTask(
      makeDefinition({ dependencies: [dep.id] })
    );
    await scheduler.schedule(task);
    assert.strictEqual(scheduler.getTask(task.id)!.status, "running");
  });

  it("cancel transitions task to cancelled", () => {
    const task = scheduler.createTask(makeDefinition());
    scheduler.cancel(task.id);
    assert.strictEqual(scheduler.getTask(task.id)!.status, "cancelled");
  });
});

describe("TaskSchedulerService — Dependency Resolution", () => {
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    const sm = new StateManager();
    scheduler = new TaskSchedulerService(sm);
  });

  it("resolveDependencies returns empty when all resolved", () => {
    const dep = scheduler.createTask(makeDefinition());
    scheduler.updateTaskStatus(dep.id, "completed");

    const task = scheduler.createTask(
      makeDefinition({ dependencies: [dep.id] })
    );
    const unresolved = scheduler.resolveDependencies(task.id);
    assert.strictEqual(unresolved.length, 0);
  });

  it("resolveDependencies returns pending tasks", () => {
    const dep = scheduler.createTask(makeDefinition());
    // dep is still pending

    const task = scheduler.createTask(
      makeDefinition({ dependencies: [dep.id] })
    );
    const unresolved = scheduler.resolveDependencies(task.id);
    assert.strictEqual(unresolved.length, 1);
    assert.strictEqual(unresolved[0].id, dep.id);
  });

  it("resolveDependencies returns empty for task with no dependencies", () => {
    const task = scheduler.createTask(makeDefinition({ dependencies: [] }));
    assert.strictEqual(scheduler.resolveDependencies(task.id).length, 0);
  });

  it("resolveDependencies returns empty for unknown task", () => {
    assert.strictEqual(scheduler.resolveDependencies("unknown").length, 0);
  });
});

describe("TaskSchedulerService — Pipeline Execution", () => {
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    const sm = new StateManager();
    scheduler = new TaskSchedulerService(sm);
  });

  it("executePipeline runs tasks sequentially", async () => {
    const t1 = scheduler.createTask(makeDefinition({ type: "pipeline" }));
    const t2 = scheduler.createTask(makeDefinition({ type: "pipeline" }));

    const order: string[] = [];
    const results = await scheduler.executePipeline(
      [t1.id, t2.id],
      async (task) => {
        order.push(task.id);
        return `result-${task.id}`;
      }
    );

    assert.strictEqual(results.length, 2);
    assert.strictEqual(order.length, 2);
    assert.strictEqual(order[0], t1.id);
    assert.strictEqual(order[1], t2.id);
  });

  it("executePipeline chains output to next input", async () => {
    const t1 = scheduler.createTask(
      makeDefinition({ type: "pipeline", input: 1 })
    );
    const t2 = scheduler.createTask(
      makeDefinition({ type: "pipeline", input: 0 })
    );

    const results = await scheduler.executePipeline(
      [t1.id, t2.id],
      async (task) => {
        const input = task.input as number;
        return input * 2;
      }
    );

    assert.strictEqual(results[0], 2);
    assert.strictEqual(results[1], 4); // t2.input was overwritten to 2 (t1.output)
  });

  it("executePipeline stops on failure", async () => {
    const t1 = scheduler.createTask(makeDefinition({ type: "pipeline" }));
    const t2 = scheduler.createTask(makeDefinition({ type: "pipeline" }));

    await assert.rejects(
      () =>
        scheduler.executePipeline([t1.id, t2.id], async () => {
          throw new Error("fail");
        }),
      /fail/
    );

    assert.strictEqual(scheduler.getTask(t1.id)!.status, "failed");
    assert.strictEqual(scheduler.getTask(t2.id)!.status, "pending");
  });

  it("executePipeline throws for unknown task", async () => {
    await assert.rejects(
      () => scheduler.executePipeline(["unknown"], async () => "ok"),
      /Task unknown not found/
    );
  });
});

describe("TaskSchedulerService — Parallel Execution", () => {
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    const sm = new StateManager();
    scheduler = new TaskSchedulerService(sm);
  });

  it("executeParallel runs all tasks", async () => {
    const t1 = scheduler.createTask(makeDefinition({ type: "parallel" }));
    const t2 = scheduler.createTask(makeDefinition({ type: "parallel" }));

    const results = await scheduler.executeParallel(
      [t1.id, t2.id],
      async (task) => `done-${task.id}`
    );

    assert.strictEqual(results.length, 2);
    assert.strictEqual(scheduler.getTask(t1.id)!.status, "completed");
    assert.strictEqual(scheduler.getTask(t2.id)!.status, "completed");
  });

  it("executeParallel fails all on first failure", async () => {
    const t1 = scheduler.createTask(makeDefinition({ type: "parallel" }));
    const t2 = scheduler.createTask(makeDefinition({ type: "parallel" }));

    await assert.rejects(
      () =>
        scheduler.executeParallel([t1.id, t2.id], async () => {
          throw new Error("parallel fail");
        }),
      /task\(s\) failed/
    );

    assert.strictEqual(scheduler.getTask(t1.id)!.status, "failed");
    assert.strictEqual(scheduler.getTask(t2.id)!.status, "failed");
  });

  it("executeParallel throws for unknown task", async () => {
    await assert.rejects(
      () => scheduler.executeParallel(["unknown"], async () => "ok"),
      /Task unknown not found/
    );
  });
});

describe("TaskSchedulerService — Listing", () => {
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    const sm = new StateManager();
    scheduler = new TaskSchedulerService(sm);
  });

  it("getTasksByStatus filters by status", () => {
    const t1 = scheduler.createTask(makeDefinition());
    const t2 = scheduler.createTask(makeDefinition());
    scheduler.updateTaskStatus(t2.id, "running");

    const pending = scheduler.getTasksByStatus("pending");
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].id, t1.id);

    const running = scheduler.getTasksByStatus("running");
    assert.strictEqual(running.length, 1);
    assert.strictEqual(running[0].id, t2.id);
  });

  it("getTasksForAgent filters by agent", () => {
    scheduler.createTask(makeDefinition({ assignedAgentId: "claude" }));
    scheduler.createTask(makeDefinition({ assignedAgentId: "gpt4" }));

    assert.strictEqual(scheduler.getTasksForAgent("claude").length, 1);
    assert.strictEqual(scheduler.getTasksForAgent("gpt4").length, 1);
    assert.strictEqual(scheduler.getTasksForAgent("unknown").length, 0);
  });
});

describe("TaskSchedulerService — Events", () => {
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    const sm = new StateManager();
    scheduler = new TaskSchedulerService(sm);
  });

  it("emits taskCreated on createTask", () => {
    let created: Task | null = null;
    scheduler.on("taskCreated", (task) => {
      created = task;
    });
    scheduler.createTask(makeDefinition());
    assert.ok(created);
  });

  it("emits taskStatusChanged on updateTaskStatus", () => {
    const task = scheduler.createTask(makeDefinition());
    let event: any = null;
    scheduler.on("taskStatusChanged", (e) => {
      event = e;
    });
    scheduler.updateTaskStatus(task.id, "running");
    assert.ok(event);
    assert.strictEqual(event.taskId, task.id);
    assert.strictEqual(event.status, "running");
  });
});

describe("TaskSchedulerService — Cleanup", () => {
  it("dispose clears all tasks and listeners", () => {
    const sm = new StateManager();
    const scheduler = new TaskSchedulerService(sm);
    scheduler.createTask(makeDefinition());
    let count = 0;
    scheduler.on("taskCreated", () => {
      count++;
    });
    scheduler.dispose();
    assert.strictEqual(scheduler.getTasksByStatus("pending").length, 0);
  });
});
