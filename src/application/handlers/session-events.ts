import * as vscode from "vscode";
import * as path from "path";
import type { SessionOrchestrator } from "../orchestrator";
import type { ChatMessage } from "../../domain/models/chat";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { FileWriteEvent } from "../../adapter/acp/client";
import { ChatPanel } from "../../infrastructure/vscode/vscode-ui/chatPanel";
import { ChatPresenter } from "../../infrastructure/vscode/vscode-ui/presenter";
import type { AgentStatusTracker } from "../../adapter/agent/status";
import type { HistoryEntry } from "../session/historyStore";

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

  // -------------------------------------------------------------------------
  // Agent lifecycle
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------
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

      // Working directory outside workspace warning
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

  // NOTE: Do NOT call sendTabs() here — would trigger infinite loop via
  // handleSetTabs → setActiveSession → sessionActiveChanged.
  // Do NOT call getSessionOverview() — emitDebounced covers it.
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

  // -------------------------------------------------------------------------
  // Turn lifecycle
  // -------------------------------------------------------------------------
  let turnActiveOverviewTimer: ReturnType<typeof setTimeout> | null = null;
  orchestrator.on(
    "sessionTurnActiveChanged",
    ({
      agentId,
      sessionId,
      active: _active,
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
      // Debounce overview updates — use fast path (no recentResponses)
      if (turnActiveOverviewTimer) clearTimeout(turnActiveOverviewTimer);
      turnActiveOverviewTimer = setTimeout(() => {
        turnActiveOverviewTimer = null;
        const cp2 = getChatPanel();
        if (cp2) {
          const overview = orchestrator.getSessionOverview({
            withRecentResponses: false,
          });
          cp2.postMessage({
            type: "sessionOverview:state",
            payload: overview,
          });
        }
      }, 200);
    }
  );

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------
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
        return;
      }
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      cp.pushMessage(agentId, sessionId, message, info?.cwd);
      if (info) {
        cp.pushSessionInfo(agentId, sessionId, info);
      }
      // Update status tracker for sidebar
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

  // NOTE: Do NOT call sendTabs() here — see comment in session-events.ts
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
    }
  );

  // -------------------------------------------------------------------------
  // Tool calls / session notifications (merged from wireMessageEvents)
  // -------------------------------------------------------------------------
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

      // Forward only relevant update types to webview for active session
      if (
        isActive &&
        update.sessionUpdate !== "agent_thought_chunk" &&
        update.sessionUpdate !== "agent_message_chunk"
      ) {
        cp?.pushSessionNotification(agentId, sessionId, notification);
      }

      // Update status tracker
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

      // Push updated sessionInfo for specific update types that change metadata
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

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------
  orchestrator.on(
    "sessionStreamStart",
    (event: { agentId: string; sessionId: string }) => {
      const cp = getChatPanel();
      if (cp) {
        cp.postMessage({
          type: "session/streamStart",
          agentId: event.sessionId,
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
    }) => {
      const cp = getChatPanel();
      if (cp) {
        cp.pushStreamChunk(
          event.agentId,
          event.sessionId,
          event.chunk,
          event.messageId
        );
      }
    }
  );

  // -------------------------------------------------------------------------
  // Available commands
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Context compression
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // File writes (per-session data needed on any tab for file edit summary)
  // -------------------------------------------------------------------------
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
}
