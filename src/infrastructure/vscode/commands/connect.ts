import * as vscode from "vscode";
import type {
  SessionOrchestrator,
  AgentConfig,
} from "../../../application/orchestrator";
import type { AgentRegistry } from "../../../adapter/agent/registry";
import { ChatPanel } from "../vscode-ui/chatPanel";

/**
 * Ensure the chat panel is visible. Creates it if it does not exist.
 */
export function ensureChatPanel(
  getChatPanel: () => ChatPanel | null,
  setChatPanel: (panel: ChatPanel) => void,
  extensionUri: vscode.Uri,
  sendTabs: () => void,
  wireEvents: () => void,
  orchestrator: SessionOrchestrator
): void {
  if (!getChatPanel()) {
    const panel = ChatPanel.reveal(extensionUri);
    setChatPanel(panel);
    // Wire up the session commands callback before other event wiring
    panel._onGetSessionCommands = (agentId: string, sessionId: string) => {
      type WithCommands = {
        getSessionCommands: (agentId: string, sessionId: string) => unknown[];
      };
      return (orchestrator as unknown as WithCommands).getSessionCommands(
        agentId,
        sessionId
      );
    };
    wireEvents();
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
    getChatPanel()!.reveal();
  }
}

export function registerConnectCommands(
  context: vscode.ExtensionContext,
  orchestrator: SessionOrchestrator,
  registry: AgentRegistry,
  getChatPanel: () => ChatPanel | null,
  setChatPanel: (panel: ChatPanel) => void,
  sendTabs: () => void,
  wireChatPanelEvents: () => void,
  pickConnectedAgent: (placeHolder: string) => Promise<string | undefined>,
  pickAgentByName: (name?: string) => Promise<AgentConfig | undefined>
): vscode.Disposable[] {
  const extensionUri = context.extensionUri;

  // acp.openChat command
  const openChatCmd = vscode.commands.registerCommand("acp.openChat", () => {
    ensureChatPanel(
      getChatPanel,
      setChatPanel,
      extensionUri,
      sendTabs,
      wireChatPanelEvents,
      orchestrator
    );
  });

  // acp.connect command
  const connectCmd = vscode.commands.registerCommand(
    "acp.connect",
    async (agentConfig?: AgentConfig | string) => {
      let config: AgentConfig;

      if (typeof agentConfig === "string" || !agentConfig) {
        const name = typeof agentConfig === "string" ? agentConfig : undefined;
        const resolved = await pickAgentByName(name);
        if (!resolved) return;
        config = resolved;
      } else {
        config = agentConfig;
      }

      // Skip if already connected
      if (orchestrator.getConnection(config.id)) {
        ensureChatPanel(
          getChatPanel,
          setChatPanel,
          extensionUri,
          sendTabs,
          wireChatPanelEvents,
          orchestrator
        );
        const activeSessId = orchestrator.getActiveSessionId(config.id);
        if (activeSessId) {
          const info = orchestrator.getSessionInfo(config.id, activeSessId);
          if (info)
            getChatPanel()?.setActiveSession(config.id, activeSessId, info);
        }
        void vscode.window.showInformationMessage(
          `ACP: ${config.name} is already connected`
        );
        return;
      }

      try {
        await orchestrator.connectAgent(config.id, config);

        const workspaceRoot =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const sessionId = await orchestrator.createSession(
          config.id,
          workspaceRoot
        );

        ensureChatPanel(
          getChatPanel,
          setChatPanel,
          extensionUri,
          sendTabs,
          wireChatPanelEvents,
          orchestrator
        );
        const info = orchestrator.getSessionInfo(config.id, sessionId);
        if (info) {
          getChatPanel()?.setActiveSession(config.id, sessionId, info);
        }

        void vscode.window.showInformationMessage(
          `ACP: Connected to ${config.name}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`ACP: Connection failed — ${msg}`);
      }
    }
  );

  // acp.disconnect command
  const disconnectCmd = vscode.commands.registerCommand(
    "acp.disconnect",
    async () => {
      const agents = orchestrator.getAllAgents();
      if (agents.length === 0) {
        void vscode.window.showWarningMessage("ACP: No active connection");
        return;
      }

      if (agents.length === 1) {
        const agentId = agents[0].agentId;
        await orchestrator.disconnectAgent(agentId);
        return;
      }

      const agentId = await pickConnectedAgent("Select agent to disconnect");
      if (!agentId) return;
      await orchestrator.disconnectAgent(agentId);
    }
  );

  return [openChatCmd, connectCmd, disconnectCmd];
}
