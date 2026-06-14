// ============================================================================
// MeshOrchestrator — P2P mesh team lifecycle and message routing
//
// refs: docs/p2p-mesh-design.md Section 9
// ============================================================================

import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type {
  MeshTeam,
  P2PMessage,
  TaskBoard,
  TaskEntry,
  MeshError,
  MeshErrorType,
  SendTarget,
  MultiSendResult,
  UserMessagePayload,
  MeshAgentStatus,
} from "../models/mesh";
import { MessageBus } from "./message-bus";
import { FileLockManager } from "./file-lock-manager";
import { TaskBoardStore } from "./task-board-store";
import { FanoutExecutor } from "./fanout-executor";
import { PipelineExecutor } from "./pipeline-executor";
import { SupervisorManager } from "./supervisor-manager";
import {
  parseMeshMarkers,
  serializeToMarker,
} from "../../shared/util/mesh-marker-parser";
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh");

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export interface MeshOrchestratorDeps {
  sessionOrchestrator: SessionOrchestrator;
  messageBus: MessageBus;
  fileLockManager: FileLockManager;
  taskBoardStore: TaskBoardStore;
}

// ----------------------------------------------------------------------------
// MeshOrchestrator
// ----------------------------------------------------------------------------

export class MeshOrchestrator {
  private sessionOrchestrator: SessionOrchestrator;
  private messageBus: MessageBus;
  private fileLockManager: FileLockManager;
  private taskBoardStore: TaskBoardStore;
  private fanoutExecutor: FanoutExecutor;
  private pipelineExecutor: PipelineExecutor;
  private supervisorManager: SupervisorManager;
  // teamId → MeshTeam
  private teams: Map<string, MeshTeam> = new Map();
  // agentId → unsubscribe function
  private agentSubscriptions: Map<string, () => void> = new Map();

  constructor(deps: MeshOrchestratorDeps) {
    this.sessionOrchestrator = deps.sessionOrchestrator;
    this.messageBus = deps.messageBus;
    this.fileLockManager = deps.fileLockManager;
    this.taskBoardStore = deps.taskBoardStore;
    this.fanoutExecutor = new FanoutExecutor({
      sessionOrchestrator: deps.sessionOrchestrator,
    });
    this.pipelineExecutor = new PipelineExecutor({
      sessionOrchestrator: deps.sessionOrchestrator,
    });
    this.supervisorManager = new SupervisorManager({
      sessionOrchestrator: deps.sessionOrchestrator,
      taskBoardStore: deps.taskBoardStore,
      fileLockManager: deps.fileLockManager,
    });
  }

  // -----------------------------------------------------------------------
  // Team Lifecycle
  // -----------------------------------------------------------------------

  async startTeam(config: {
    id: string;
    name: string;
    description: string;
    leadAgentId: string;
    memberAgentIds: string[];
  }): Promise<MeshTeam> {
    const team: MeshTeam = {
      id: config.id,
      name: config.name,
      description: config.description,
      leadAgentId: config.leadAgentId,
      memberAgentIds: config.memberAgentIds,
      taskBoardPath: `.acp-mesh/${config.id}/taskboard.json`,
      createdAt: new Date(),
      status: "active",
    };

    this.teams.set(team.id, team);
    this.taskBoardStore.create(team.taskBoardPath);

    // Register message handlers for each member agent
    for (const agentId of config.memberAgentIds) {
      this.registerAgent(agentId, team.id);
    }

    return team;
  }

  async stopTeam(teamId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) return;

    // Release all file locks for team members
    for (const agentId of team.memberAgentIds) {
      await this.fileLockManager.releaseAll(agentId);
      // Unsubscribe agent from message bus
      const unsub = this.agentSubscriptions.get(agentId);
      if (unsub) {
        unsub();
        this.agentSubscriptions.delete(agentId);
      }
    }

