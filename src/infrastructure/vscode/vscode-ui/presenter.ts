// ============================================================================
// Chat Presenter — transforms orchestration state into webview messages.
// TabData only carries UI-specific state (unread, dirty); everything else
// is derived from SessionInfo on the extension side.
// ============================================================================

import type { SessionStatusInfo } from "../../../domain/models/agent";
import type { AgentInfo } from "../../../application/session/orchestrator";

// ============================================================================
// Tab data sent to webview — UI-only fields
// ============================================================================

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

/** Minimal SessionInfo snapshot sent to webview for derivation of display data */
export interface SessionInfoSnapshot {
  sessionId: string;
  agentId: string;
  status: import("../../../domain/models/session").SessionStatus;
  isTurnActive: boolean;
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
  /** ISO date string */
  createdAt: string;
  /** ISO date string */
  updatedAt: string;
}

export interface SetTabsMessage {
  type: "setTabs";
  tabs: TabData[];
  activeSessionId: string | null;
  activeAgentId: string | null;
  workspaceRoot: string | null;
  agents: AgentTabInfo[];
  workspaceFolders: Array<{ name: string; path: string }>;
  agentInfoMap: Record<string, unknown>;
  /** Full SessionInfo map for deriving model state in webview */
  sessionInfoMap: Record<string, SessionInfoSnapshot>;
}

// ============================================================================
// Presenter
// ============================================================================

export class ChatPresenter {
  private tabs: Map<string, TabData> = new Map();
  private agents: Map<string, AgentTabInfo> = new Map();
  private activeSessionId: string | null = null;
  private activeAgentId: string | null = null;
  private workspaceRoot: string | null = null;
  private workspaceFolders: Array<{ name: string; path: string }> = [];
  private agentInfoMap: Record<string, unknown> = {};
  private sessionInfoMap: Record<string, SessionInfoSnapshot> = {};

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  setWorkspace(
    root: string | null,
    folders: Array<{ name: string; path: string }>
  ): void {
    this.workspaceRoot = root;
    this.workspaceFolders = folders;
  }

  // -----------------------------------------------------------------------
  // Agent updates
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Session updates — only UI-specific fields
  // -----------------------------------------------------------------------

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

    // Store full SessionInfo snapshot for webview derivation
    this.sessionInfoMap[key] = {
      sessionId: session.sessionId,
      agentId,
      status: session.status,
      isTurnActive: session.status === "running",
      isStreaming: session.status === "running",
      tokenUsage: {
        inputTokens: session.tokenUsage.input,
        outputTokens: session.tokenUsage.output,
        totalTokens: session.tokenUsage.total,
      },
      contextWindowMax: (session as unknown as { contextWindowMax?: number })
        .contextWindowMax,
      cwd: session.cwd,
      model: session.model,
      mode: session.mode,
      createdAt: createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
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

  // -----------------------------------------------------------------------
  // Build messages
  // -----------------------------------------------------------------------

  buildSetTabsMessage(): SetTabsMessage {
    return {
      type: "setTabs",
      tabs: Array.from(this.tabs.values()),
      activeSessionId: this.activeSessionId,
      activeAgentId: this.activeAgentId,
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
    title: string
  ): {
    type: "session/completed";
    agentId: string;
    sessionId: string;
    title: string;
  } {
    return { type: "session/completed", agentId, sessionId, title };
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

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  clear(): void {
    this.tabs.clear();
    this.agents.clear();
    this.activeSessionId = null;
    this.activeAgentId = null;
    this.agentInfoMap = {};
    this.sessionInfoMap = {};
  }
}
