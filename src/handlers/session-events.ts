// ============================================================================
// Session Event Handlers — orchestrator session lifecycle → UI updates
// ============================================================================

import * as vscode from "vscode";
import * as path from "path";
import type { SessionOrchestrator } from "../orchestrator";
import type { SessionInfo } from "../session/types";
import type { ChatMessage } from "../types/chat";
import { ChatPanel } from "../providers/chatPanel";
import { ChatPresenter } from "../ui/presenter";
import type { AgentStatusTracker } from "../agent/status";
import type { AgentStatusBar } from "../statusbar/manager";
import type { TreeProvider } from "../tree/provider";
import type { SessionHistoryStore, HistoryEntry } from "../session/historyStore";

// ============================================================================
// Dependencies bag (passed from extension.ts)
// ============================================================================

export interface SessionEventDeps {
  orchestrator: SessionOrchestrator;
  /** Lazily resolve ChatPanel — it is null when handlers are wired at activation */
  getChatPanel: () => ChatPanel | null;
  presenter: ChatPresenter;
  statusTracker: AgentStatusTracker;
  statusBar: AgentStatusBar;
  treeProvider: TreeProvider;
  historyStore: SessionHistoryUpdate;
  updateContext: () => void;
  sendTabs: () => void;
}



export interface SessionHistoryUpdate {
  addEntry(entry: HistoryEntry): Promise<void> | void;
}

// ============================================================================
// Wire all session-related orchestrator events
// ============================================================================

export function wireSessionEvents(deps: SessionEventDeps): void {
  const {
    orchestrator,
    getChatPanel,
    statusTracker,
    statusBar,
    treeProvider,
    historyStore,
    updateContext,
    sendTabs,
  } = deps;

  // -----------------------------------------------------------------------
  // Agent connected
  // -----------------------------------------------------------------------
  orchestrator.on("agentConnected", (agentId: string) => {
    statusTracker.updateAgentStatus(agentId, { state: "idle" });
    statusBar.setConnected(true, agentId);
    updateContext();
    treeProvider.refresh();
    sendTabs();

    const agentInfo = orchestrator.getAgentInfo(agentId);
    if (agentInfo) {
      getChatPanel()?.setAgentInfo(agentId, agentInfo);
    }
  });

  // -----------------------------------------------------------------------
  // Agent disconnected
  // -----------------------------------------------------------------------
  orchestrator.on("agentDisconnected", (agentId: string) => {
    statusTracker.removeAgent(agentId);
    updateContext();
    treeProvider.refresh();
    sendTabs();
  });

  // -----------------------------------------------------------------------
  // Session created
  // -----------------------------------------------------------------------
  orchestrator.on("sessionCreated", ({ agentId, sessionId, cwd }: { agentId: string; sessionId: string; cwd?: string }) => {
    statusTracker.updateSessionStatus(agentId, sessionId, {
      sessionId,
      title: sessionId.slice(0, 8),
      status: "idle",
      isActive: true,
      messageCount: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
    });
    statusTracker.setActiveSession(agentId, sessionId);
    sendTabs();
    treeProvider.refresh();
    updateContext();

    // Warn if the session cwd is outside the current workspace
    if (cwd) {
      const wsFolders = vscode.workspace.workspaceFolders ?? [];
      if (wsFolders.length > 0) {
        const isInsideWorkspace = wsFolders.some(
          (f) => cwd === f.uri.fsPath || cwd.startsWith(f.uri.fsPath + path.sep),
        );
        if (!isInsideWorkspace) {
          void vscode.window.showWarningMessage(
            `ACP: Session working directory "${cwd}" is outside the current workspace`,
          );
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  // Session active changed
  // -----------------------------------------------------------------------
  orchestrator.on("sessionActiveChanged", ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
    statusTracker.setActiveSession(agentId, sessionId);
    const info = orchestrator.getSessionInfo(agentId, sessionId);
    if (info) {
      getChatPanel()?.setActiveSession(agentId, sessionId, info);
    }
    treeProvider.refresh();
  });

  // -----------------------------------------------------------------------
  // Session turn active changed
  // -----------------------------------------------------------------------
  orchestrator.on("sessionTurnActiveChanged", ({ agentId, sessionId, active }: { agentId: string; sessionId: string; active: boolean }) => {
    const cp = getChatPanel();
    cp?.pushTurnActive(agentId, sessionId, active);
    cp?.postMessage(
      deps.presenter.buildTabUpdate(sessionId, agentId, { status: active ? "running" : "idle" }),
    );
  });

  // -----------------------------------------------------------------------
  // Session message — core data flow: agent response → webview
  // -----------------------------------------------------------------------
  orchestrator.on("sessionMessage", ({ agentId, sessionId, message }: { agentId: string; sessionId: string; message: ChatMessage }) => {
    const cp = getChatPanel();
    if (!cp) {
      console.log("[session-events] sessionMessage DROPPED (no ChatPanel yet)", { agentId, sessionId, role: message.role, contentLen: message.content?.length });
      return;
    }
    const info = orchestrator.getSessionInfo(agentId, sessionId);
    console.log("[session-events] sessionMessage → pushMessage", { agentId, sessionId, role: message.role, msgId: message.id, contentLen: message.content?.length });
    cp.pushMessage(agentId, sessionId, message, info?.cwd);
  });

  // -----------------------------------------------------------------------
  // Session closed
  // -----------------------------------------------------------------------
  orchestrator.on("sessionClosed", ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
    const info = orchestrator.getSessionInfo(agentId, sessionId);
    if (info) {
      const entry: HistoryEntry = {
        sessionId,
        agentId,
        title: info.title,
        cwd: info.cwd,
        status: info.status,
        createdAt: info.createdAt.toISOString(),
        updatedAt: info.updatedAt.toISOString(),
        messageCount: info.messages.length,
        tokenUsage: info.tokenUsage,
      };
      void historyStore.addEntry(entry);
    }
    treeProvider.refresh();
    sendTabs();
  });

  // -----------------------------------------------------------------------
  // Session completed (background-only notification)
  // -----------------------------------------------------------------------
  orchestrator.on("sessionCompleted", ({ agentId, sessionId, title }: { agentId: string; sessionId: string; title: string }) => {
    const cp = getChatPanel();
    const activeSessionId = orchestrator.getActiveSessionId(agentId);
    if (sessionId !== activeSessionId) {
      cp?.postMessage(
        deps.presenter.buildSessionCompleted(sessionId, agentId, title),
      );
    }
    cp?.postMessage(
      deps.presenter.buildTabUpdate(sessionId, agentId, { status: "completed" }),
    );
    sendTabs();
  });
}
