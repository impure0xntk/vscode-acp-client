import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { AgentRegistry } from "../../adapter/agent/registry";
import { SessionStateBridge } from "./vscode-ui/sessionStateBridge";
import type { ChatPresenter } from "./vscode-ui/presenter";
import type { AppSessionInfo } from "../../application/session/types";
import type { WebviewPanel } from "../../platform/ui";

/**
 * State synchronization handler for the extension host.
 * Maintains canonical state and broadcasts to all registered webviews.
 */
export class StateSyncHandler {
  private orchestrator: SessionOrchestrator;
  private registry: AgentRegistry;
  private presenter: ChatPresenter;
  private bridge: SessionStateBridge;
  private panelIdCounter = 0;
  private panelIds = new Map<WebviewPanel, string>();

  constructor(
    orchestrator: SessionOrchestrator,
    registry: AgentRegistry,
    presenter: ChatPresenter,
    bridge: SessionStateBridge
  ) {
    this.orchestrator = orchestrator;
    this.registry = registry;
    this.presenter = presenter;
    this.bridge = bridge;
  }

  /**
   * Register a webview panel for state sync
   */
  registerPanel(panel: WebviewPanel): string {
    const panelId = `panel-${++this.panelIdCounter}`;
    this.panelIds.set(panel, panelId);

    panel.onDidDispose(() => {
      this.panelIds.delete(panel);
    });

    // Send initial state sync on registration
    this.sendStateSyncResponse(panel);

    return panelId;
  }

  /**
   * Handle incoming state sync request from a webview
   */
  handleStateSyncRequest(
    panel: WebviewPanel,
    _data: { keys?: string[] }
  ): void {
    this.sendStateSyncResponse(panel);
  }

  /**
   * Handle state mutation from a webview and broadcast to others
   */
  handleStateMutate(
    sourcePanel: WebviewPanel,
    data: {
      store: "session" | "message" | "ui";
      action: string;
      args: unknown[];
      sourcePanelId?: string;
    }
  ): void {
    const sourcePanelId = this.panelIds.get(sourcePanel) ?? data.sourcePanelId;

    // Apply mutation to canonical state in extension host
    this.applyMutationToCanonicalState(data.store, data.action, data.args);

    // Broadcast update to all OTHER panels (not the source)
    const updateMsg = {
      type: "state/update",
      store: data.store,
      payload: this.getCanonicalStateSnapshot(data.store),
      sourcePanelId,
    };

    for (const [panel, panelId] of this.panelIds) {
      if (panelId !== sourcePanelId) {
        panel.webview.postMessage(updateMsg);
      }
    }
  }

  /**
   * Send full state sync response to a specific panel
   */
  private sendStateSyncResponse(panel: WebviewPanel): void {
    const response = {
      type: "state/syncResponse",
      sessionStore: this.getSessionStoreSnapshot(),
      messageStore: this.getMessageStoreSnapshot(),
      uiStateStore: this.getUIStateStoreSnapshot(),
    };

    panel.webview.postMessage(response);
  }

  /**
   * Get session store snapshot from canonical state
   */
  private getSessionStoreSnapshot(): SessionStoreSnapshot {
    const agents = this.orchestrator.getAllAgents();
    const tabs: Array<{
      sessionId: string;
      agentId: string;
      title: string;
      status: string;
    }> = [];
    const sessionInfoMap: Record<string, unknown> = {};
    let activeSessionKey: string | null = null;

    for (const agentStatus of agents) {
      for (const s of agentStatus.sessions) {
        const key = `${agentStatus.agentId}:${s.sessionId}`;
        tabs.push({
          sessionId: s.sessionId,
          agentId: agentStatus.agentId,
          title: s.title,
          status: s.status,
        });
        const info = this.orchestrator.getSessionInfo(agentStatus.agentId, s.sessionId);
        if (info) {
          sessionInfoMap[key] = this.sessionInfoToDTO(info);
        }
        if (this.orchestrator.getActiveSessionId(agentStatus.agentId) === s.sessionId) {
          activeSessionKey = key;
        }
      }
    }

    return {
      tabs,
      activeSessionKey,
      sessionInfoMap,
      workspaceRoot: this.presenter.getWorkspaceRoot?.() ?? null,
      connectedAgents: this.presenter.getConnectedAgents?.() ?? [],
      workspaceFolders: this.presenter.getWorkspaceFolders?.() ?? [],
      agentInfoMap: this.presenter.getAgentInfoMap?.() ?? {},
      completionNotification: this.presenter.getCompletionNotification?.() ?? null,
    };
  }

