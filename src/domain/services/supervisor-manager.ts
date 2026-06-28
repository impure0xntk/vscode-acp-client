import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget } from "../models/mesh";
import type { TaskBoardStore } from "./task-board-store";
import type { FileLockManager } from "./file-lock-manager";
import { parseMeshMarkers } from "../../shared/util/mesh-marker-parser";
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh.supervisor");

export interface SupervisorManagerDeps {
  sessionOrchestrator: SessionOrchestrator;
  taskBoardStore: TaskBoardStore;
  fileLockManager?: FileLockManager;
}

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
   */
  async supervise(
    config: SupervisorConfig,
    leadOutput?: string
  ): Promise<SupervisorResult> {
    const maxRetries = config.maxRetries ?? 0;
    const assignments: WorkerAssignment[] = config.workerTargets.map((wt) => ({
      workerTarget: wt,
      subTask: config.task,
      status: "pending" as const,
    }));

    log.info("supervise start", {
      leadAgentId: config.leadTarget.agentId,
      leadSessionId: config.leadTarget.sessionId,
      workerCount: config.workerTargets.length,
      hasLeadOutput: leadOutput !== undefined,
      maxRetries,
    });

    if (leadOutput) {
      this.decomposeFromLeadOutput(
        assignments,
        leadOutput,
        config.leadTarget.agentId
      );
      log.debug("lead output decomposed", { messageCount: assignments.length });
    }

    let parentTaskId: string | undefined;
    if (config.taskBoardPath) {
      if (!this.taskBoardStore.load(config.taskBoardPath)) {
        this.taskBoardStore.create(config.taskBoardPath);
      }
      parentTaskId = this.createTaskBoardEntries(config, assignments);
    }

    if (config.lockFiles && this.fileLockManager) {
      log.debug("acquiring file locks", { fileCount: config.lockFiles.length });
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

    log.debug("sending task to lead agent", {
      agentId: config.leadTarget.agentId,
      sessionId: config.leadTarget.sessionId,
    });
    try {
      await this.sessionOrchestrator.prompt(
        config.leadTarget.agentId,
        config.leadTarget.sessionId,
        config.task
      );
      log.debug("lead agent task sent");
    } catch (e) {
      log.error(
        "lead agent prompt failed",
        { agentId: config.leadTarget.agentId },
        e as Error
      );
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

    await this.executeWorkers(config, assignments, maxRetries);

    if (config.taskBoardPath && parentTaskId) {
      this.updateParentTaskStatus(
        config.taskBoardPath,
        parentTaskId,
        assignments
      );
    }

    this.releaseLocks(config);

    const completedCount = assignments.filter(
      (a) => a.status === "completed"
    ).length;
    const failedCount = assignments.filter((a) => a.status === "failed").length;

    log.info("supervise complete", {
      completedCount,
      failedCount,
      hasParentTask: parentTaskId !== undefined,
    });
    return { assignments, completedCount, failedCount, parentTaskId };
  }

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
      if (msg.type === "task_delegate") {
        const payload = msg.payload as
          | { agentIndex?: number; description?: string }
          | undefined;
        if (!payload) continue;
        const idx = payload.agentIndex;
        if (typeof idx === "number" && idx >= 0 && idx < assignments.length) {
          assignments[idx].subTask =
            payload.description ?? assignments[idx].subTask;
        }
      }

      if (msg.type === "task_plan") {
        const payload = msg.payload as
          | {
              subtasks?: Array<{ index?: number; description?: string }>;
            }
          | undefined;
        if (!payload?.subtasks) continue;
        for (const sub of payload.subtasks) {
          if (
            typeof sub.index === "number" &&
            sub.index >= 0 &&
            sub.index < assignments.length
          ) {
            assignments[sub.index].subTask =
              sub.description ?? assignments[sub.index].subTask;
          }
        }
      }
    }
  }

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
        this.taskBoardStore.updateTask(path, assignment.taskId, {
          status: "failed",
        });
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
    const completedCount = assignments.filter(
      (a) => a.status === "completed"
    ).length;
    const parentStatus =
      failedCount === 0
        ? "completed"
        : completedCount === 0
          ? "failed"
          : "completed";
    this.taskBoardStore.updateTask(path, parentTaskId, {
      status: parentStatus,
    });
  }

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
        } catch (e) {
          log.warn("worker attempt failed", {
            agentId: assignment.workerTarget.agentId,
            attempt: attempts,
            maxAttempts,
          });
          if (attempts >= maxAttempts) {
            assignment.status = "failed";
            if (config.taskBoardPath && assignment.taskId) {
              this.taskBoardStore.updateTask(
                config.taskBoardPath,
                assignment.taskId,
                { status: "failed" }
              );
            }
            log.error("worker permanently failed", {
              agentId: assignment.workerTarget.agentId,
            });
          }
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

  private releaseLocks(config: SupervisorConfig): void {
    if (!config.lockFiles || !this.fileLockManager) return;
    for (const filePath of config.lockFiles) {
      void this.fileLockManager.release(filePath, config.leadTarget.agentId);
    }
  }
}
