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
import { FanoutExecutor, type FanoutExecutorDeps } from "./fanout-executor";
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
  /** Callback to push user message into the target session chat UI */
  pushUserMessage?: FanoutExecutorDeps["pushUserMessage"];
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
      pushUserMessage: deps.pushUserMessage ?? (() => {}),
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

    for (const agentId of config.memberAgentIds) {
      this.registerAgent(agentId, team.id);
    }

    log.info("team started", {
      teamId: team.id,
      name: team.name,
      leadAgentId: team.leadAgentId,
      memberCount: team.memberAgentIds.length,
    });
    return team;
  }

  async stopTeam(teamId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      log.warn("stopTeam: team not found", { teamId });
      return;
    }

    log.info("stopping team", { teamId, name: team.name });

    for (const agentId of team.memberAgentIds) {
      await this.fileLockManager.releaseAll(agentId);
      const unsub = this.agentSubscriptions.get(agentId);
      if (unsub) {
        unsub();
        this.agentSubscriptions.delete(agentId);
      }
    }

    team.status = "completed";
    log.info("team stopped", { teamId });
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

  private registerAgent(agentId: string, teamId: string): void {
    const unsub = this.messageBus.subscribe(agentId, async (message) => {
      await this.forwardToAgent(agentId, message);
    });
    this.agentSubscriptions.set(agentId, unsub);
    log.debug("agent registered", { agentId, teamId });
  }

  // -----------------------------------------------------------------------
  // Message Forwarding
  // -----------------------------------------------------------------------

  private async forwardToAgent(
    targetAgentId: string,
    message: P2PMessage
  ): Promise<void> {
    const sessionId =
      this.sessionOrchestrator.getActiveSessionId(targetAgentId);
    if (!sessionId) {
      log.debug("forwardToAgent: no active session", { targetAgentId });
      return;
    }

    const markerMessage = serializeToMarker(message, "2");
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

    if (messages.length > 0) {
      log.debug("P2P messages extracted from agent output", {
        agentId,
        count: messages.length,
      });
    }

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
    log.warn("agent disconnected", { agentId });

    for (const [, team] of this.teams) {
      if (!team.memberAgentIds.includes(agentId)) continue;

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

    await this.fileLockManager.releaseAll(agentId);

    const unsub = this.agentSubscriptions.get(agentId);
    if (unsub) {
      unsub();
      this.agentSubscriptions.delete(agentId);
    }

    log.info("agent disconnect handled", { agentId });
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
    log.info("handoff", { from: fromAgentId, to: toAgentId });
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
    await this.messageBus.send(message);
  }

  async sendMessage(
    fromAgentId: string,
    toAgentId: string,
    content: string,
    priority: "low" | "normal" | "high" | "urgent" = "normal"
  ): Promise<void> {
    log.info("sendMessage", { from: fromAgentId, to: toAgentId, priority });
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
    log.info("directMultiSend", { targetCount: targets.length });
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
      log.warn("fanout: no active sessions found", { requestedAgentIds: agentIds });
      return { results: [] };
    }

    log.info("fanout", { agentCount: agentIds.length, resolvedTargetCount: targets.length });
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
    log.info("pipelineSend", { targetCount: targets.length });
    return this.pipelineExecutor.execute(targets, text);
  }

  /**
   * Supervisor pattern: send task to lead agent, then distribute to workers.
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

    log.info("supervise", {
      teamId,
      leadAgentId: leadTarget.agentId,
      workerCount: workerTargets.length,
    });
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
   */
  getAgentStatuses(): MeshAgentStatus[] {
    const statuses: MeshAgentStatus[] = [];
    const agentIds = new Set<string>();

    for (const team of this.teams.values()) {
      agentIds.add(team.leadAgentId);
      for (const id of team.memberAgentIds) {
        agentIds.add(id);
      }
    }

    for (const agentId of agentIds) {
      let state: MeshAgentStatus["state"] = "disconnected";
      const sessions: MeshAgentStatus["sessions"] = [];

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

        const activeSessionId = this.sessionOrchestrator.getActiveSessionId(agentId);
        const activeInfo = allSessions.find((s) => s.sessionId === activeSessionId);
        if (activeInfo && activeInfo.status === "running") {
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
