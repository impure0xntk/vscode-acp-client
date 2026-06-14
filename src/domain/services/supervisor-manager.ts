// ============================================================================
// SupervisorManager — lead/worker task decomposition
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4
// ============================================================================

import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget } from "../models/mesh";
import type { TaskBoardStore } from "./task-board-store";
import type { FileLockManager } from "./file-lock-manager";
import { parseMeshMarkers } from "../../shared/util/mesh-marker-parser";

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export interface SupervisorManagerDeps {
  sessionOrchestrator: SessionOrchestrator;
  taskBoardStore: TaskBoardStore;
  fileLockManager?: FileLockManager;
}

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export interface SupervisorConfig {
  leadTarget: SendTarget;
  workerTargets: SendTarget[];
  task: string;
  /** If true, wait for all worker sends before returning */
  waitForAll?: boolean;
  /** If set, sync tasks with TaskBoardStore */
  taskBoardPath?: string;
  /** Max retry count for failed worker assignments (default: 0) */
  maxRetries?: number;
  /** Files to lock before worker execution (releases on completion) */
  lockFiles?: string[];
}

// ----------------------------------------------------------------------------
// Result types
// ----------------------------------------------------------------------------

export interface WorkerAssignment {
  workerTarget: SendTarget;
  subTask: string;
  status: "pending" | "assigned" | "running" | "completed" | "failed";
  taskId?: string;
}

export interface SupervisorResult {
  assignments: WorkerAssignment[];
  /** Workers that completed */
  completedCount: number;
  /** Workers that failed */
  failedCount: number;
  /** Parent task ID if taskBoardPath was provided */
  parentTaskId?: string;
}

// ----------------------------------------------------------------------------
// SupervisorManager
// ----------------------------------------------------------------------------

export class SupervisorManager {
  private sessionOrchestrator: SessionOrchestrator;
  private taskBoardStore: TaskBoardStore;
  private fileLockManager?: FileLockManager;

  constructor(deps: SupervisorManagerDeps) {
    this.sessionOrchestrator = deps.sessionOrchestrator;
    this.taskBoardStore = deps.taskBoardStore;
    this.fileLockManager = deps.fileLockManager;
  }

  /**
   * Start supervisor pattern:
   * 1. Send task to lead agent
   * 2. (Optional) Parse lead output for v2 markers to extract sub-tasks
   * 3. Distribute sub-tasks to worker agents in parallel
   * 4. Retry failed assignments up to maxRetries
   * 5. Return assignments for tracking
   *
   * Features:
   * - TaskBoard sync when taskBoardPath is set
   * - File locking when lockFiles + fileLockManager are set
   * - Automatic retry on worker failure
   * - Lead output decomposition via v2 markers
   */
  async supervise(
    config: SupervisorConfig,
    leadOutput?: string
  ): Promise<SupervisorResult> {
    const maxRetries = config.maxRetries ?? 0;
    const assignments: WorkerAssignment[] = config.workerTargets.map(
      (wt) => ({
        workerTarget: wt,
        subTask: config.task,
        status: "pending" as const,
      })
    );

    // Phase 2: Parse lead output for v2 markers to extract sub-tasks
    if (leadOutput) {
      this.decomposeFromLeadOutput(assignments, leadOutput, config.leadTarget.agentId);
    }

    // Create parent task if taskBoardPath is provided
    let parentTaskId: string | undefined;
    if (config.taskBoardPath) {
      // Ensure the board exists (create if not already)
      if (!this.taskBoardStore.load(config.taskBoardPath)) {
        this.taskBoardStore.create(config.taskBoardPath);
      }
      parentTaskId = this.createTaskBoardEntries(config, assignments);
    }

    // Acquire file locks if specified
    if (config.lockFiles && this.fileLockManager) {
      for (const filePath of config.lockFiles) {
        const acquired = await this.fileLockManager.acquire(
          filePath,
          config.leadTarget.agentId,
          "write"
        );
        if (!acquired) {
          throw new Error(`Failed to acquire file lock: ${filePath}`);
        }
      }
    }

    // Send task to lead agent first
    try {
      await this.sessionOrchestrator.prompt(
        config.leadTarget.agentId,
        config.leadTarget.sessionId,
        config.task
      );
    } catch (e) {
      if (config.taskBoardPath && parentTaskId) {
        this.failAllSubTasks(config.taskBoardPath, parentTaskId, assignments);
      }
      this.releaseLocks(config);
      return {
        assignments: assignments.map((a) => ({
          ...a,
          status: "failed" as const,
        })),
        completedCount: 0,
        failedCount: assignments.length,
        parentTaskId,
      };
    }

    // Phase 3: Distribute to workers with retry support
    await this.executeWorkers(config, assignments, maxRetries);

    // Update parent task status
    if (config.taskBoardPath && parentTaskId) {
      this.updateParentTaskStatus(config.taskBoardPath, parentTaskId, assignments);
    }

    // Release file locks
    this.releaseLocks(config);

    const completedCount = assignments.filter(
      (a) => a.status === "completed"
    ).length;
    const failedCount = assignments.filter(
      (a) => a.status === "failed"
    ).length;

    return { assignments, completedCount, failedCount, parentTaskId };
  }

