// ============================================================================
// MeshOrchestrator — P2P mesh team lifecycle and message routing
//
// refs: docs/p2p-mesh-design.md Section 9
//
// Design notes:
//   - Owns attachment → ContentBlock conversion (single source of truth).
//   - FanoutExecutor / PipelineExecutor / SupervisorManager receive
//     pre-built PromptContext, no SDK imports in domain layer.
// ============================================================================

import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { PromptContext } from "../../application/session/orchestrator";
import type {
  MeshTeam,
  MeshSessionRef,
  P2PMessage,
  TaskBoard,
  TaskEntry,
  MeshError,
  MeshErrorType,
  SendTarget,
  MultiSendResult,
  MeshAgentStatus,
} from "../models/mesh";
import type { ContextAttachmentDTO } from "../models/chat";
import { attachmentsToContentBlocks } from "../../adapter/context/prompt-context";
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
    lead: MeshSessionRef;
    members: MeshSessionRef[];
  }): Promise<MeshTeam> {
    const team: MeshTeam = {
      id: config.id,
      name: config.name,
      description: config.description,
      lead: config.lead,
      members: config.members,
      taskBoardPath: `.acp-mesh/${config.id}/taskboard.json`,
      createdAt: new Date(),
      status: "active",
    };

    this.teams.set(team.id, team);
    this.taskBoardStore.create(team.taskBoardPath);

    for (const member of config.members) {
      this.registerAgent(member.agentId, team.id);
    }

    log.info("team started", {
      teamId: team.id,
      name: team.name,
      leadAgentId: team.lead.agentId,
      leadSessionId: team.lead.sessionId,
      memberCount: team.members.length,
      memberSessionIds: team.members.map((m) => `${m.agentId}:${m.sessionId}`),
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

    for (const member of team.members) {
      await this.fileLockManager.releaseAll(member.agentId);
      const unsub = this.agentSubscriptions.get(member.agentId);
      if (unsub) {
        unsub();
        this.agentSubscriptions.delete(member.agentId);
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

  /**
   * Add a member session to an existing team.
   * Registers the agent for message bus subscription.
   */
  addMemberToTeam(teamId: string, ref: MeshSessionRef): MeshTeam {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);
    if (
      team.members.some(
        (m) => m.agentId === ref.agentId && m.sessionId === ref.sessionId
      )
    )
      return team;

    team.members = [...team.members, ref];
    this.registerAgent(ref.agentId, teamId);

    log.info("member added to team", {
      teamId,
      agentId: ref.agentId,
      sessionId: ref.sessionId,
    });
    return team;
  }

  /**
   * Remove a member session from a team.
   * Unsubscribes the agent from the message bus and releases file locks.
   */
  async removeMemberFromTeam(
    teamId: string,
    ref: MeshSessionRef
  ): Promise<MeshTeam> {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    team.members = team.members.filter(
      (m) => !(m.agentId === ref.agentId && m.sessionId === ref.sessionId)
    );

    // If the lead is removed, promote the first remaining member
    if (
      team.lead.agentId === ref.agentId &&
      team.lead.sessionId === ref.sessionId
    ) {
      team.lead = team.members[0] ?? { agentId: "", sessionId: "" };
    }

    await this.fileLockManager.releaseAll(ref.agentId);
    const unsub = this.agentSubscriptions.get(ref.agentId);
    if (unsub) {
      unsub();
      this.agentSubscriptions.delete(ref.agentId);
    }

    log.info("member removed from team", {
      teamId,
      agentId: ref.agentId,
      sessionId: ref.sessionId,
    });
    return team;
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
      log.error(
        "failed to forward P2P message to agent",
        {
          targetAgentId,
          sessionId,
        },
        e as Error
      );
    }
  }

  // -----------------------------------------------------------------------
  // Agent Output Processing
  // -----------------------------------------------------------------------

  /**
   * Callback invoked for each extracted P2P message.
   * Enables the extension host to trigger side effects (plan viewer, agent status).
   */
  onExtractedMessage?: (msg: P2PMessage & { agentId: string }) => void;

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
        log.error(
          "failed to route P2P message",
          {
            messageId: msg.id,
            from: msg.from,
            to: msg.to,
          },
          e as Error
        );
      }

      // Notify extension host for plan_update / task_delegate side effects
      if (this.onExtractedMessage) {
        this.onExtractedMessage({ ...msg, agentId });
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
      if (!team.members.some((m) => m.agentId === agentId)) continue;

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
        to: team.lead.agentId,
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
  // Multi-Agent Communication
  // -----------------------------------------------------------------------

  /**
   * Send a message to one or more targets in parallel (mesh:send).
   * Single target = direct 1:1, multiple targets = fanout.
   * Attachments are converted to ACP ContentBlock[] here (single source of truth).
   */
  async meshSend(
    targets: SendTarget[],
    text: string,
    attachments?: ContextAttachmentDTO[]
  ): Promise<MultiSendResult> {
    const targetDesc = targets
      .map((t) => `${t.agentId}:${t.sessionId}`)
      .join(", ");
    log.info("mesh:send", {
      targetCount: targets.length,
      targets: targetDesc,
    });
    const context = this.buildContext(attachments);
    return this.fanoutExecutor.execute(targets, { text, context, attachments });
  }

  /**
   * Fanout: send a message to all active sessions of the given agent IDs.
   */
  async fanout(
    agentIds: string[],
    text: string,
    attachments?: ContextAttachmentDTO[]
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
      log.warn("fanout: no active sessions found", {
        requestedAgentIds: agentIds,
      });
      return { results: [] };
    }

    log.info("fanout", {
      agentCount: agentIds.length,
      resolvedTargetCount: targets.length,
    });
    const context = this.buildContext(attachments);
    return this.fanoutExecutor.execute(targets, { text, context, attachments });
  }

  /**
   * Pipeline: send a message sequentially through a chain of targets.
   */
  async pipelineSend(
    targets: SendTarget[],
    text: string,
    attachments?: ContextAttachmentDTO[]
  ): Promise<{
    success: boolean;
    steps: Array<{ target: SendTarget; status: string; error?: string }>;
  }> {
    log.info("pipelineSend", { targetCount: targets.length });
    const context = this.buildContext(attachments);
    return this.pipelineExecutor.execute(targets, { text, context });
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
      leadSessionId: leadTarget.sessionId,
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

  // -----------------------------------------------------------------------
  // Context builder (single source of truth for attachment → ContentBlock)
  // -----------------------------------------------------------------------

  private buildContext(attachments?: ContextAttachmentDTO[]): PromptContext {
    if (!attachments || attachments.length === 0) return [];
    return attachmentsToContentBlocks(attachments);
  }

  // -----------------------------------------------------------------------
  // Agent Status
  // -----------------------------------------------------------------------

  getAgentStatuses(): MeshAgentStatus[] {
    const statuses: MeshAgentStatus[] = [];
    const agentIds = new Set<string>();

    for (const team of this.teams.values()) {
      agentIds.add(team.lead.agentId);
      for (const member of team.members) {
        agentIds.add(member.agentId);
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

        const activeSessionId =
          this.sessionOrchestrator.getActiveSessionId(agentId);
        const activeInfo = allSessions.find(
          (s) => s.sessionId === activeSessionId
        );
        if (activeInfo && activeInfo.status === "running") {
          const progress = activeInfo.contextWindowMax
            ? Math.min(
                95,
                Math.round(
                  (activeInfo.tokenUsage.total / activeInfo.contextWindowMax) *
                    100
                )
              )
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
