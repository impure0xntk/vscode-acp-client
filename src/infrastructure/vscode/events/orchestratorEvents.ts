import * as vscode from "vscode";
import * as path from "path";
import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { ChatMessage } from "../../../domain/models/chat";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { FileWriteEvent } from "../../../adapter/acp/client";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type { ChatPresenter } from "../vscode-ui/presenter";
import type { AgentStatusTracker } from "../../../adapter/agent/status";
import type { HistoryEntry } from "../../../application/session/historyStore";

export interface OrchestratorEventDeps {
  orchestrator: SessionOrchestrator;
  getChatPanel: () => ChatPanel | null;
  presenter: ChatPresenter;
  statusTracker: AgentStatusTracker;
  historyStore: { addEntry(entry: HistoryEntry): Promise<void> | void };
  updateContext: () => void;
  sendTabs: () => void;
}

/**
 * Wire lifecycle events from SessionOrchestrator to the webview.
 * Moved here from extension.ts's wireOrchestratorEvents() to keep
 * extension.ts thin.
 */
export function wireOrchestratorEvents(deps: OrchestratorEventDeps): void {
  const {
    orchestrator,
    getChatPanel,
    statusTracker,
    historyStore,
    updateContext,
    sendTabs,
  } = deps;

  // -- Agent lifecycle --
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

  // -- Session lifecycle --
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

  // -- Turn lifecycle --
  let turnActiveOverviewTimer: ReturnType<typeof setTimeout> | null = null;
  orchestrator.on(
    "sessionTurnActiveChanged",
    ({
      agentId,
      sessionId,
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
      cp?.pushStreamEnd(agentId, sessionId);
      if (stopReason) {
        cp?.postMessage({
          type: "session/turnEnded",
          agentId,
          sessionId,
          stopReason,
        });
      }
      if (turnActiveOverviewTimer) clearTimeout(turnActiveOverviewTimer);
      turnActiveOverviewTimer = setTimeout(() => {
        turnActiveOverviewTimer = null;
        const cp2 = getChatPanel();
        if (cp2) {
          const overview = orchestrator.getSessionOverview({
            withRecentResponses: false,
          });
          cp2.postMessage({ type: "sessionOverview:state", payload: overview });
        }
      }, 200);
    }
  );

  // -- Messages --
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
      if (!cp) return;
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      cp.pushMessage(agentId, sessionId, message, info?.cwd);
      if (info) {
        cp.pushSessionInfo(agentId, sessionId, info);
      }
      statusTracker.updateSessionStatus(agentId, sessionId, {
        sessionId,
        title: info?.title ?? sessionId,
        status: "idle",
        isActive: true,
        messageCount: info ? info.messages.length : 0,
        tokenUsage: info?.tokenUsage ?? { input: 0, output: 0, total: 0 },
      });
      updateContext();
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
    }
  );

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
      if (info) cp?.pushSessionInfo(agentId, sessionId, info);
    }
  );

  // -- Tool calls / session notifications --
  orchestrator.on(
    "sessionUpdate",
    (event: {
      agentId: string;
      sessionId: string;
      notification: SessionNotification;
    }) => {
      const { agentId, sessionId, notification } = event;
      const update = notification.update;
      const cp = getChatPanel();
      const activeSessionId = orchestrator.getActiveSessionId(agentId);
      const isActive = sessionId === activeSessionId;

      if (
        isActive &&
        update.sessionUpdate !== "agent_thought_chunk" &&
        update.sessionUpdate !== "agent_message_chunk"
      ) {
        cp?.pushSessionNotification(agentId, sessionId, notification);
      }

      statusTracker.updateSessionStatus(agentId, sessionId, {
        sessionId,
        title:
          orchestrator.getSessionInfo(agentId, sessionId)?.title ?? sessionId,
        status: "running",
        isActive: true,
        messageCount: 0,
        tokenUsage: orchestrator.getSessionInfo(agentId, sessionId)
          ?.tokenUsage ?? { input: 0, output: 0, total: 0 },
      });
      updateContext();

      if (
        isActive &&
        (update.sessionUpdate === "current_mode_update" ||
          update.sessionUpdate === "config_option_update" ||
          update.sessionUpdate === "tool_call" ||
          update.sessionUpdate === "tool_call_update" ||
          update.sessionUpdate === "session_info_update" ||
          update.sessionUpdate === "usage_update")
      ) {
        const sessionInfo = orchestrator.getSessionInfo(agentId, sessionId);
        if (sessionInfo) {
          cp?.pushSessionInfo(agentId, sessionId, sessionInfo);
        }
      }
    }
  );

  // -- Streaming --
  orchestrator.on(
    "sessionStreamStart",
    (event: { agentId: string; sessionId: string }) => {
      const cp = getChatPanel();
      if (cp) {
        cp.postMessage({
          type: "session/streamStart",
          agentId: event.agentId,
          sessionId: event.sessionId,
        });
      }
    }
  );

  orchestrator.on(
    "sessionStreamChunk",
    (event: {
      agentId: string;
      sessionId: string;
      chunk: string;
      messageId?: string;
      sessionUpdate?: string;
    }) => {
      const { agentId, sessionId, chunk, messageId, sessionUpdate } = event;
      const cp = getChatPanel();
      if (cp) {
        cp.pushStreamChunk(agentId, sessionId, chunk, messageId, sessionUpdate);
      }
    }
  );

  // -- Available commands --
  orchestrator.on(
    "sessionCommandsUpdated",
    ({
      agentId,
      sessionId,
      commands,
    }: {
      agentId: string;
      sessionId: string;
      commands: unknown[];
    }) => {
      const activeSessId = orchestrator.getActiveSessionId(agentId);
      if (sessionId !== activeSessId) return;
      getChatPanel()?.postMessage({
        type: "session/commands",
        agentId,
        sessionId,
        commands,
      });
    }
  );

  // -- Context compression --
  orchestrator.on(
    "sessionContextCompressed",
    (event: {
      agentId: string;
      sessionId: string;
      contextWindowMax: number;
      usedBefore: number;
      usedAfter: number;
    }) => {
      const { agentId, sessionId, contextWindowMax, usedBefore, usedAfter } =
        event;
      const activeSessionId = orchestrator.getActiveSessionId(agentId);
      if (sessionId !== activeSessionId) return;
      const cp = getChatPanel();
      cp?.pushSessionCompression(agentId, sessionId, {
        contextWindowMax,
        usedTokens: usedAfter,
        usedBefore,
      });
    }
  );

  // -- File writes --
  orchestrator.on("fileWrite", (event: FileWriteEvent) => {
    const { agentId, sessionId, path, content, originalContent, contentHash } =
      event;
    const cp = getChatPanel();
    cp?.pushFileWrite(
      agentId,
      sessionId,
      path,
      content,
      originalContent,
      contentHash
    );
  });

  // -- Overview update (debounced internally by SessionOrchestrator) --
  orchestrator.on("sessionOverview:update", (overview) => {
    const cp = getChatPanel();
    if (!cp) return;
    cp.postMessage({ type: "sessionOverview:state", payload: overview });
  });

  // -- Prompt queue events --
  orchestrator.on("promptQueued", ({ agentId, sessionId, entry }) => {
    const cp = getChatPanel();
    if (!cp) return;
    cp.postMessage({ type: "queue:added", agentId, sessionId, entry });
  });

  orchestrator.on("promptDequeued", ({ agentId, sessionId }) => {
    const cp = getChatPanel();
    if (!cp) return;
    cp.postMessage({ type: "queue:dequeued", agentId, sessionId });
  });

  orchestrator.on("promptQueueUpdated", ({ agentId, sessionId, queue }) => {
    const cp = getChatPanel();
    if (!cp) return;
    cp.postMessage({ type: "queue:updated", agentId, sessionId, queue });
  });

  orchestrator.on(
    "sessionTitleChanged",
    ({ agentId, sessionId, title }) => {
      const cp = getChatPanel();
      if (!cp) return;
      cp.postMessage({ type: "session/title", agentId, sessionId, title });
      sendTabs();
    }
  );

  orchestrator.on("sessionPinned", ({ agentId, sessionId }) => {
    const cp = getChatPanel();
    if (!cp) return;
    cp.postMessage({ type: "session.pinned", agentId, sessionId });
  });

  orchestrator.on("sessionUnpinned", ({ agentId, sessionId }) => {
    const cp = getChatPanel();
    if (!cp) return;
    cp.postMessage({ type: "session.unpinned", agentId, sessionId });
  });

  orchestrator.on(
    "sessionContextCompressed",
    ({ agentId, sessionId, contextWindowMax, usedBefore, usedAfter }) => {
      orchestrator.handleContextCompression(
        agentId,
        sessionId,
        contextWindowMax,
        usedBefore,
        usedAfter
      );
    }
  );
}
