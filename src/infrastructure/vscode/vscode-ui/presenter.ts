import type { SessionStatusInfo } from "../../../application/session/orchestrator";
import type { AgentInfo } from "../../../application/session/orchestrator";

export interface TabData {
  sessionId: string;
  agentId: string;
  title: string;
  /** UI-only: dirty flag */
  isDirty: boolean;
}

export interface AgentTabInfo {
  agentId: string;
  name: string;
  state: string;
  color?: string;
}

/**
 * SessionInfoDTO — lightweight projection of SessionInfo for the webview.
 * Excludes `messages` (managed separately by messageStore) and derived
 * counters (messageCount, toolCallCount, toolCallsCompleted).
 */
export interface SessionInfoDTO {
  sessionId: string;
  agentId: string;
  status: import("../../../domain/models/session").SessionStatus;
  lastTurnOutcome: import("../../../domain/models/session").TurnOutcome | null;
  isStreaming: boolean;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  contextWindowMax?: number;
  cwd?: string;
  model?: string;
  mode?: string;
  pinned: boolean;
  /** ISO date string */
  createdAt: string;
  /** ISO date string — last time agent produced output. Null if never. */
  lastResponseAt: string | null;
}

export interface SetTabsMessage {
  type: "setTabs";
  tabs: TabData[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  /** Authoritative active session key (format: "agentId:sessionId") — set by extension, not to be overridden by webview heuristics. */
  activeSessionKey: string | null;
  workspaceRoot: string | null;
  agents: AgentTabInfo[];
  workspaceFolders: Array<{ name: string; path: string }>;
  agentInfoMap: Record<string, unknown>;
  /** Full SessionInfo map for deriving model state in webview */
  sessionInfoMap: Record<string, SessionInfoDTO>;
}

export class ChatPresenter {
  private tabs: Map<string, TabData> = new Map();
  private agents: Map<string, AgentTabInfo> = new Map();
  private activeSessionId: string | null = null;
  private activeAgentId: string | null = null;
  private workspaceRoot: string | null = null;
  private workspaceFolders: Array<{ name: string; path: string }> = [];
  private agentInfoMap: Record<string, unknown> = {};
  private sessionInfoMap: Record<string, SessionInfoDTO> = {};

  setWorkspace(
    root: string | null,
    folders: Array<{ name: string; path: string }>
  ): void {
    this.workspaceRoot = root;
    this.workspaceFolders = folders;
  }

  upsertAgent(
    agentId: string,
    name: string,
    state: string,
    color?: string
  ): void {
    this.agents.set(agentId, { agentId, name, state, color });
  }

  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
    for (const [key, tab] of this.tabs) {
      if (tab.agentId === agentId) {
        this.tabs.delete(key);
      }
    }
  }

  setAgentInfo(agentId: string, info: unknown): void {
    this.agentInfoMap[agentId] = info;
  }

  upsertSession(
    session: SessionStatusInfo,
    agentId: string,
    createdAt: Date
  ): void {
    const key = `${agentId}:${session.sessionId}`;
    const existing = this.tabs.get(key);
    const tab: TabData = {
      sessionId: session.sessionId,
      agentId,
      title: session.title,
      isDirty: existing?.isDirty ?? false,
    };
    this.tabs.set(key, tab);

    this.sessionInfoMap[key] = {
      sessionId: session.sessionId,
      agentId,
      status: session.status,
      lastTurnOutcome: session.lastTurnOutcome,
      isStreaming: session.status === "running",
      tokenUsage: {
        inputTokens: session.tokenUsage.input,
        outputTokens: session.tokenUsage.output,
        totalTokens: session.tokenUsage.total,
      },
      contextWindowMax: session.contextWindowMax,
      cwd: session.cwd,
      model: session.model,
      mode: session.mode,
      pinned: session.pinned,
      createdAt: createdAt.toISOString(),
      lastResponseAt: null,
    };
  }

  removeSession(agentId: string, sessionId: string): void {
    const key = `${agentId}:${sessionId}`;
    this.tabs.delete(key);
    delete this.sessionInfoMap[key];
    if (this.activeSessionId === sessionId && this.activeAgentId === agentId) {
      this.activeSessionId = null;
      this.activeAgentId = null;
    }
  }

  hasSession(agentId: string, sessionId: string): boolean {
    return this.tabs.has(`${agentId}:${sessionId}`);
  }

  setActiveSession(agentId: string, sessionId: string): void {
    this.activeAgentId = agentId;
    this.activeSessionId = sessionId;
  }

  updateTabFromMessage(agentId: string, sessionId: string): void {
    const key = `${agentId}:${sessionId}`;
    const tab = this.tabs.get(key);
    if (!tab) return;
    tab.isDirty = true;
  }

  buildSetTabsMessage(): SetTabsMessage {
    const activeSessionKey =
      this.activeAgentId && this.activeSessionId
        ? `${this.activeAgentId}:${this.activeSessionId}`
        : null;
    return {
      type: "setTabs",
      tabs: Array.from(this.tabs.values()),
      activeSessionId: this.activeSessionId,
      activeAgentId: this.activeAgentId,
      activeSessionKey,
      workspaceRoot: this.workspaceRoot,
      agents: Array.from(this.agents.values()),
      workspaceFolders: this.workspaceFolders,
      agentInfoMap: this.agentInfoMap,
      sessionInfoMap: this.sessionInfoMap,
    };
  }

  buildTabUpdate(
    sessionId: string,
    agentId: string,
    updates: Partial<TabData>
  ): {
    type: "updateTab";
    sessionId: string;
    agentId: string;
    updates: Partial<TabData>;
  } {
    return { type: "updateTab", sessionId, agentId, updates };
  }

  buildSessionCompleted(
    sessionId: string,
    agentId: string,
    title: string,
    stopReason?: string
  ): {
    type: "session/completed";
    agentId: string;
    sessionId: string;
    title: string;
    stopReason?: string;
  } {
    return { type: "session/completed", agentId, sessionId, title, stopReason };
  }

  buildSessionUsage(
    agentId: string,
    sessionId: string,
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    contextWindowMax?: number
  ): {
    type: "session/usage";
    agentId: string;
    sessionId: string;
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    contextWindowMax?: number;
  } {
    return {
      type: "session/usage",
      agentId,
      sessionId,
      tokenUsage,
      contextWindowMax,
    };
  }

  buildSessionCommands(
    agentId: string,
    sessionId: string,
    commands: unknown[]
  ): {
    type: "session/commands";
    agentId: string;
    sessionId: string;
    commands: unknown[];
  } {
    return { type: "session/commands", agentId, sessionId, commands };
  }

  clear(): void {
    this.tabs.clear();
    this.agents.clear();
    this.activeSessionId = null;
    this.activeAgentId = null;
    this.agentInfoMap = {};
    this.sessionInfoMap = {};
  }
}