  // -----------------------------------------------------------------------
  // Lead output decomposition (v2 markers)
  // -----------------------------------------------------------------------

  /**
   * Parse lead agent output for v2 task_delegate markers and update
   * worker assignments with extracted sub-tasks.
   */
  private decomposeFromLeadOutput(
    assignments: WorkerAssignment[],
    leadOutput: string,
    leadAgentId: string
  ): void {
    const { messages } = parseMeshMarkers(leadOutput, leadAgentId);

    for (const msg of messages) {
      if (msg.type !== "task_delegate") continue;
      const payload = msg.payload as { agentIndex?: number; description?: string } | undefined;
      if (!payload) continue;

      const idx = payload.agentIndex;
      if (typeof idx === "number" && idx >= 0 && idx < assignments.length) {
        assignments[idx].subTask = payload.description ?? assignments[idx].subTask;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Task board helpers
  // -----------------------------------------------------------------------

  private createTaskBoardEntries(
    config: SupervisorConfig,
    assignments: WorkerAssignment[]
  ): string {
    const path = config.taskBoardPath!;
    const parentTask = this.taskBoardStore.addTask(path, {
      id: crypto.randomUUID(),
      title: config.task.substring(0, 50),
      description: config.task,
      status: "in_progress",
      createdBy: config.leadTarget.agentId,
      dependsOn: [],
      subtasks: [],
    });

    for (const assignment of assignments) {
      const subTask = this.taskBoardStore.addTask(path, {
        id: crypto.randomUUID(),
        title: `Worker: ${assignment.workerTarget.label}`,
        description: assignment.subTask,
        status: "pending",
        assignedTo: assignment.workerTarget.agentId,
        createdBy: config.leadTarget.agentId,
        dependsOn: [parentTask.id],
        subtasks: [],
      });
      assignment.taskId = subTask.id;
      parentTask.subtasks.push(subTask.id);
    }

    return parentTask.id;
  }

  private failAllSubTasks(
    path: string,
    parentTaskId: string,
    assignments: WorkerAssignment[]
  ): void {
    for (const assignment of assignments) {
      if (assignment.taskId) {
        this.taskBoardStore.updateTask(path, assignment.taskId, { status: "failed" });
      }
    }
    this.taskBoardStore.updateTask(path, parentTaskId, { status: "failed" });
  }

  private updateParentTaskStatus(
    path: string,
    parentTaskId: string,
    assignments: WorkerAssignment[]
  ): void {
    const failedCount = assignments.filter((a) => a.status === "failed").length;
    const completedCount = assignments.filter((a) => a.status === "completed").length;
    const parentStatus = failedCount === 0 ? "completed" : completedCount === 0 ? "failed" : "completed";
    this.taskBoardStore.updateTask(path, parentTaskId, { status: parentStatus });
  }

  // -----------------------------------------------------------------------
  // Worker execution with retry
  // -----------------------------------------------------------------------

  private async executeWorkers(
    config: SupervisorConfig,
    assignments: WorkerAssignment[],
    maxRetries: number
  ): Promise<void> {
    const runWorker = async (assignment: WorkerAssignment): Promise<void> => {
      let attempts = 0;
      const maxAttempts = 1 + maxRetries;

      while (attempts < maxAttempts) {
        attempts++;
        assignment.status = "running";

        if (config.taskBoardPath && assignment.taskId) {
          this.taskBoardStore.updateTask(
            config.taskBoardPath,
            assignment.taskId,
            { status: "in_progress" }
          );
        }

        try {
          await this.sessionOrchestrator.prompt(
            assignment.workerTarget.agentId,
            assignment.workerTarget.sessionId,
            assignment.subTask
          );
          assignment.status = "completed";
          if (config.taskBoardPath && assignment.taskId) {
            this.taskBoardStore.updateTask(
              config.taskBoardPath,
              assignment.taskId,
              { status: "completed" }
            );
          }
          return;
        } catch {
          if (attempts >= maxAttempts) {
            assignment.status = "failed";
            if (config.taskBoardPath && assignment.taskId) {
              this.taskBoardStore.updateTask(
                config.taskBoardPath,
                assignment.taskId,
                { status: "failed" }
              );
            }
          }
          // Otherwise retry on next iteration
        }
      }
    };

    if (config.waitForAll) {
      await Promise.all(assignments.map(runWorker));
    } else {
      for (const assignment of assignments) {
        await runWorker(assignment);
      }
    }
  }

  // -----------------------------------------------------------------------
  // File lock cleanup
  // -----------------------------------------------------------------------

  private releaseLocks(config: SupervisorConfig): void {
    if (!config.lockFiles || !this.fileLockManager) return;
    for (const filePath of config.lockFiles) {
      void this.fileLockManager.release(filePath, config.leadTarget.agentId);
    }
  }
}