    team.status = "completed";
  }

  getTeam(teamId: string): MeshTeam | undefined {
    return this.teams.get(teamId);
  }

  getAllTeams(): MeshTeam[] {
    return Array.from(this.teams.values());
  }

  // -----------------------------------------------------------------------
  // Agent Registration
  // -----------------------------------------------------------------------

  private registerAgent(agentId: string, _teamId: string): void {
    // Subscribe agent to message bus for receiving P2P messages
    const unsub = this.messageBus.subscribe(agentId, async (message) => {
      await this.forwardToAgent(agentId, message);
    });
    this.agentSubscriptions.set(agentId, unsub);
  }

  // -----------------------------------------------------------------------
  // Message Forwarding
  // -----------------------------------------------------------------------

  private async forwardToAgent(
    targetAgentId: string,
    message: P2PMessage
  ): Promise<void> {
    // Find an active session for the target agent
    const sessionId =
      this.sessionOrchestrator.getActiveSessionId(targetAgentId);
    if (!sessionId) {
      // Agent has no active session — nothing to forward to
      return;
    }

    const markerMessage = serializeToMarker(message, "2");
    // Inject v2 marker into the agent's session via prompt
    // The agent will parse the marker and act on the P2P message
    try {
      await this.sessionOrchestrator.prompt(
        targetAgentId,
        sessionId,
        markerMessage
      );
    } catch (e) {
      log.error("failed to forward P2P message to agent", {
        targetAgentId,
        sessionId,
      }, e as Error);
    }
  }

  // -----------------------------------------------------------------------
  // Agent Output Processing
  // -----------------------------------------------------------------------

  /**
   * Process raw agent output: extract P2P messages from markers and
   * route them through the message bus.
   */
  async processAgentOutput(
    agentId: string,
    rawOutput: string
  ): Promise<string> {
    const { messages, sanitized } = parseMeshMarkers(rawOutput, agentId);

    for (const msg of messages) {
      try {
        await this.messageBus.send(msg);
      } catch (e) {
        log.error("failed to route P2P message", {
          messageId: msg.id,
          from: msg.from,
          to: msg.to,
        }, e as Error);
      }
    }

    return sanitized;
  }

  // -----------------------------------------------------------------------
  // Task Board Operations
  // -----------------------------------------------------------------------

  addTask(
    teamId: string,
    task: Omit<TaskEntry, "createdAt" | "updatedAt">
  ): TaskEntry {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);
    return this.taskBoardStore.addTask(team.taskBoardPath, task);
  }

  getTask(teamId: string, taskId: string): TaskEntry | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    return this.taskBoardStore.getTask(team.taskBoardPath, taskId);
  }

  updateTask(
    teamId: string,
    taskId: string,
    updates: Partial<
      Pick<TaskEntry, "status" | "assignedTo" | "result" | "metadata">
    >
  ): TaskEntry | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    return this.taskBoardStore.updateTask(team.taskBoardPath, taskId, updates);
  }

  getTaskBoard(teamId: string): TaskBoard | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    return this.taskBoardStore.load(team.taskBoardPath);
  }

  getCycles(teamId: string): string[][] {
    const team = this.teams.get(teamId);
    if (!team) return [];
    return this.taskBoardStore.findCycles(team.taskBoardPath);
  }

  // -----------------------------------------------------------------------
  // Error Handling & Recovery
  // -----------------------------------------------------------------------

  async handleAgentDisconnect(agentId: string): Promise<void> {
    // Find teams this agent belongs to
    for (const [, team] of this.teams) {
      if (!team.memberAgentIds.includes(agentId)) continue;

      // Reassign orphaned tasks
      const tasks = this.taskBoardStore.getTasksByAgent(
        team.taskBoardPath,
        agentId
      );
      for (const task of tasks) {
        if (task.status === "in_progress" || task.status === "assigned") {
          this.taskBoardStore.updateTask(team.taskBoardPath, task.id, {
            status: "pending",
            assignedTo: undefined,
          });
        }
      }

      // Notify lead agent
      await this.messageBus.send({
        id: crypto.randomUUID(),
        type: "status_update",
        from: "orchestrator",
        to: team.leadAgentId,
        timestamp: new Date(),
        payload: {
          agentId,
          status: "error",
          event: "agent_disconnected",
          affectedTasks: tasks.map((t) => t.id),
        },
      });
    }

    // Release file locks
    await this.fileLockManager.releaseAll(agentId);

    // Unsubscribe from message bus
    const unsub = this.agentSubscriptions.get(agentId);
    if (unsub) {
      unsub();
      this.agentSubscriptions.delete(agentId);
    }
  }

  createError(
    type: MeshErrorType,
    description: string,
    agentId?: string,
    messageId?: string
  ): MeshError {
    return {
      type,
      description,
      agentId,
      messageId,
      timestamp: new Date(),
    };
  }

  // -----------------------------------------------------------------------
  // Direct Messaging (MCP tools)
  // -----------------------------------------------------------------------

  async handoff(
    fromAgentId: string,
    toAgentId: string,
    task: string,
    context?: string,
    _timeoutSec?: number
  ): Promise<void> {
    const message: P2PMessage = {
      id: crypto.randomUUID(),
      type: "task_request",
      from: fromAgentId,
      to: toAgentId,
      timestamp: new Date(),
      payload: {
        taskId: crypto.randomUUID(),
        title: task,
        description: `${task}${context ? `\n\nContext: ${context}` : ""}`,
        priority: "normal",
      },
    };
    // Note: TTL-based timeout handled by MessageBus queue expiration
    await this.messageBus.send(message);
  }

  async sendMessage(
    fromAgentId: string,
    toAgentId: string,
    content: string,
    priority: "low" | "normal" | "high" | "urgent" = "normal"
  ): Promise<void> {
    const message: P2PMessage = {
      id: crypto.randomUUID(),
      type: "question",
      from: fromAgentId,
      to: toAgentId,
      timestamp: new Date(),
      payload: { question: content },
      metadata: { priority },
    };
    await this.messageBus.send(message);
  }

  // -----------------------------------------------------------------------
  // Multi-Agent Communication (Phase 1 — Foundation)
  // -----------------------------------------------------------------------

  /**
   * Send a message to multiple targets in parallel (multi-@ direct mode).
   * Each target is a (agentId, sessionId) pair.
   * Returns results for each target without waiting for agent responses.
   */
  async directMultiSend(
    targets: SendTarget[],
    text: string,
    attachments?: unknown[]
  ): Promise<MultiSendResult> {
    const payload: UserMessagePayload = {
      text,
      attachments: attachments ?? [],
      priority: "normal",
    };
    return this.fanoutExecutor.execute(targets, payload);
  }

  /**
   * Fanout: send a message to all active sessions of the given agent IDs.
   * Resolves agentId → active session, then sends in parallel.
   */
  async fanout(
    agentIds: string[],
    text: string,
    attachments?: unknown[]
  ): Promise<MultiSendResult> {
    const targets: SendTarget[] = [];
    for (const agentId of agentIds) {
      const sessionId = this.sessionOrchestrator.getActiveSessionId(agentId);
      if (!sessionId) continue;
      const config = this.sessionOrchestrator.getAgentConfig(agentId);
      targets.push({
        agentId,
        sessionId,
        label: config?.name ?? agentId,
        status: "idle",
      });
    }

    if (targets.length === 0) {
      return { results: [] };
    }

    const payload: UserMessagePayload = {
      text,
      attachments: attachments ?? [],
      priority: "normal",
    };
    return this.fanoutExecutor.execute(targets, payload);
  }

  /**
   * Pipeline: send a message sequentially through a chain of targets.
   * Each agent receives the same text. Future: transform output between stages.
   */
  async pipelineSend(
    targets: SendTarget[],
    text: string
  ): Promise<{ success: boolean; steps: Array<{ target: SendTarget; status: string; error?: string }> }> {
    return this.pipelineExecutor.execute(targets, text);
  }

  /**
   * Supervisor pattern: send task to lead agent, then distribute to workers.
   *
   * @param teamId       Team ID for TaskBoard path resolution
   * @param leadTarget   Lead agent target
   * @param workerTargets Worker agent targets
   * @param task         Task description
   * @param waitForAll   If true, wait for all workers before returning
   * @param leadOutput   Optional raw lead agent output containing v2 markers
   *                     for automatic sub-task decomposition
   * @param maxRetries   Max retry count per worker (default: 0)
   * @param lockFiles    Files to lock during worker execution
   */
  async supervise(
    teamId: string,
    leadTarget: SendTarget,
    workerTargets: SendTarget[],
    task: string,
    waitForAll = false,
    leadOutput?: string,
    maxRetries?: number,
    lockFiles?: string[]
  ): Promise<{
    assignments: Array<{ workerTarget: SendTarget; status: string }>;
    completedCount: number;
    failedCount: number;
    parentTaskId?: string;
  }> {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    return this.supervisorManager.supervise(
      {
        leadTarget,
        workerTargets,
        task,
        waitForAll,
        taskBoardPath: team.taskBoardPath,
        maxRetries,
        lockFiles,
      },
      leadOutput
    );
  }

  /**
   * Get agent statuses for MeshPanel display.
   * Returns runtime status of all registered agents including active sessions.
   */
  getAgentStatuses(): MeshAgentStatus[] {
    const statuses: MeshAgentStatus[] = [];
    const agentIds = new Set<string>();

    // Collect agent IDs from teams
    for (const team of this.teams.values()) {
      agentIds.add(team.leadAgentId);
      for (const id of team.memberAgentIds) {
        agentIds.add(id);
      }
    }

    for (const agentId of agentIds) {
      let state: MeshAgentStatus["state"] = "disconnected";
      const sessions: MeshAgentStatus["sessions"] = [];

      // Check if agent has an active connection via SessionOrchestrator
      const allSessions = this.sessionOrchestrator.getSessionsForAgent(agentId);
      if (allSessions.length > 0) {
        const hasRunning = allSessions.some((s) => s.status === "running");
        state = hasRunning ? "working" : "idle";

        for (const s of allSessions) {
          sessions.push({
            sessionId: s.sessionId,
            title: s.title,
            status: s.status,
          });
        }

        // Find active session for current task info
        const activeSessionId = this.sessionOrchestrator.getActiveSessionId(agentId);
        const activeInfo = allSessions.find((s) => s.sessionId === activeSessionId);
        if (activeInfo && activeInfo.status === "running") {
          // Estimate progress from token usage
          const progress = activeInfo.contextWindowMax
            ? Math.min(95, Math.round((activeInfo.tokenUsage.total / activeInfo.contextWindowMax) * 100))
            : undefined;

          statuses.push({
            agentId,
            state: "working",
            sessions,
            currentTask: activeInfo.title,
            progress,
          });
          continue;
        }
      }

      statuses.push({ agentId, state, sessions });
    }

    return statuses;
  }

  /**
   * Get recent message bus log entries.
   */
  getRecentMessages(limit: number): Array<{
    messageId: string;
    type: string;
    from: string;
    to: string;
    timestamp: Date;
    summary: string;
  }> {
    return this.messageBus.getLog().slice(-limit);
  }

  // -----------------------------------------------------------------------
  // Teardown
  // -----------------------------------------------------------------------

  dispose(): void {
    for (const [, unsub] of this.agentSubscriptions) {
      unsub();
    }
    this.agentSubscriptions.clear();
    this.teams.clear();
  }
}
