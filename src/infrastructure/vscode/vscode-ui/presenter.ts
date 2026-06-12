// ============================================================================
// Chat Presenter — transforms orchestration state into webview messages
// Decouples orchestrator events from webview-specific message formats
// ============================================================================

import type { AgentStatus, SessionStatusInfo } from "../../../domain/models/agent";
import type { SessionStatus } from "../../../domain/models/session";
import type { ChatMessage, TokenUsage } from "../../../domain/models/chat";
import type { AgentInfo } from "../../../application/session/orchestrator";

// ============================================================================
// Tab data sent to webview
// ============================================================================

export interface TabData {
  sessionId: string;
  agentId: string;
  title: string;
  status: SessionStatus;
  unreadCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  contextWindowMax?: number;
  sessionStartMs: number;
  lastActivity: number;
  isDirty: boolean;
  cwd?: string;
  model?: string;
  mode?: string;
}

export interface AgentTabInfo {
  agentId: string;
  name: string;
  state: string;
  color?: string;
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

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  setWorkspace(root: string | null, folders: Array<{ name: string; path: string }>): void {
    this.workspaceRoot = root;
    this.workspaceFolders = folders;
  }

  // -----------------------------------------------------------------------
  // Agent updates
  // -----------------------------------------------------------------------

  upsertAgent(agentId: string, name: string, state: string, color?: string): void {
    this.agents.set(agentId, { agentId, name, state, color });
  }

  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
    // Remove tabs for this agent
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
  // Session updates
  // -----------------------------------------------------------------------

  upsertSession(session: SessionStatusInfo, agentId: string, createdAt: Date): void {
    const key = `${agentId}:${session.sessionId}`;
    const existing = this.tabs.get(key);
    const tab: TabData = {
      sessionId: session.sessionId,
      agentId,
      title: session.title,
      status: session.status,
      unreadCount: existing?.unreadCount ?? 0,
      tokenUsage: {
        inputTokens: session.tokenUsage.input,
        outputTokens: session.tokenUsage.output,
        totalTokens: session.tokenUsage.total,
      },
      contextWindowMax: (session as unknown as { contextWindowMax?: number }).contextWindowMax,
      sessionStartMs: existing?.sessionStartMs ?? createdAt.getTime(),
      lastActivity: existing?.lastActivity ?? Date.now(),
      isDirty: existing?.isDirty ?? false,
      cwd: session.cwd,
      model: session.model,
      mode: session.mode,
    };
    this.tabs.set(key, tab);
  }

  removeSession(agentId: string, sessionId: string): void {
    this.tabs.delete(`${agentId}:${sessionId}`);
    // Clear active session if it was the removed one
    if (this.activeSessionId === sessionId && this.activeAgentId === agentId) {
      this.activeSessionId = null;
      this.activeAgentId = null;
    }
  }

  setActiveSession(agentId: string, sessionId: string): void {
    this.activeAgentId = agentId;
    this.activeSessionId = sessionId;
  }

  // -----------------------------------------------------------------------
  // Message → Tab update
  // -----------------------------------------------------------------------

  updateTabFromMessage(agentId: string, sessionId: string, message: ChatMessage): void {
    const key = `${agentId}:${sessionId}`;
    const tab = this.tabs.get(key);
    if (!tab) return;
    tab.lastActivity = Date.now();
    tab.isDirty = true;
  }

  // -----------------------------------------------------------------------
  // Build the setTabs message
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
    };
  }

  // -----------------------------------------------------------------------
  // Build a lightweight tab update (no full refresh)
  // -----------------------------------------------------------------------

  buildTabUpdate(sessionId: string, agentId: string, updates: Partial<TabData>): {
    type: "updateTab";
    sessionId: string;
    agentId: string;
    updates: Partial<TabData>;
  } {
    return { type: "updateTab", sessionId, agentId, updates };
  }

  // -----------------------------------------------------------------------
  // Build session/completed notification
  // -----------------------------------------------------------------------

  buildSessionCompleted(sessionId: string, agentId: string, title: string): {
    type: "session/completed";
    agentId: string;
    sessionId: string;
    title: string;
  } {
    return { type: "session/completed", agentId, sessionId, title };
  }

  // -----------------------------------------------------------------------
  // Build session/usage update
  // -----------------------------------------------------------------------

  buildSessionUsage(
    agentId: string,
    sessionId: string,
    tokenUsage: TokenUsage,
    contextWindowMax?: number,
  ): {
    type: "session/usage";
    agentId: string;
    sessionId: string;
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
    contextWindowMax?: number;
  } {
    return {
      type: "session/usage",
      agentId,
      sessionId,
      tokenUsage: {
        inputTokens: tokenUsage.input,
        outputTokens: tokenUsage.output,
        totalTokens: tokenUsage.total,
      },
      contextWindowMax,
    };
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
  }
}
