// ============================================================================
// Session Manager — CRUD and lifecycle for sessions
// ============================================================================

import { EventEmitter } from "events";
import type { Session, SessionStatus, SessionContext } from "../models/session";
import type {
  OrchestrationEventType,
  EventListener,
  Unsubscribe,
} from "../models/orchestration";
import { StateManager } from "./state-manager";

// ============================================================================
// Session Manager
// ============================================================================

export class SessionManager extends EventEmitter {
  private stateManager: StateManager;
  // agentId → Map<sessionId, Session>
  private sessions: Map<string, Map<string, Session>> = new Map();
  // agentId → active sessionId
  private activeSessions: Map<string, string> = new Map();

  constructor(stateManager: StateManager) {
    super();
    this.stateManager = stateManager;
  }

  // ========================================================================
  // CRUD
  // ========================================================================

  createSession(
    agentId: string,
    sessionId: string,
    context?: Partial<SessionContext>
  ): Session {
    const now = new Date();
    const session: Session = {
      id: sessionId,
      agentId,
      status: "idle",
      lastTurnOutcome: null,
      context: {
        variables: {},
        childSessionIds: [],
        metadata: {},
        ...context,
      },
      createdAt: now,
      updatedAt: now,
    };

    let agentSessions = this.sessions.get(agentId);
    if (!agentSessions) {
      agentSessions = new Map();
      this.sessions.set(agentId, agentSessions);
    }
    agentSessions.set(sessionId, session);

    if (!this.activeSessions.has(agentId)) {
      this.activeSessions.set(agentId, sessionId);
    }

    const event = this.stateManager.createEvent("session.created", {
      agentId,
      sessionId,
      context,
    });
    this.stateManager.applyEvent(event);
    this.emit("sessionCreated", { agentId, sessionId });

    return session;
  }

  getSession(agentId: string, sessionId: string): Session | undefined {
    return this.sessions.get(agentId)?.get(sessionId);
  }

  updateSessionStatus(
    agentId: string,
    sessionId: string,
    status: SessionStatus
  ): void {
    const session = this.getSession(agentId, sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }
    session.status = status;
    session.updatedAt = new Date();

    const event = this.stateManager.createEvent("session.status_changed", {
      agentId,
      sessionId,
      status,
    });
    this.stateManager.applyEvent(event);
    this.emit("sessionStatusChanged", { agentId, sessionId, status });
  }

  destroySession(agentId: string, sessionId: string): void {
    const agentSessions = this.sessions.get(agentId);
    if (!agentSessions) return;

    agentSessions.delete(sessionId);

    if (this.activeSessions.get(agentId) === sessionId) {
      this.activeSessions.delete(agentId);
      const remaining = this.getSessionsForAgent(agentId);
      if (remaining.length > 0) {
        const newActive = remaining[0].id;
        this.activeSessions.set(agentId, newActive);
        this.emit("sessionActiveChanged", { agentId, sessionId: newActive });
      }
    }

    this.emit("sessionClosed", { agentId, sessionId });
  }

  // ========================================================================
  // Active Session (per-agent)
  // ========================================================================

  getActiveSessionId(agentId: string): string | undefined {
    return this.activeSessions.get(agentId);
  }

  setActiveSession(agentId: string, sessionId: string): void {
    const agentSessions = this.sessions.get(agentId);
    if (!agentSessions?.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
    }
    this.activeSessions.set(agentId, sessionId);
    this.emit("sessionActiveChanged", { agentId, sessionId });
  }

  // ========================================================================
  // Listing
  // ========================================================================

  getSessionsForAgent(agentId: string): Session[] {
    const agentSessions = this.sessions.get(agentId);
    if (!agentSessions) return [];
    return Array.from(agentSessions.values());
  }

  getAllSessions(): Map<string, Session[]> {
    const result = new Map<string, Session[]>();
    for (const [agentId, agentSessions] of this.sessions) {
      result.set(agentId, Array.from(agentSessions.values()));
    }
    return result;
  }

  // ========================================================================
  // Child Session Helpers
  // ========================================================================

  getChildSessions(parentSessionId: string): Session[] {
    const result: Session[] = [];
    for (const [, agentSessions] of this.sessions) {
      for (const [, session] of agentSessions) {
        if (session.context.parentSessionId === parentSessionId) {
          result.push(session);
        }
      }
    }
    return result;
  }

  // ========================================================================
  // Event Helpers (typed subscription)
  // ========================================================================

  onSessionEvent(
    type: OrchestrationEventType,
    listener: EventListener
  ): Unsubscribe {
    return this.stateManager.subscribe(type, listener);
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    this.sessions.clear();
    this.activeSessions.clear();
    this.removeAllListeners();
  }
}