  /**
   * Get message store snapshot from canonical state
   */
  private getMessageStoreSnapshot(): MessageStoreSnapshot {
    const perSession: Record<string, unknown[]> = {};
    let activeSessionKey: string | null = null;

    for (const agentStatus of this.orchestrator.getAllAgents()) {
      for (const s of agentStatus.sessions) {
        const key = `${agentStatus.agentId}:${s.sessionId}`;
        const info = this.orchestrator.getSessionInfo(agentStatus.agentId, s.sessionId);
        if (info?.messages) {
          perSession[key] = info.messages;
        }
        if (this.orchestrator.getActiveSessionId(agentStatus.agentId) === s.sessionId) {
          activeSessionKey = key;
        }
      }
    }

    return { perSession, activeSessionKey };
  }

  /**
   * Get UI state store snapshot
   */
  private getUIStateStoreSnapshot(): unknown {
    // UI state is primarily client-side, but we can persist some settings
    return {
      // Add any persisted UI state here
    };
  }

  /**
   * Get canonical state snapshot for a specific store
   */
  private getCanonicalStateSnapshot(store: "session" | "message" | "ui"): unknown {
    switch (store) {
      case "session":
        return this.getSessionStoreSnapshot();
      case "message":
        return this.getMessageStoreSnapshot();
      case "ui":
        return this.getUIStateStoreSnapshot();
    }
  }

  /**
   * Apply mutation to canonical state in extension host
   */
  private applyMutationToCanonicalState(
    store: "session" | "message" | "ui",
    action: string,
    args: unknown[]
  ): void {
    // The extension host maintains canonical state through the orchestrator/presenter
    // Most mutations are already handled by existing orchestrator methods
    // This is a fallback for direct store mutations
    switch (store) {
      case "session":
        this.handleSessionMutation(action, args);
        break;
      case "message":
        this.handleMessageMutation(action, args);
        break;
      case "ui":
        // UI state is primarily client-side, no canonical state in extension
        break;
    }
  }

  private handleSessionMutation(action: string, args: unknown[]): void {
    switch (action) {
      case "setActiveSession": {
        const [key] = args as [string];
        const [agentId, sessionId] = key.split(":");
        this.orchestrator.setActiveSession(agentId, sessionId);
        break;
      }
      case "addTab": {
        const [agentId, sessionId, title] = args as [string, string, string];
        // Tab creation is handled by orchestrator when session is created
        break;
      }
      case "setTabTitle": {
        const [key, title] = args as [string, string];
        const [agentId, sessionId] = key.split(":");
        // Title updates would need orchestrator support
        break;
      }
      case "bulkSetTabs":
        // Handled by sendTabsToBridge
        break;
    }
  }

  private handleMessageMutation(_action: string, _args: unknown[]): void {
    // Message mutations are handled by the orchestrator when sending messages
    // This is for any direct store mutations
  }

  private sessionInfoToDTO(info: AppSessionInfo): unknown {
    return {
      sessionId: info.sessionId,
      agentId: info.agentId,
      status: info.status,
      lastTurnOutcome: info.lastTurnOutcome,
      isStreaming: info.isStreaming,
      tokenUsage: {
        input: info.tokenUsage.input,
        output: info.tokenUsage.output,
        total: info.tokenUsage.total,
      },
      contextWindowMax: info.contextWindowMax,
      model: info.model,
      mode: info.mode,
      cwd: info.cwd,
      createdAt: info.createdAt.toISOString(),
      lastResponseAt: info.lastResponseAt ?? null,
    };
  }
}

interface SessionStoreSnapshot {
  tabs: Array<{
    sessionId: string;
    agentId: string;
    title: string;
    status: string;
  }>;
  activeSessionKey: string | null;
  sessionInfoMap: Record<string, unknown>;
  workspaceRoot: string | null;
  connectedAgents: unknown[];
  workspaceFolders: unknown[];
  agentInfoMap: Record<string, unknown>;
  completionNotification: unknown | null;
}

interface MessageStoreSnapshot {
  perSession: Record<string, unknown[]>;
  activeSessionKey: string | null;
}