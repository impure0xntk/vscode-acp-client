// ============================================================================
// Session Event Handlers — orchestrator session lifecycle → UI updates
// ============================================================================

import * as vscode from "vscode";
import * as path from "path";
import type { SessionOrchestrator } from "../orchestrator";
import type { SessionInfo } from "../session/types";
import type { ChatMessage } from "../../domain/models/chat";
import { ChatPanel } from "../../infrastructure/vscode/vscode-ui/chatPanel";
import { ChatPresenter } from "../../infrastructure/vscode/vscode-ui/presenter";
import type { AgentStatusTracker } from "../../adapter/agent/status";
import type { AgentStatusBar } from "../../infrastructure/vscode/vscode-ui/statusbar";
import type { TreeProvider } from "../../infrastructure/vscode/vscode-ui/tree";
import type {
  SessionHistoryStore,
  HistoryEntry,
} from "../session/historyStore";
import { getLogger } from "../../platform/backends";

const log = getLogger("handlers.session");

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
  orchestrator.on(
    "sessionCreated",
    ({
      agentId,
      sessionId,
      cwd,
    }: {
      agentId: string;
      sessionId: string;
      cwd?: string;
    }) => {
      statusTracker.updateSessionStatus(agentId, sessionId, {
        sessionId,
        title: sessionId.slice(0, 8),
        status: "idle",
        isActive: true,
        messageCount: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
      });
      statusTracker.setActiveSession(agentId, sessionId);
      // Push full SessionInfo to webview
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        getChatPanel()?.pushSessionInfo(agentId, sessionId, info);
      }
      sendTabs();
      treeProvider.refresh();
      updateContext();

      // Push session overview so newly created sessions appear immediately
      const cp = getChatPanel();
      if (cp) {
        const overview = orchestrator.getSessionOverview();
        cp.postMessage({
          type: "sessionOverview:state",
          payload: overview,
        });
      }

      // Warn if the session cwd is outside the current workspace
      if (cwd) {
        const wsFolders = vscode.workspace.workspaceFolders ?? [];
        if (wsFolders.length > 0) {
          const isInsideWorkspace = wsFolders.some(
            (f) =>
              cwd === f.uri.fsPath || cwd.startsWith(f.uri.fsPath + path.sep)
          );
          if (!isInsideWorkspace) {
            void vscode.window.showWarningMessage(
              `ACP: Session working directory "${cwd}" is outside the current workspace`
            );
          }
        }
      }
    }
  );

  // -----------------------------------------------------------------------
  // Session active changed
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionActiveChanged",
    ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
      statusTracker.setActiveSession(agentId, sessionId);
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        getChatPanel()?.setActiveSession(agentId, sessionId, info);
      }
      // Sync full tab list before session switch so the webview has the
      // complete tabOrder. Without this, session/switch may arrive before
      // setTabs, leaving the webview with no tab to activate.
      sendTabs();
      treeProvider.refresh();

      // Push session overview so non-active sessions show updated state
      const cp = getChatPanel();
      if (cp) {
        const overview = orchestrator.getSessionOverview();
        cp.postMessage({
          type: "sessionOverview:state",
          payload: overview,
        });
      }
    }
  );

  // -----------------------------------------------------------------------
  // Session turn active changed — push updated SessionInfo so UI derives state
  // Push for ALL sessions (not just active) so multi-@ and background turns
  // are reflected in tabs, overview, and streaming status.
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionTurnActiveChanged",
    ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
      const cp = getChatPanel();
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        cp?.pushSessionInfo(agentId, sessionId, info);
        // Also push explicit turnActive so the active session UI updates
        // even when session/info mutation is a no-op (same snapshot).
        cp?.pushTurnActive(agentId, sessionId, info.isTurnActive);
      }
      // Push session overview so status/token changes reflect in the overview
      if (cp) {
        const overview = orchestrator.getSessionOverview();
        cp.postMessage({
          type: "sessionOverview:state",
          payload: overview,
        });
      }
    }
  );

  // -----------------------------------------------------------------------
  // Session message — core data flow: agent response → webview
  // Push messages for ALL sessions — the fanout executor routes to the
  // correct (agentId, sessionId) pair, so no cross-tab leakage is possible.
  // The active-session guard was removed because pushUserMessage fires
  // *before* orchestrator.prompt() updates activeSessions, causing every
  // message to be dropped during the race window.
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionMessage",
    ({
      agentId,
      sessionId,
      message,
    }: {
      agentId: string;
      sessionId: string;
      message: ChatMessage;
    }) => {
      const cp = getChatPanel();
      if (!cp) {
        log.debug("sessionMessage dropped (no ChatPanel yet)", {
          agentId,
          sessionId,
          role: message.role,
          contentLen: message.content?.length,
        });
        return;
      }
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      log.debug("sessionMessage → pushMessage", {
        agentId,
        sessionId,
        role: message.role,
        msgId: message.id,
        contentLen: message.content?.length,
      });
      cp.pushMessage(agentId, sessionId, message, info?.cwd);
      // Push updated SessionInfo so UI derives new state (messageCount, tokenUsage, etc.)
      if (info) {
        cp.pushSessionInfo(agentId, sessionId, info);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Session closed
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionClosed",
    ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        const entry: HistoryEntry = {
          sessionId,
          agentId,
          title: info.title,
          cwd: info.cwd,
          status: info.status,
          createdAt: info.createdAt.toISOString(),
          messageCount: info.messages.length,
          tokenUsage: info.tokenUsage,
        };
        void historyStore.addEntry(entry);
      }
      // Remove the session from the presenter so it doesn't appear in the next sendTabs()
      deps.presenter.removeSession(agentId, sessionId);
      treeProvider.refresh();
      sendTabs();

      // Push updated overview after session removal
      const cpClosed = getChatPanel();
      if (cpClosed) {
        const overview = orchestrator.getSessionOverview();
        cpClosed.postMessage({
          type: "sessionOverview:state",
          payload: overview,
        });
      }
    }
  );

  // -----------------------------------------------------------------------
  // Session completed (background-only notification)
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionCompleted",
    ({
      agentId,
      sessionId,
      title,
    }: {
      agentId: string;
      sessionId: string;
      title: string;
    }) => {
      const cp = getChatPanel();
      const activeSessionId = orchestrator.getActiveSessionId(agentId);
      if (sessionId !== activeSessionId) {
        cp?.postMessage(
          deps.presenter.buildSessionCompleted(sessionId, agentId, title)
        );
      }
      // Push updated sessionInfo so UI derives new status from model
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        cp?.pushSessionInfo(agentId, sessionId, info);
      }
      sendTabs();

      // Push updated overview after session completion
      if (cp) {
        const overview = orchestrator.getSessionOverview();
        cp.postMessage({
          type: "sessionOverview:state",
          payload: overview,
        });
      }
    }
  );
}
