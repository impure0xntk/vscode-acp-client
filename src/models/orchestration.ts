// ============================================================================
// Orchestration State — top-level state container
// ============================================================================

import type { Session } from "./session";
import type { AgentDefinition } from "./agent";
import type { Task } from "./task";
import type { Message } from "./message";

export interface OrchestrationState {
  sessions: Map<string, Session>;
  agents: Map<string, AgentDefinition>;
  activeTasks: Map<string, Task>;
  messageHistory: Map<string, Message[]>;  // sessionId -> messages
  eventLog: OrchestrationEvent[];
}

// ============================================================================
// Events
// ============================================================================

export type OrchestrationEventType =
  | "session.created"
  | "session.status_changed"
  | "session.completed"
  | "message.received"
  | "message.sent"
  | "task.created"
  | "task.status_changed"
  | "agent.handoff"
  | "error.occurred";

export interface OrchestrationEvent {
  id: string;
  type: OrchestrationEventType;
  timestamp: Date;
  payload: unknown;
}

export interface EventFilter {
  types?: OrchestrationEventType[];
  sessionId?: string;
  agentId?: string;
  since?: Date;
}

export type EventListener = (event: OrchestrationEvent) => void;
export type Unsubscribe = () => void;
