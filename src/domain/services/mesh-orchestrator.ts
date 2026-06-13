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
} from "../models/mesh";
import { MessageBus } from "./message-bus";
import { FileLockManager } from "./file-lock-manager";
import { TaskBoardStore } from "./task-board-store";
import {
  parseMeshMarkers,
  serializeToMarker,
} from "../../shared/util/mesh-marker-parser";

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
  // teamId → MeshTeam
  private teams: Map<string, MeshTeam> = new Map();
  // agentId → unsubscribe function
  private agentSubscriptions: Map<string, () => void> = new Map();

  constructor(deps: MeshOrchestratorDeps) {
    this.sessionOrchestrator = deps.sessionOrchestrator;
    this.messageBus = deps.messageBus;
    this.fileLockManager = deps.fileLockManager;
    this.taskBoardStore = deps.taskBoardStore;
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

    const markerMessage = serializeToMarker(message);
    // Inject marker into the agent's session via prompt
    // The agent will parse the marker and act on the P2P message
    try {
      await this.sessionOrchestrator.prompt(
        targetAgentId,
        sessionId,
        markerMessage
      );
    } catch (e) {
      console.error(
        `[MeshOrchestrator] Failed to forward message to agent ${targetAgentId}: ${e}`
      );
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
        console.error(
          `[MeshOrchestrator] Failed to route P2P message ${msg.id}: ${e}`
        );
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
