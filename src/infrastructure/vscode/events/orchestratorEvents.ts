import * as vscode from "vscode";
import * as path from "path";
import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { ChatMessage } from "../../../domain/models/chat";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { FileWriteEvent } from "../../../adapter/acp/client";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import { SessionStateBridge } from "../vscode-ui/sessionStateBridge";
import type { ChatPresenter } from "../vscode-ui/presenter";
import type { AgentStatusTracker } from "../../../adapter/agent/status";
import type { HistoryEntry } from "../../../application/session/historyStore";
import type { DiagnosticBackend } from "../../../platform/diagnostics";

export interface OrchestratorEventDeps {
  orchestrator: SessionOrchestrator;
  /**
   * Session-state bridge — all panels receive event broadcasts through this.
   * Replaces the old getChatPanel() + broadcast() pattern.
   */
  bridge: SessionStateBridge;
  getChatPanel: () => ChatPanel | null;
  presenter: ChatPresenter;
  statusTracker: AgentStatusTracker;
  historyStore: { addEntry(entry: HistoryEntry): Promise<void> | void };
  diagnostics: DiagnosticBackend;
  updateContext: () => void;
  sendTabs: () => void;
}

/**
 * Wire lifecycle events from SessionOrchestrator to all registered UI panels
 * via the SessionStateBridge.
 *
 * The bridge dispatches every `push*` / `postMessage` call to all registered
 * targets (ChatPanel, MiniChatPanel, future panels) without coupling this
 * module to specific panel implementations.
 */
export function wireOrchestratorEvents(deps: OrchestratorEventDeps): void {
  const {
    orchestrator,
    bridge,
    getChatPanel,
    statusTracker,
    historyStore,
    diagnostics,
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
      bridge.setAgentInfo(agentId, agentInfo);
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
        bridge.pushSessionInfo(agentId, sessionId, info);
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
        bridge.setActiveSession(agentId, sessionId, info);
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
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      if (info) {
        bridge.pushSessionInfo(agentId, sessionId, info);
        bridge.pushTurnActive(agentId, sessionId, info.status === "running");
      }
      bridge.pushStreamEnd(agentId, sessionId);
      if (stopReason) {
        bridge.postMessage({
          type: "session/turnEnded",
          agentId,
          sessionId,
          stopReason,
        });
      }
      if (turnActiveOverviewTimer) clearTimeout(turnActiveOverviewTimer);
      turnActiveOverviewTimer = setTimeout(() => {
        turnActiveOverviewTimer = null;
        const overview = orchestrator.getSessionOverview({
          withRecentResponses: false,
        });
        bridge.postMessage({
          type: "sessionOverview:state",
          payload: overview,
        });
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
      const info = orchestrator.getSessionInfo(agentId, sessionId);
      bridge.pushMessage(agentId, sessionId, message, info?.cwd);
      if (info) {
        bridge.pushSessionInfo(agentId, sessionId, info);
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
      const activeSessionId = orchestrator.getActiveSessionId(agentId);
      if (sessionId !== activeSessionId) {
        bridge.postMessage(
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
        bridge.pushSessionInfo(agentId, sessionId, info);
      }
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
      const activeSessionId = orchestrator.getActiveSessionId(agentId);
      const isActive = sessionId === activeSessionId;

      if (
        isActive &&
        update.sessionUpdate !== "agent_thought_chunk" &&
        update.sessionUpdate !== "agent_message_chunk"
      ) {
        bridge.pushSessionNotification(agentId, sessionId, notification);
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
          bridge.pushSessionInfo(agentId, sessionId, sessionInfo);
        }
      }
    }
  );

  // -- Streaming --
  orchestrator.on(
    "sessionStreamStart",
    (event: { agentId: string; sessionId: string }) => {
      bridge.postMessage({
        type: "session/streamStart",
        agentId: event.agentId,
        sessionId: event.sessionId,
      });
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
      bridge.pushStreamChunk(
        event.agentId,
        event.sessionId,
        event.chunk,
        event.messageId,
        event.sessionUpdate
      );
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
      bridge.pushAvailableCommands(agentId, sessionId, commands);
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
      bridge.pushSessionCompression(agentId, sessionId, {
        contextWindowMax,
        usedTokens: usedAfter,
        usedBefore,
      });
    }
  );

  // -- File writes --
  orchestrator.on("fileWrite", async (event: FileWriteEvent) => {
    const {
      agentId,
      sessionId,
      path: filePath,
      content,
      originalContent,
      contentHash,
    } = event;
    bridge.pushFileWrite(
      agentId,
      sessionId,
      filePath,
      content,
      originalContent,
      contentHash
    );

    // Trigger diagnostics refresh for the modified file.
    void diagnostics.refreshDiagnostics(filePath);
  });

  // -- Overview update (debounced internally by SessionOrchestrator) --
  orchestrator.on("sessionOverview:update", (overview) => {
    bridge.postMessage({ type: "sessionOverview:state", payload: overview });
  });

  // -- Prompt queue events --
  orchestrator.on("promptQueued", ({ agentId, sessionId, entry }) => {
    bridge.postMessage({
      type: "queue:added",
      agentId,
      sessionId,
      entry,
    });
  });

  orchestrator.on("promptDequeued", ({ agentId, sessionId }) => {
    bridge.postMessage({
      type: "queue:dequeued",
      agentId,
      sessionId,
    });
  });

  orchestrator.on("promptQueueUpdated", ({ agentId, sessionId, queue }) => {
    bridge.postMessage({
      type: "queue:updated",
      agentId,
      sessionId,
      queue,
    });
  });

  orchestrator.on(
    "sessionTitleChanged",
    ({ agentId, sessionId, title }) => {
      bridge.postMessage({
        type: "session/title",
        agentId,
        sessionId,
        title,
      });
      sendTabs();
    }
  );

  orchestrator.on("sessionPinned", ({ agentId, sessionId }) => {
    bridge.postMessage({ type: "session.pinned", agentId, sessionId });
  });

  orchestrator.on("sessionUnpinned", ({ agentId, sessionId }) => {
    bridge.postMessage({ type: "session.unpinned", agentId, sessionId });
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
