import type { AppSessionInfo } from "./types";
import type { SessionStatus, TurnOutcome } from "../../domain/models/session";
import type { AgentConnection } from "./agent-connection";
import type { SessionState } from "./session-state";
import type { ChatMessage } from "../../domain/models/chat";

type OverviewEntry = SessionOverview["sessions"][number];
import { getLogger } from "../../platform/backends";

const log = getLogger("session-overview");

export interface SessionOverview {
  sessions: Array<{
    sessionId: string;
    agentId: string;
    title: string;
    status: SessionStatus;
    lastTurnOutcome: TurnOutcome | null;
    model?: string;
    mode?: string;
    pinned: boolean;
    progress: {
      elapsedMs: number;
      tokenUsage: { input: number; output: number; total: number };
      contextWindow?: { used: number; max: number; percentage: number };
      messageCount: number;
      toolCallCount: number;
      toolCallsCompleted: number;
    };
    recentResponses: Array<{
      messageId: string;
      role: "agent" | "tool";
      preview: string;
      toolName?: string;
      status?: "completed" | "running" | "failed";
      timestamp: string;
    }>;
    cwd?: string;
    createdAt: string;
    lastResponseAt: string | null;
  }>;
  lastUpdated: string;
}

export interface SessionOverviewDeps {
  agentConnection: AgentConnection;
  sessionState: SessionState;
  emit: (event: string, ...args: unknown[]) => void;
}

export class SessionOverview {
  private deps: SessionOverviewDeps;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: SessionOverviewDeps) {
    this.deps = deps;
  }

  compute(): { sessions: OverviewEntry[]; lastUpdated: string } {
    const sessions: OverviewEntry[] = [];

    const allSessions = this.deps.sessionState.getAllSessions();
    for (const [agentId, agentSessions] of allSessions) {
      for (const info of agentSessions) {
        const sid = info.sessionId;
        const toolCallCount = info.messages.reduce(
          (count: number, msg: ChatMessage) => count + (msg.toolCalls?.length ?? 0),
          0
        );
        const toolCallsCompleted = info.messages.reduce(
          (count: number, msg: ChatMessage) => count + (msg.toolCalls?.filter((tc) => tc.status === "completed").length ?? 0),
          0
        );

        sessions.push({
          sessionId: sid,
          agentId,
          title: info.title,
          status: info.status,
          lastTurnOutcome: info.lastTurnOutcome,
          model: info.model,
          mode: info.mode,
          pinned: this.deps.sessionState.isSessionPinned(agentId, sid),
          progress: {
            elapsedMs: info.status === "running" && info.lastResponseAt
              ? Date.now() - new Date(info.lastResponseAt).getTime()
              : 0,
            tokenUsage: {
              input: info.tokenUsage.input,
              output: info.tokenUsage.output,
              total: info.tokenUsage.total,
            },
            contextWindow: info.contextWindowMax
              ? {
                  used: info.tokenUsage.total,
                  max: info.contextWindowMax,
                  percentage: Math.round((info.tokenUsage.total / info.contextWindowMax) * 100),
                }
              : undefined,
            messageCount: info.messages.length,
            toolCallCount,
            toolCallsCompleted,
          },
          recentResponses: this.extractRecentResponses(info.messages, 3),
          cwd: info.cwd,
          createdAt: info.createdAt.toISOString(),
          lastResponseAt: info.lastResponseAt,
        });
      }
    }

    return { sessions, lastUpdated: new Date().toISOString() };
  }

  emitDebounced(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      const overview = this.compute();
      this.deps.emit("sessionOverview:update", overview);
    }, 100);
  }

  cancelDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private extractRecentResponses(
    messages: ChatMessage[],
    limit: number
  ): Array<{
    messageId: string;
    role: "agent" | "tool";
    preview: string;
    toolName?: string;
    status?: "completed" | "running" | "failed";
    timestamp: string;
  }> {
    const responses: Array<{
      messageId: string;
      role: "agent" | "tool";
      preview: string;
      toolName?: string;
      status?: "completed" | "running" | "failed";
      timestamp: string;
    }> = [];

    for (let i = messages.length - 1; i >= 0 && responses.length < limit; i--) {
      const msg = messages[i];
      if (msg.role === "agent" && msg.content) {
        responses.unshift({
          messageId: msg.id,
          role: "agent",
          preview: msg.content.slice(0, 120),
          timestamp: new Date(msg.timestamp).toISOString(),
        });
      }
    }

    return responses;
  }
}
