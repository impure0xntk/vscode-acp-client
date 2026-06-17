// ============================================================================
// Orchestrator Facade — high-level ACP session orchestration
// Wraps SessionOrchestrator with event-driven StateManager integration.
//
// Migration strategy: This module re-exports SessionOrchestrator types for
// backward compatibility while the consuming code migrates to the new
// services/* modules.
// ============================================================================

import {
  SessionOrchestrator,
  RestoreResult,
  AgentConfig,
  AutoConnectEntry,
  AgentConnectionState,
  AgentStatus,
  AgentInfo,
  SessionStatusInfo,
  PromptContext,
  sessionKey,
  SessionCompletedEvent,
} from "./session/orchestrator";
import { StateManager } from "../domain/services/state-manager";
import { SessionManager } from "../domain/services/session-manager";
import { AgentRegistryService } from "../domain/services/agent-registry";
import { MessageRouterService } from "../domain/services/message-router";
import { TaskSchedulerService } from "../domain/services/task-scheduler";
import type { Task, TaskDefinition } from "../domain/models/task";
import type {
  OrchestrationEventType,
  EventListener,
  Unsubscribe,
} from "../domain/models/orchestration";

export {
  SessionOrchestrator,
  RestoreResult,
  AgentConfig,
  AutoConnectEntry,
  AgentConnectionState,
  AgentStatus,
  AgentInfo,
  SessionStatusInfo,
  PromptContext,
  sessionKey,
  SessionCompletedEvent,
};

// ============================================================================
// Re-exports from models for convenience
// ============================================================================

export type {
  AgentDefinition,
  Session,
  SessionStatus,
  SessionContext,
  Message,
  MessageRole,
  MessageContent,
  MessageMetadata,
  Task,
  TaskType,
  TaskStatus,
  TaskDefinition,
  OrchestrationState,
  OrchestrationEvent,
  OrchestrationEventType,
} from "../domain/models";

// ============================================================================
// Re-exports from services for convenience
// ============================================================================

export {
  StateManager,
  SessionManager,
  AgentRegistryService,
  MessageRouterService,
  TaskSchedulerService,
} from "../domain/services";

// ============================================================================
// High-Level Orchestrator — multi-agent coordination API
// ============================================================================

export class Orchestrator {
  readonly stateManager: StateManager;
  readonly sessionManager: SessionManager;
  readonly agentRegistry: AgentRegistryService;
  readonly messageRouter: MessageRouterService;
  readonly taskScheduler: TaskSchedulerService;

  constructor() {
    this.stateManager = new StateManager();
    this.sessionManager = new SessionManager(this.stateManager);
    this.agentRegistry = new AgentRegistryService(this.stateManager);
    this.messageRouter = new MessageRouterService(this.stateManager);
    this.taskScheduler = new TaskSchedulerService(this.stateManager);
  }

  // ========================================================================
  // Session Lifecycle
  // ========================================================================

  /**
   * Start a new session with the given agent.
   */
  startSession(
    agentId: string,
    sessionId: string,
    context?: Record<string, unknown>
  ): import("../domain/models/session").Session {
    return this.sessionManager.createSession(agentId, sessionId, {
      variables: context ?? {},
      childSessionIds: [],
      metadata: {},
    });
  }

  /**
   * Cancel a running session.
   */
  cancelSession(agentId: string, sessionId: string): void {
    this.sessionManager.updateSessionStatus(agentId, sessionId, "idle");
  }

  // ========================================================================
  // Handoff — transfer session from one agent to another
  // ========================================================================

  /**
   * Handoff a session from one agent to another.
   * Creates a new session with the target agent and copies context.
   */
  handoff(
    fromAgentId: string,
    toAgentId: string,
    sessionId: string,
    newSessionId: string
  ): import("../domain/models/session").Session {
    const sourceSession = this.sessionManager.getSession(
      fromAgentId,
      sessionId
    );
    if (!sourceSession) {
      throw new Error(
        `Session ${sessionId} not found for agent ${fromAgentId}`
      );
    }

    // Create new session with target agent
    const newSession = this.sessionManager.createSession(
      toAgentId,
      newSessionId,
      {
        variables: { ...sourceSession.context.variables },
        parentSessionId: sessionId,
        childSessionIds: [],
        metadata: {
          ...sourceSession.context.metadata,
          handedOffFrom: fromAgentId,
        },
      }
    );

    // Update source session
    sourceSession.context.childSessionIds.push(newSessionId);
    this.sessionManager.updateSessionStatus(fromAgentId, sessionId, "idle");

    // Emit handoff event
    const event = this.stateManager.createEvent("agent.handoff", {
      fromAgentId,
      toAgentId,
      sessionId,
      newSessionId,
    });
    this.stateManager.applyEvent(event);

    return newSession;
  }

  // ========================================================================
  // Multi-Agent Execution
  // ========================================================================

  /**
   * Execute a pipeline of tasks sequentially.
   * Each task's output becomes the next task's input.
   */
  async executePipeline(
    tasks: Array<{ agentId: string; input: unknown }>,
    executeFn: (agentId: string, input: unknown) => Promise<unknown>
  ): Promise<unknown[]> {
    const taskDefinitions: TaskDefinition[] = tasks.map((t) => ({
      type: "single_agent" as const,
      assignedAgentId: t.agentId,
      input: t.input,
    }));

    const createdTasks = taskDefinitions.map((def) =>
      this.taskScheduler.createTask(def)
    );
    const taskIds = createdTasks.map((t) => t.id);

    return this.taskScheduler.executePipeline(taskIds, async (task) => {
      return executeFn(task.assignedAgentId, task.input);
    });
  }

  /**
   * Execute tasks in parallel across agents.
   */
  async executeParallel(
    tasks: Array<{ agentId: string; input: unknown }>,
    executeFn: (agentId: string, input: unknown) => Promise<unknown>
  ): Promise<unknown[]> {
    const taskDefinitions: TaskDefinition[] = tasks.map((t) => ({
      type: "single_agent" as const,
      assignedAgentId: t.agentId,
      input: t.input,
    }));

    const createdTasks = taskDefinitions.map((def) =>
      this.taskScheduler.createTask(def)
    );
    const taskIds = createdTasks.map((t) => t.id);

    return this.taskScheduler.executeParallel(taskIds, async (task) => {
      return executeFn(task.assignedAgentId, task.input);
    });
  }

  // ========================================================================
  // State Monitoring
  // ========================================================================

  /**
   * Subscribe to orchestration events.
   */
  subscribe(
    eventType: OrchestrationEventType,
    listener: EventListener
  ): Unsubscribe {
    return this.stateManager.subscribe(eventType, listener);
  }

  /**
   * Subscribe to all orchestration events.
   */
  subscribeAll(listener: EventListener): Unsubscribe {
    return this.stateManager.subscribeAll(listener);
  }

  /**
   * Get current orchestration state.
   */
  getState(): Readonly<
    import("../domain/models/orchestration").OrchestrationState
  > {
    return this.stateManager.getState();
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    this.taskScheduler.dispose();
    this.messageRouter.dispose();
    this.agentRegistry.dispose();
    this.sessionManager.dispose();
    this.stateManager.dispose();
  }
}
