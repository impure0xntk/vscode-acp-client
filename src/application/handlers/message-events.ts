import type { SessionOrchestrator } from "../orchestrator";
import type { ChatPanel } from "../../infrastructure/vscode/vscode-ui/chatPanel";
import type { ChatPresenter } from "../../infrastructure/vscode/vscode-ui/presenter";
import type { AgentStatusTracker } from "../../adapter/agent/status";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { FileWriteEvent } from "../../adapter/acp/client";
import { getLogger } from "../../platform/backends";
import type { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";

const log = getLogger("handlers.message");

export interface SessionCompressionInfo {
  contextWindowMax: number;
  usedTokens: number;
}

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

  // Only push for the active session to prevent cross-tab leakage
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

      // Skip agent_thought_chunk — these are buffered in ProtocolHandler
      // and flushed as a single chunk to avoid overwhelming the webview.
      // Skip agent_message_chunk — text is buffered in ProtocolHandler
      // and flushed as a single ChatMessage via sessionMessage event
      // on turn completion.
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

  // Forward to webview for ALL sessions (not just the active one) so the
  // pipeline can aggregate edits per-session for the file edit summary.
  // Unlike sessionUpdate (text/thought/tool-call), file writes are per-
  // session data needed on any tab.  Dropping non-active writes caused
  // the file edit summary to silently disappear.
  orchestrator.on(
    "fileWrite",
    (event: FileWriteEvent) => {
      const { agentId, sessionId, path, content, originalContent, contentHash } = event;
      const cp = getChatPanel();
      cp?.pushFileWrite(agentId, sessionId, path, content, originalContent, contentHash);
    }
  );
}
