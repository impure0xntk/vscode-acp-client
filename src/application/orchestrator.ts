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

export {
  StateManager,
  SessionManager,
  AgentRegistryService,
  MessageRouterService,
  TaskSchedulerService,
} from "../domain/services";

// Multi-agent coordination API
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

  cancelSession(agentId: string, sessionId: string): void {
    this.sessionManager.updateSessionStatus(agentId, sessionId, "idle");
  }

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

    sourceSession.context.childSessionIds.push(newSessionId);
    this.sessionManager.updateSessionStatus(fromAgentId, sessionId, "idle");

    const event = this.stateManager.createEvent("agent.handoff", {
      fromAgentId,
      toAgentId,
      sessionId,
      newSessionId,
    });
    this.stateManager.applyEvent(event);

    return newSession;
  }

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

  subscribe(
    eventType: OrchestrationEventType,
    listener: EventListener
  ): Unsubscribe {
    return this.stateManager.subscribe(eventType, listener);
  }

  subscribeAll(listener: EventListener): Unsubscribe {
    return this.stateManager.subscribeAll(listener);
  }

  getState(): Readonly<
    import("../domain/models/orchestration").OrchestrationState
  > {
    return this.stateManager.getState();
  }

  dispose(): void {
    this.taskScheduler.dispose();
    this.messageRouter.dispose();
    this.agentRegistry.dispose();
    this.sessionManager.dispose();
    this.stateManager.dispose();
  }
}
