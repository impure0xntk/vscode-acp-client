import * as vscode from "vscode";
import * as path from "path";
import type { SessionOrchestrator } from "../orchestrator";
import type { AppSessionInfo } from "../session/types";
import type { ChatMessage } from "../../domain/models/chat";
import { ChatPanel } from "../../infrastructure/vscode/vscode-ui/chatPanel";
import { ChatPresenter } from "../../infrastructure/vscode/vscode-ui/presenter";
import type { AgentStatusTracker } from "../../adapter/agent/status";
import type {
  SessionHistoryStore,
  HistoryEntry,
} from "../session/historyStore";
import { getLogger } from "../../platform/backends";

const log = getLogger("handlers.session");

export interface SessionEventDeps {
  orchestrator: SessionOrchestrator;
  /** Lazily resolve ChatPanel — it is null when handlers are wired at activation */
  getChatPanel: () => ChatPanel | null;
  presenter: ChatPresenter;
  statusTracker: AgentStatusTracker;
  historyStore: SessionHistoryUpdate;
  updateContext: () => void;
  sendTabs: () => void;
}

export interface SessionHistoryUpdate {
  addEntry(entry: HistoryEntry): Promise<void> | void;
}

export function wireSessionEvents(deps: SessionEventDeps): void {
  const {
    orchestrator,
    getChatPanel,
    statusTracker,
    historyStore,
    updateContext,
    sendTabs,
  } = deps;

  orchestrator.on("agentConnected", (agentId: string) => {
    statusTracker.updateAgentStatus(agentId, { state: "idle" });
    updateContext();
    sendTabs();

    const agentInfo = orchestrator.getAgentInfo(agentId);
    if (agentInfo) {
      getChatPanel()?.setAgentInfo(agentId, agentInfo);
    }
  });

  orchestrator.on("agentDisconnected", (agentId: string) => {
    statusTracker.removeAgent(agentId);
    updateContext();
    sendTabs();
  });

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
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        getChatPanel()?.pushSessionInfo(agentId, sessionId, info);
      }
      sendTabs();
      updateContext();

      const cp = getChatPanel();
      if (cp) {
        const overview = orchestrator.getSessionOverview();
        cp.postMessage({
          type: "sessionOverview:state",
          payload: overview,
        });
      }

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

  // NOTE: Do NOT call sendTabs() here. sendTabs() triggers handleSetTabs in
  // the webview which calls setActiveSession(), which emits
  // sessionActiveChanged again — creating an infinite loop:
  //   sessionActiveChanged → sendTabs → handleSetTabs → setActiveSession
  //     → sessionActiveChanged → ...
  // Instead, sendTabs() is called explicitly at the sites that need it
  // (agentConnected, sessionCreated, etc.).  The session/switch message
  // sent below already carries the activeSessionKey info the webview needs.
  //
  // NOTE: Do NOT call getSessionOverview() here either. setActiveSession()
  // already calls emitOverviewUpdate() which is debounced (100ms). Calling
  // getSessionOverview() synchronously here blocks the extension host and
  // duplicates the work — the debounced emission covers the overview update.
  orchestrator.on(
    "sessionActiveChanged",
    ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
      statusTracker.setActiveSession(agentId, sessionId);
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        getChatPanel()?.setActiveSession(agentId, sessionId, info);
      }
      updateContext();
    }
  );

  // Push for ALL sessions (not just active) so multi-@ and background turns
  // are reflected in tabs, overview, and streaming status.
  let turnActiveOverviewTimer: ReturnType<typeof setTimeout> | null = null;
  orchestrator.on(
    "sessionTurnActiveChanged",
    ({
      agentId,
      sessionId,
      active,
      stopReason,
    }: {
      agentId: string;
      sessionId: string;
      active: boolean;
      stopReason?: string;
    }) => {
      const cp = getChatPanel();
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        cp?.pushSessionInfo(agentId, sessionId, info);
        cp?.pushTurnActive(agentId, sessionId, info.status === "running");
      }
      // Always notify webview of stream end so isStreaming is reset.
      // Without this, tool-call-only turns (where the agent produces no
      // text chunks) leave isStreaming=true forever, blocking subsequent
      // messages from appearing in the chat UI.
      cp?.pushStreamEnd(agentId, sessionId);

      if (stopReason) {
        cp?.postMessage({
          type: "session/turnEnded",
          agentId,
          sessionId,
          stopReason,
        });
      }
      // Debounce overview updates — rapid turnActive changes during a turn
      // can flood the webview with sessionOverview:state messages.
      if (turnActiveOverviewTimer) clearTimeout(turnActiveOverviewTimer);
      turnActiveOverviewTimer = setTimeout(() => {
        turnActiveOverviewTimer = null;
        const cp2 = getChatPanel();
        if (cp2) {
          const overview = orchestrator.getSessionOverview();
          cp2.postMessage({
            type: "sessionOverview:state",
            payload: overview,
          });
        }
      }, 200);
    }
  );

  // Push messages for ALL sessions — the fanout executor routes to the
  // correct (agentId, sessionId) pair, so no cross-tab leakage is possible.
  // The active-session guard was removed because pushUserMessage fires
  // *before* orchestrator.prompt() updates activeSessions, causing every
  // message to be dropped during the race window.
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
        acpMessageId: message.id,
        contentLen: message.content?.length,
      });
      cp.pushMessage(agentId, sessionId, message, info?.cwd);
      if (info) {
        cp.pushSessionInfo(agentId, sessionId, info);
      }
    }
  );

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
          messageCount: 0,
          tokenUsage: info.tokenUsage,
        };
        void historyStore.addEntry(entry);
      }
      deps.presenter.removeSession(agentId, sessionId);
      sendTabs();

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

  // NOTE: Do NOT call sendTabs() here. sendTabs() re-registers all sessions
  // in the presenter and rebuilds tabOrder in the webview, which causes
  // unpinned sessions to reappear in the multi-session view and overview.
  // The session status change is already reflected by pushSessionInfo +
  // the debounced sessionOverview:update emission from the orchestrator.
  orchestrator.on(
    "sessionCompleted",
    ({
      agentId,
      sessionId,
      title,
      stopReason,
    }: {
      agentId: string;
      sessionId: string;
      title: string;
      stopReason: import("@agentclientprotocol/sdk").StopReason;
    }) => {
      const cp = getChatPanel();
      const activeSessionId = orchestrator.getActiveSessionId(agentId);
      if (sessionId !== activeSessionId) {
        cp?.postMessage(
          deps.presenter.buildSessionCompleted(
            sessionId,
            agentId,
            title,
            stopReason
          )
        );
      }
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        cp?.pushSessionInfo(agentId, sessionId, info);
      }
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
