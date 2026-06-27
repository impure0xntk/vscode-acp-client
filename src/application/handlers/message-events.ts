// ============================================================================
// Message Event Handlers — orchestrator message / notification → UI updates
// ============================================================================

import type { SessionOrchestrator } from "../orchestrator";
import type { ChatPanel } from "../../infrastructure/vscode/vscode-ui/chatPanel";
import type { ChatPresenter } from "../../infrastructure/vscode/vscode-ui/presenter";
import type { AgentStatusTracker } from "../../adapter/agent/status";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { FileWriteEvent } from "../../adapter/acp/client";
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
  // Session stream chunk — forward buffered thought text to webview.
  // ProtocolHandler.flushThoughts() emits this when agent_message_chunk
  // arrives or when the turn ends. The webview creates a new agent message
  // so it appears as an intermediate step in the pipeline.
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionStreamChunk",
    (event: { agentId: string; sessionId: string; chunk: string }) => {
      const { agentId, sessionId, chunk } = event;
      const cp = getChatPanel();
      if (cp) {
        cp.pushStreamChunk(agentId, sessionId, chunk);
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
      // Skip agent_message_chunk — text is buffered in ProtocolHandler
      // and flushed as a single ChatMessage via sessionMessage event
      // on turn completion (batched delivery to reduce webview overhead).
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
          ?.tokenUsage ?? {
          input: 0,
          output: 0,
          total: 0,
        },
      });
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

  // -----------------------------------------------------------------------
  // File write event — agent wrote a file via ACP fs/write_text_file.
  // Forward to webview (active session only) so it can aggregate edits
  // per turn for the file edit summary displayed below the final response.
  // -----------------------------------------------------------------------
  orchestrator.on(
    "fileWrite",
    (event: FileWriteEvent) => {
      const { agentId, sessionId, path, content, originalContent } = event;
      const activeSessionId = orchestrator.getActiveSessionId(agentId);
      if (sessionId !== activeSessionId) return;
      const cp = getChatPanel();
      cp?.pushFileWrite(agentId, sessionId, path, content, originalContent);
    }
  );
}
