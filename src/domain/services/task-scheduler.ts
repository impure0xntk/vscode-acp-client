// ============================================================================
// Task Scheduler — task lifecycle and dependency resolution
// ============================================================================

import { EventEmitter } from "events";
import type { Task, TaskDefinition, TaskStatus } from "../models/task";
import { StateManager } from "./state-manager";

// ============================================================================
// Task Scheduler Service
// ============================================================================

export class TaskSchedulerService extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    super();
    this.stateManager = stateManager;
  }

  // ========================================================================
  // Task CRUD
  // ========================================================================

  createTask(definition: TaskDefinition): Task {
    const now = new Date();
    const task: Task = {
      id: `task-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      type: definition.type,
      status: "pending",
      assignedAgentId: definition.assignedAgentId,
      input: definition.input,
      subtasks: [],
      dependencies: definition.dependencies ?? [],
      createdAt: now,
    };

    this.tasks.set(task.id, task);

    const event = this.stateManager.createEvent("task.created", {
      taskId: task.id,
      type: task.type,
      assignedAgentId: task.assignedAgentId,
    });
    this.stateManager.applyEvent(event);
    this.emit("taskCreated", task);

    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = status;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      task.completedAt = new Date();
    }

    const event = this.stateManager.createEvent("task.status_changed", {
      taskId,
      status,
    });
    this.stateManager.applyEvent(event);
    this.emit("taskStatusChanged", { taskId, status });
  }

  // ========================================================================
  // Scheduling
  // ========================================================================

  async schedule(task: Task): Promise<void> {
    const unresolved = this.resolveDependencies(task.id);
    if (unresolved.length > 0) {
      throw new Error(
        `Task ${task.id} has unresolved dependencies: ${unresolved.map((t) => t.id).join(", ")}`
      );
    }

    this.updateTaskStatus(task.id, "running");
  }

  cancel(taskId: string): void {
    this.updateTaskStatus(taskId, "cancelled");
  }

  // ========================================================================
  // Dependency Resolution
  // ========================================================================

  resolveDependencies(taskId: string): Task[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];

    const unresolved: Task[] = [];
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.status !== "completed") {
        unresolved.push(
          dep ?? {
            id: depId,
            type: "single_agent",
            status: "pending",
            assignedAgentId: "",
            input: undefined,
            subtasks: [],
            dependencies: [],
            createdAt: new Date(),
          }
        );
      }
    }
    return unresolved;
  }

  // ========================================================================
  // Pipeline Execution
  // ========================================================================

  /**
   * Execute tasks sequentially. Each task's output becomes the next task's input.
   * Stops on first failure.
   */
  async executePipeline(
    taskIds: string[],
    executeFn: (task: Task) => Promise<unknown>
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let previousOutput: unknown = undefined;

    for (const taskId of taskIds) {
      const task = this.tasks.get(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Inject previous output as input if available
      if (previousOutput !== undefined) {
        task.input = previousOutput;
      }

      await this.schedule(task);

      try {
        const output = await executeFn(task);
        task.output = output;
        this.updateTaskStatus(taskId, "completed");
        previousOutput = output;
        results.push(output);
      } catch (err) {
        this.updateTaskStatus(taskId, "failed");
        throw err;
      }
    }

    return results;
  }

  /**
   * Execute tasks in parallel. All tasks run concurrently.
   * Fails fast on first failure.
   */
  async executeParallel(
    taskIds: string[],
    executeFn: (task: Task) => Promise<unknown>
  ): Promise<unknown[]> {
    const tasks: Task[] = [];

    for (const taskId of taskIds) {
      const task = this.tasks.get(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }
      tasks.push(task);
    }

    // Schedule all tasks
    for (const task of tasks) {
      await this.schedule(task);
    }

    // Execute all in parallel
    const results = await Promise.allSettled(tasks.map((t) => executeFn(t)));

    // Check for failures
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      // Mark all as failed
      for (const task of tasks) {
        this.updateTaskStatus(task.id, "failed");
      }
      throw new Error(
        `${failures.length} task(s) failed in parallel execution`
      );
    }

    // Mark all as completed
    const outputs: unknown[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const result = results[i] as PromiseFulfilledResult<unknown>;
      tasks[i].output = result.value;
      this.updateTaskStatus(tasks[i].id, "completed");
      outputs.push(result.value);
    }

    return outputs;
  }

  // ========================================================================
  // Listing
  // ========================================================================

  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  getTasksForAgent(agentId: string): Task[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.assignedAgentId === agentId
    );
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    this.tasks.clear();
    this.removeAllListeners();
  }
}
