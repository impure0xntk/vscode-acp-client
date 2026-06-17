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
  // Session stream chunk — process agent output through MeshOrchestrator
  // to extract P2P markers before they reach the chat UI.
  // The sanitized chunk (markers stripped) replaces the original for display.
  // -----------------------------------------------------------------------
  orchestrator.on(
    "sessionStreamChunk",
    async (event: { agentId: string; sessionId: string; chunk: string }) => {
      const { agentId, sessionId, chunk } = event;
      let displayChunk = chunk;
      try {
        displayChunk = await meshOrchestrator.processAgentOutput(
          agentId,
          chunk
        );
      } catch (e) {
        log.warn("processAgentOutput failed", {
          agentId,
          sessionId,
          error: (e as Error).message,
        });
      }
      // Push the sanitized chunk (P2P markers removed) to the chat UI
      const cp = getChatPanel();
      if (cp && displayChunk) {
        cp.pushStreamChunk(agentId, sessionId, displayChunk);
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

      // Forward raw SDK notification only for the active session
      if (isActive) {
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
        (update.sessionUpdate === "agent_message_chunk" ||
          update.sessionUpdate === "agent_thought_chunk" ||
          update.sessionUpdate === "current_mode_update" ||
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
