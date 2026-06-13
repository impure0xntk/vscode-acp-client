// ============================================================================
// State Manager — event-driven orchestration state management
// ============================================================================

import {
  OrchestrationState,
  OrchestrationEvent,
  OrchestrationEventType,
  EventFilter,
  EventListener,
  Unsubscribe,
} from "../models/orchestration";

const ALL_EVENT_TYPES: OrchestrationEventType[] = [
  "session.created",
  "session.status_changed",
  "session.completed",
  "message.received",
  "message.sent",
  "task.created",
  "task.status_changed",
  "agent.handoff",
  "error.occurred",
];

let eventCounter = 0;
function generateEventId(): string {
  return `evt-${Date.now()}-${++eventCounter}`;
}

// ============================================================================
// State Manager
// ============================================================================

export class StateManager {
  private state: OrchestrationState;
  private listeners: Map<OrchestrationEventType, Set<EventListener>>;

  constructor() {
    this.state = {
      sessions: new Map(),
      agents: new Map(),
      activeTasks: new Map(),
      messageHistory: new Map(),
      eventLog: [],
    };
    this.listeners = new Map();
  }

  // ========================================================================
  // State Access
  // ========================================================================

  getState(): Readonly<OrchestrationState> {
    return this.state;
  }

  // ========================================================================
  // Event Application
  // ========================================================================

  applyEvent(event: OrchestrationEvent): void {
    this.state.eventLog.push(event);
    this.emit(event.type, event);
  }

  createEvent(
    type: OrchestrationEventType,
    payload: unknown
  ): OrchestrationEvent {
    return {
      id: generateEventId(),
      type,
      timestamp: new Date(),
      payload,
    };
  }

  // ========================================================================
  // Subscription
  // ========================================================================

  subscribe(
    eventType: OrchestrationEventType,
    listener: EventListener
  ): Unsubscribe {
    let set = this.listeners.get(eventType);
    if (!set) {
      set = new Set();
      this.listeners.set(eventType, set);
    }
    set.add(listener);

    return () => {
      set?.delete(listener);
    };
  }

  subscribeAll(listener: EventListener): Unsubscribe {
    const unsubs = ALL_EVENT_TYPES.map((t) => this.subscribe(t, listener));
    return () => unsubs.forEach((fn) => fn());
  }

  private emit(
    eventType: OrchestrationEventType,
    event: OrchestrationEvent
  ): void {
    const set = this.listeners.get(eventType);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        console.error(`StateMgr: listener error for ${eventType}:`, err);
      }
    }
  }

  // ========================================================================
  // Event Log Query
  // ========================================================================

  getEventLog(filter?: EventFilter): OrchestrationEvent[] {
    let events = this.state.eventLog;

    if (filter) {
      if (filter.types?.length) {
        events = events.filter((e) => filter.types!.includes(e.type));
      }
      if (filter.since) {
        events = events.filter((e) => e.timestamp >= filter.since!);
      }
    }

    return events;
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    this.listeners.clear();
  }
}
