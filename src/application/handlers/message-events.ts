// ============================================================================
// Message Event Handlers — orchestrator message / notification → UI updates
// ============================================================================

import type { SessionOrchestrator } from "../orchestrator";
import type { ChatPanel } from "../../infrastructure/vscode/vscode-ui/chatPanel";
import type { ChatPresenter } from "../../infrastructure/vscode/vscode-ui/presenter";
import type { AgentStatusTracker } from "../../adapter/agent/status";
import type { TreeProvider } from "../../infrastructure/vscode/vscode-ui/tree";
import type { SessionNotification } from "@agentclientprotocol/sdk";

// ============================================================================
// Dependencies
// ============================================================================

export interface MessageEventDeps {
  orchestrator: SessionOrchestrator;
  /** Lazily resolve ChatPanel — it may be null when handlers are wired */
  getChatPanel: () => ChatPanel | null;
  presenter: ChatPresenter;
  statusTracker: AgentStatusTracker;
  treeProvider: TreeProvider;
  updateContext: () => void;
  sendTabs: () => void;
}

// ============================================================================
// Wire message / notification events
// ============================================================================

export function wireMessageEvents(deps: MessageEventDeps): void {
  const {
    orchestrator,
    getChatPanel,
    presenter,
    statusTracker,
    treeProvider,
    updateContext,
    sendTabs,
  } = deps;

  // -----------------------------------------------------------------------
  // Session commands updated (slash commands)
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionCommandsUpdated",
    ({ agentId, sessionId, commands }: { agentId: string; sessionId: string; commands: unknown[] }) => {
      console.log("[handlers/message-events] sessionCommandsUpdated", { agentId, sessionId, commands });
      getChatPanel()?.pushAvailableCommands(agentId, sessionId, commands);
    },
  );

  // -----------------------------------------------------------------------
  // Session update (raw SDK notification)
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionUpdate",
    (event: { agentId: string; sessionId: string; notification: SessionNotification }) => {
      const { agentId, sessionId, notification } = event;
      const update = notification.update;
      const cp = getChatPanel();

      // Forward raw SDK notification to the webview for UI rendering
      cp?.pushSessionNotification(agentId, sessionId, notification);

      statusTracker.updateSessionStatus(agentId, sessionId, {
        sessionId,
        title: orchestrator.getSessionInfo(agentId, sessionId)?.title ?? sessionId,
        status: "running",
        isActive: true,
        messageCount: orchestrator.getSessionInfo(agentId, sessionId)?.messages.length ?? 0,
        tokenUsage:
          orchestrator.getSessionInfo(agentId, sessionId)?.tokenUsage ?? {
            input: 0,
            output: 0,
            total: 0,
          },
      });
      treeProvider.refresh();
      updateContext();

      // Lightweight tab status update for streaming content
      if (
        update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk"
      ) {
        cp?.postMessage(
          presenter.buildTabUpdate(sessionId, agentId, { status: "running" }),
        );
      }

      // Full tab refresh for mode/config/tool/title changes
      if (
        update.sessionUpdate === "current_mode_update" ||
        update.sessionUpdate === "config_option_update" ||
        update.sessionUpdate === "tool_call" ||
        update.sessionUpdate === "tool_call_update" ||
        update.sessionUpdate === "session_info_update"
      ) {
        sendTabs();
      }

      // Lightweight usage update
      if (update.sessionUpdate === "usage_update") {
        const sessionInfo = orchestrator.getSessionInfo(agentId, sessionId);
        if (sessionInfo) {
          cp?.postMessage(
            presenter.buildSessionUsage(
              agentId,
              sessionId,
              sessionInfo.tokenUsage,
              sessionInfo.contextWindowMax,
            ),
          );
          sendTabs();
        }
      }
    },
  );
}
