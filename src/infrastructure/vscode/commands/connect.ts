import * as vscode from "vscode";
import type { AgentConfig } from "../../../application/session/types";
import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { AgentRegistry } from "../../../adapter/agent/registry";
import { ChatPanel } from "../vscode-ui/chatPanel";
import type { MiniChatPanel } from "../vscode-ui/miniChatPanel";
import type { ContextAttachmentDTO } from "../../../domain/models/chat";
import type { SuggestionItem } from "../../../adapter/context/symbol";
import type { PersistentHistoryStore } from "../../../application/session/persistentHistory";
import type { MeshOrchestrator } from "../../../domain/services/mesh-orchestrator";
import type { SupervisorOrchestrator } from "../../../domain/services/supervisor-orchestrator";

/**
 * Ensure the chat panel is visible. Creates it if it does not exist.
 */
export function ensureChatPanel(
  getChatPanel: () => ChatPanel | null,
  setChatPanel: (panel: ChatPanel) => void,
  extensionUri: vscode.Uri,
  sendTabs: () => void,
  wireEvents: (panel: ChatPanel | MiniChatPanel) => void,
  orchestrator: SessionOrchestrator
): void {
  if (!getChatPanel()) {
    const panel = ChatPanel.reveal(extensionUri);
    setChatPanel(panel);
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
  wireChatPanelEvents: (
    panel: ChatPanel | MiniChatPanel,
    orchestrator: SessionOrchestrator,
    sendTabs: () => void,
    resolveFile: (path: string, cwd?: string) => Promise<ContextAttachmentDTO>,
    resolveSelection: () => Promise<ContextAttachmentDTO | null>,
    resolveDiff: () => Promise<ContextAttachmentDTO | null>,
    searchFiles: (
      query: string,
      cwd?: string
    ) => Promise<
      { relativePath: string; name: string; absolutePath?: string }[]
    >,
    searchSymbols: (query: string) => Promise<SuggestionItem[]>,
    resolveSymbolByName: (name: string) => Promise<ContextAttachmentDTO>,
    persistentHistory?: PersistentHistoryStore,
    meshOrchestrator?: MeshOrchestrator,
    supervisorOrchestrator?: SupervisorOrchestrator
  ) => void,
  resolveFile: (path: string, cwd?: string) => Promise<ContextAttachmentDTO>,
  resolveSelection: () => Promise<ContextAttachmentDTO | null>,
  resolveDiff: () => Promise<ContextAttachmentDTO | null>,
  searchFiles: (
    query: string,
    cwd?: string
  ) => Promise<{ relativePath: string; name: string; absolutePath?: string }[]>,
  searchSymbols: (query: string) => Promise<SuggestionItem[]>,
  resolveSymbolByName: (name: string) => Promise<ContextAttachmentDTO>,
  persistentHistory: PersistentHistoryStore | null,
  meshOrchestrator: MeshOrchestrator | undefined,
  supervisorOrchestrator: SupervisorOrchestrator | undefined,
  pickConnectedAgent: (placeHolder: string) => Promise<string | undefined>,
  pickAgentByName: (name?: string) => Promise<AgentConfig | undefined>
): vscode.Disposable[] {
  const extensionUri = context.extensionUri;

  const openChatCmd = vscode.commands.registerCommand("acp.openChat", () => {
    ensureChatPanel(
      getChatPanel,
      setChatPanel,
      extensionUri,
      sendTabs,
      (panel) =>
        wireChatPanelEvents(
          panel,
          orchestrator,
          sendTabs,
          resolveFile,
          resolveSelection,
          resolveDiff,
          searchFiles,
          searchSymbols,
          resolveSymbolByName,
          persistentHistory ?? undefined,
          meshOrchestrator,
          supervisorOrchestrator
        ),
      orchestrator
    );
    setTimeout(() => {
      getChatPanel()?.focusComposer();
    }, 300);
  });

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

      if (orchestrator.getConnection(config.id)) {
        ensureChatPanel(
          getChatPanel,
          setChatPanel,
          extensionUri,
          sendTabs,
          (panel) =>
            wireChatPanelEvents(
              panel,
              orchestrator,
              sendTabs,
              resolveFile,
              resolveSelection,
              resolveDiff,
              searchFiles,
              searchSymbols,
              resolveSymbolByName,
              persistentHistory ?? undefined,
              meshOrchestrator,
              supervisorOrchestrator
            ),
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
          (panel) =>
            wireChatPanelEvents(
              panel,
              orchestrator,
              sendTabs,
              resolveFile,
              resolveSelection,
              resolveDiff,
              searchFiles,
              searchSymbols,
              resolveSymbolByName,
              persistentHistory ?? undefined,
              meshOrchestrator,
              supervisorOrchestrator
            ),
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

  const openUnifiedChatCmd = vscode.commands.registerCommand(
    "acp.openUnifiedChat",
    () => {
      ensureChatPanel(
        getChatPanel,
        setChatPanel,
        extensionUri,
        sendTabs,
        (panel) =>
          wireChatPanelEvents(
            panel,
            orchestrator,
            sendTabs,
            resolveFile,
            resolveSelection,
            resolveDiff,
            searchFiles,
            searchSymbols,
            resolveSymbolByName,
            persistentHistory ?? undefined,
            meshOrchestrator,
            supervisorOrchestrator
          ),
        orchestrator
      );
    }
  );

  return [openChatCmd, connectCmd, disconnectCmd, openUnifiedChatCmd];
}
