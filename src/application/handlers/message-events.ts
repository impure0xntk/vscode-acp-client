// ============================================================================
// Message Event Handlers — orchestrator message / notification → UI updates
// ============================================================================

import type { SessionOrchestrator } from "../orchestrator";
import type { ChatPanel } from "../../infrastructure/vscode/vscode-ui/chatPanel";
import type { ChatPresenter } from "../../infrastructure/vscode/vscode-ui/presenter";
import type { AgentStatusTracker } from "../../adapter/agent/status";
import type { TreeProvider } from "../../infrastructure/vscode/vscode-ui/tree";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { getLogger } from "../../platform/backends";
import type { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";

const log = getLogger("handlers.message");

// ============================================================================
// Session context compression payload
// ============================================================================

export interface SessionCompressionInfo {
  contextWindowMax: number;
  usedTokens: number;
}

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
  /** MeshOrchestrator for P2P message extraction from agent output */
  meshOrchestrator: MeshOrchestrator;
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
    meshOrchestrator,
  } = deps;

  // -----------------------------------------------------------------------
  // Session commands updated (slash commands)
  // Only push for the active session to prevent cross-tab leakage
  // -----------------------------------------------------------------------
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
      log.debug("sessionCommandsUpdated", {
        agentId,
        sessionId,
        commandCount: (commands as unknown[]).length,
      });
      getChatPanel()?.postMessage({
        type: "session/commands",
        agentId,
        sessionId,
        commands,
      });
    }
  );

  // -----------------------------------------------------------------------
  // Session message (batched) — emitted by ProtocolHandler.flushPendingAgentText
  // after turn completion. Delivers the full agent response as a single
  // ChatMessage, reducing extension-host ↔ webview message frequency.
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionMessage",
    (event: { agentId: string; sessionId: string; message: import("../../domain/models/chat").ChatMessage }) => {
      const { agentId, sessionId, message } = event;
      const cp = getChatPanel();
      if (cp) {
        cp.pushMessage(agentId, sessionId, message);
        presenter.updateTabFromMessage(agentId, sessionId);
      }
      const sessionInfo = orchestrator.getSessionInfo(agentId, sessionId);
      statusTracker.updateSessionStatus(agentId, sessionId, {
        sessionId,
        title: sessionInfo?.title ?? sessionId,
        status: "idle",
        isActive: true,
        messageCount: sessionInfo ? sessionInfo.messages.length : 0,
        tokenUsage: sessionInfo?.tokenUsage ?? { input: 0, output: 0, total: 0 },
      });
      treeProvider.refresh();
      updateContext();
    }
  );

  // -----------------------------------------------------------------------
  // Session stream start — signal turn start to webview.
  // With batched delivery, this signals the start of a new turn so the
  // webview can prepare for a single message append (not per-chunk).
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionStreamStart",
    (event: { agentId: string; sessionId: string }) => {
      const { agentId, sessionId } = event;
      const cp = getChatPanel();
      if (cp) {
        cp.postMessage({ type: "session/streamStart", agentId, sessionId });
      }
    }
  );

  // -----------------------------------------------------------------------
  // Session update (raw SDK notification)
  // -----------------------------------------------------------------------
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

      // Forward raw SDK notification only for the active session.
      // Skip agent_thought_chunk — these are buffered in ProtocolHandler
      // and flushed as a single chunk to avoid overwhelming the webview.
      // Skip tool_call / tool_call_update — tool calls are flushed as
      // session/message via flushPendingToolCalls → appendMessage to
      // avoid duplicate delivery (both session/notification and
      // session/message paths).
      // Skip agent_message_chunk — text is buffered in ProtocolHandler
      // and flushed as a single ChatMessage via sessionMessage event
      // on turn completion (batched delivery to reduce webview overhead).
      if (
        isActive &&
        update.sessionUpdate !== "agent_thought_chunk" &&
        update.sessionUpdate !== "tool_call" &&
        update.sessionUpdate !== "tool_call_update" &&
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
          ?.tokenUsage ?? {
          input: 0,
          output: 0,
          total: 0,
        },
      });
      treeProvider.refresh();
      updateContext();

      // Push updated sessionInfo only for the active session
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

  // -----------------------------------------------------------------------
  // Context compression detected (from orchestrator)
  // -----------------------------------------------------------------------
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
}
