import { EventEmitter } from "events";
import {
  AgentStatus,
  SessionStatusInfo,
  AgentConnectionState,
} from "../../application/orchestrator";

export type { AgentStatus, SessionStatusInfo, AgentConnectionState };

export interface AgentStatusEvents {
  agentStatusChanged: (agentId: string, status: AgentStatus) => void;
  sessionStatusChanged: (
    agentId: string,
    sessionId: string,
    status: SessionStatusInfo
  ) => void;
}

export class AgentStatusTracker extends EventEmitter {
  private statuses: Map<string, AgentStatus> = new Map();

  constructor() {
    super();
  }

  updateAgentStatus(agentId: string, update: Partial<AgentStatus>): void {
    const current = this.statuses.get(agentId);
    const merged: AgentStatus = current
      ? { ...current, ...update, lastActivity: new Date() }
      : ({
          agentId,
          state: "disconnected",
          sessions: [],
          totalTokenUsage: { input: 0, output: 0, total: 0 },
          lastActivity: new Date(),
          ...update,
        } as AgentStatus);

    this.statuses.set(agentId, merged);
    this.emit("agentStatusChanged", agentId, merged);
  }

  getAgentStatus(agentId: string): AgentStatus | undefined {
    return this.statuses.get(agentId);
  }

  getAllAgentStatuses(): AgentStatus[] {
    return Array.from(this.statuses.values());
  }

  setActiveSession(agentId: string, sessionId: string | undefined): void {
    const current = this.statuses.get(agentId);
    if (!current) return;

    const updated: AgentStatus = {
      ...current,
      activeSessionId: sessionId,
      lastActivity: new Date(),
    };

    updated.sessions = updated.sessions.map((s) => ({
      ...s,
      isActive: s.sessionId === sessionId,
    }));

    this.statuses.set(agentId, updated);
    this.emit("agentStatusChanged", agentId, updated);
  }

  removeAgent(agentId: string): void {
    this.statuses.delete(agentId);
  }

  updateSessionStatus(
    agentId: string,
    sessionId: string,
    update: Partial<SessionStatusInfo>
  ): void {
    const current = this.statuses.get(agentId);
    if (!current) return;

    const sessions = current.sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, ...update } : s
    );

    if (!sessions.some((s) => s.sessionId === sessionId)) {
      sessions.push({
        sessionId,
        title: "",
        status: "idle",
        isActive: false,
        messageCount: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
        ...update,
      } as SessionStatusInfo);
    }

    const updated: AgentStatus = {
      ...current,
      sessions,
      lastActivity: new Date(),
    };

    this.statuses.set(agentId, updated);
    this.emit("agentStatusChanged", agentId, updated);

    const sessionInfo = sessions.find((s) => s.sessionId === sessionId);
    if (sessionInfo) {
      this.emit("sessionStatusChanged", agentId, sessionId, sessionInfo);
    }
  }

  dispose(): void {
    this.statuses.clear();
    this.removeAllListeners();
  }
}
