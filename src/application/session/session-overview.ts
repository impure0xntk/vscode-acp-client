import type { SessionStatus, TurnOutcome } from "../../domain/models/session";
import type { AgentConnection } from "./agent-connection";
import type { SessionState } from "./session-state";
import type { ChatMessage } from "../../domain/models/chat";

type OverviewEntry = SessionOverview["sessions"][number];

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
  // Cached per-session counters — invalidated on message append
  private counterCache = new Map<
    string,
    { messageCount: number; toolCallCount: number; toolCallsCompleted: number }
  >();

  constructor(deps: SessionOverviewDeps) {
    this.deps = deps;
  }

  /** Invalidate cache for a session — called on appendMessage */
  invalidateCounterCache(agentId: string, sessionId: string): void {
    this.counterCache.delete(`${agentId}:${sessionId}`);
  }

  private getOrComputeCounters(
    agentId: string,
    sessionId: string,
    messages: ChatMessage[]
  ): {
    messageCount: number;
    toolCallCount: number;
    toolCallsCompleted: number;
  } {
    const key = `${agentId}:${sessionId}`;
    const cached = this.counterCache.get(key);
    if (cached && cached.messageCount === messages.length) {
      return cached;
    }
    let toolCallCount = 0;
    let toolCallsCompleted = 0;
    for (const msg of messages) {
      const tcs = msg.toolCalls;
      if (tcs) {
        toolCallCount += tcs.length;
        for (const tc of tcs) {
          if (tc.status === "completed") toolCallsCompleted++;
        }
      }
    }
    const result = {
      messageCount: messages.length,
      toolCallCount,
      toolCallsCompleted,
    };
    this.counterCache.set(key, result);
    return result;
  }

  compute(opts: { withRecentResponses?: boolean } = {}): {
    sessions: OverviewEntry[];
    lastUpdated: string;
  } {
    const { withRecentResponses = false } = opts;
    const sessions: OverviewEntry[] = [];

    const allSessions = this.deps.sessionState.getAllSessions();
    for (const [agentId, agentSessions] of allSessions) {
      for (const info of agentSessions) {
        const sid = info.sessionId;
        const counters = this.getOrComputeCounters(agentId, sid, info.messages);

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
            elapsedMs:
              info.status === "running" && info.lastResponseAt
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
                  percentage: Math.round(
                    (info.tokenUsage.total / info.contextWindowMax) * 100
                  ),
                }
              : undefined,
            messageCount: counters.messageCount,
            toolCallCount: counters.toolCallCount,
            toolCallsCompleted: counters.toolCallsCompleted,
          },
          recentResponses: withRecentResponses
            ? this.extractRecentResponses(info.messages, 3)
            : [],
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
      const overview = this.compute({ withRecentResponses: true });
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
