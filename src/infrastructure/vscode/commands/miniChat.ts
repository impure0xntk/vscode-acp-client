import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import { MiniChatPanel } from "../vscode-ui/miniChatPanel";

/**
 * Ensure the MiniChat panel is visible. Creates it if it does not exist.
 * Shares session state with the full chat panel via the same orchestrator
 * (FR-7/FR-10), but is an independent webview instance (FR-15).
 */
export function ensureMiniChatPanel(
  extensionUri: vscode.Uri,
  orchestrator: SessionOrchestrator,
  wireEvents: (panel: MiniChatPanel) => void,
  sendTabs: () => void
): MiniChatPanel {
  let panel = MiniChatPanel.current;
  if (!panel) {
    panel = MiniChatPanel.reveal(extensionUri);
    panel._onGetSessionCommands = (agentId: string, sessionId: string) => {
      type WithCommands = {
        getSessionCommands: (agentId: string, sessionId: string) => unknown[];
      };
      return (orchestrator as unknown as WithCommands).getSessionCommands(
        agentId,
        sessionId
      );
    };
    wireEvents(panel);
    sendTabs();
    const agents = orchestrator.getAllAgents();
    if (agents.length > 0) {
      const active = agents[0];
      const activeSess =
        active.sessions.find(
          (s) => orchestrator.getActiveSessionId(active.agentId) === s.sessionId
        ) ?? active.sessions[0];
      if (activeSess) {
        const info = orchestrator.getSessionInfo(
          active.agentId,
          activeSess.sessionId
        );
        if (info) {
          panel.setActiveSession(active.agentId, activeSess.sessionId, info);
        }
      }
    }
  } else {
    panel.reveal();
  }
  return panel;
}

export function registerMiniChatCommands(
  context: vscode.ExtensionContext,
  orchestrator: SessionOrchestrator,
  sendTabs: () => void,
  wireEvents: (panel: MiniChatPanel) => void
): vscode.Disposable[] {
  const extensionUri = context.extensionUri;

  const openMiniChatCmd = vscode.commands.registerCommand(
    "acp.openMiniChat",
    () => {
      ensureMiniChatPanel(extensionUri, orchestrator, wireEvents, sendTabs);
      setTimeout(() => {
        MiniChatPanel.current?.focusComposer();
      }, 300);
    }
  );

  return [openMiniChatCmd];
}

// Re-export the ChatPanel type alias so callers can pass getChatPanel.
export type { ChatPanel };
