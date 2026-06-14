// ============================================================================
// TaskBoardStore — JSON-file backed shared task board
//
// refs: docs/p2p-mesh-design.md Section 4.1
// ============================================================================

import type {
  TaskBoard,
  TaskEntry,
  MeshTaskStatus,
  FileLockEntry,
  MessageLogEntry,
} from "../models/mesh";
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh.taskboard");

// ----------------------------------------------------------------------------
// TaskBoardStore
// ----------------------------------------------------------------------------

export class TaskBoardStore {
  // In-memory cache: path → TaskBoard
  private cache: Map<string, TaskBoard> = new Map();

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  create(path: string): TaskBoard {
    const now = new Date();
    const board: TaskBoard = {
      version: "1.0",
      teamId: path,
      createdAt: now,
      updatedAt: now,
      tasks: [],
      fileLocks: [],
      messageLog: [],
    };
    this.cache.set(path, board);
    log.info("task board created", { path });
    return board;
  }

  load(path: string): TaskBoard | undefined {
    return this.cache.get(path);
  }

  async save(path: string): Promise<void> {
    const board = this.cache.get(path);
    if (board) {
      board.updatedAt = new Date();
    }
  }

  // -----------------------------------------------------------------------
  // Task CRUD
  // -----------------------------------------------------------------------

  addTask(
    path: string,
    task: Omit<TaskEntry, "createdAt" | "updatedAt">
  ): TaskEntry {
    const board = this.getBoard(path);
    const now = new Date();
    const entry: TaskEntry = { ...task, createdAt: now, updatedAt: now };
    board.tasks.push(entry);
    board.updatedAt = now;
    log.debug("task added", { path, taskId: task.id, status: task.status });
    return entry;
  }

  getTask(path: string, taskId: string): TaskEntry | undefined {
    const board = this.cache.get(path);
    return board?.tasks.find((t) => t.id === taskId);
  }

  updateTask(
    path: string,
    taskId: string,
    updates: Partial<
      Pick<TaskEntry, "status" | "assignedTo" | "result" | "metadata">
    >
  ): TaskEntry | undefined {
    const board = this.cache.get(path);
    if (!board) return undefined;

    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) return undefined;

    Object.assign(task, updates, { updatedAt: new Date() });
    board.updatedAt = task.updatedAt;
    log.debug("task updated", { path, taskId, status: task.status });
    return task;
  }

  getTasksByAgent(path: string, agentId: string): TaskEntry[] {
    const board = this.cache.get(path);
    if (!board) return [];
    return board.tasks.filter((t) => t.assignedTo === agentId);
  }

  getTasksByStatus(path: string, status: MeshTaskStatus): TaskEntry[] {
    const board = this.cache.get(path);
    if (!board) return [];
    return board.tasks.filter((t) => t.status === status);
  }

  getAllTasks(path: string): TaskEntry[] {
    return this.cache.get(path)?.tasks ?? [];
  }

  // -----------------------------------------------------------------------
  // File lock mirror (authoritative lock lives in FileLockManager;
  // this is a read-only mirror for the task board JSON)
  // -----------------------------------------------------------------------

  setFileLocks(path: string, locks: FileLockEntry[]): void {
    const board = this.getBoard(path);
    board.fileLocks = locks;
    board.updatedAt = new Date();
  }

  // -----------------------------------------------------------------------
  // Message log
  // -----------------------------------------------------------------------

  appendMessageLog(path: string, entry: MessageLogEntry): void {
    const board = this.getBoard(path);
    board.messageLog.push(entry);
    board.updatedAt = new Date();
  }

  getMessageLog(path: string): MessageLogEntry[] {
    return this.cache.get(path)?.messageLog ?? [];
  }

  // -----------------------------------------------------------------------
  // Dependency helpers
  // -----------------------------------------------------------------------

  /** Return task IDs that have unresolved dependencies */
  getUnresolvedDependencies(path: string, taskId: string): string[] {
    const task = this.getTask(path, taskId);
    if (!task) return [];
    const completed = new Set(
      this.getTasksByStatus(path, "completed").map((t) => t.id)
    );
    return task.dependsOn.filter((depId) => !completed.has(depId));
  }

  /** Detect circular dependencies — returns cycles as arrays of task IDs */
  findCycles(path: string): string[][] {
    const tasks = this.getAllTasks(path);
    const adj = new Map<string, string[]>();
    for (const t of tasks) {
      adj.set(t.id, t.dependsOn);
    }

    const visited = new Set<string>();
    const stack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (node: string, path: string[]) => {
      if (stack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart).concat(node));
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);

      for (const dep of adj.get(node) ?? []) {
        dfs(dep, [...path, node]);
      }

      stack.delete(node);
    };

    for (const t of tasks) {
      if (!visited.has(t.id)) {
        dfs(t.id, []);
      }
    }

    return cycles;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private getBoard(path: string): TaskBoard {
    const board = this.cache.get(path);
    if (!board) throw new Error(`TaskBoard not found: ${path}`);
    return board;
  }

  // -----------------------------------------------------------------------
  // Teardown
  // -----------------------------------------------------------------------

  dispose(): void {
    this.cache.clear();
  }
}
