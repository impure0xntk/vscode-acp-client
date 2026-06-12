import * as vscode from "vscode";
import * as path from "path";
import { SessionOrchestrator, AgentConfig, AutoConnectEntry } from "./orchestrator";
import { AgentRegistry } from "./agent/registry";
import { AgentStatusTracker } from "./agent/status";
import { SessionHistoryStore } from "./session/historyStore";
import { PersistentHistoryStore } from "./session/persistentHistory";
import { AgentStatusBar } from "./statusbar/manager";
import { ChatPanel } from "./providers/chatPanel";
import { ChatPresenter } from "./ui/presenter";
import { resolveFile as resolveFilePlatform, resolveSelection as resolveSelectionPlatform, resolveDiff as resolveDiffPlatform } from "./context/assembler";
import { searchFiles as searchFilesPlatform } from "./context/fileContext";
import { searchSymbols as searchSymbolsPlatform, resolveSymbolByName as resolveSymbolByNamePlatform } from "./context/symbolContext";
import { createAgentTreeProvider, type TreeProvider, type AgentTreeItem } from "./tree/provider";
import { ensureChatPanel, registerConnectCommands } from "./commands/connect";
import { registerSessionCommands } from "./commands/session";
import { wireChatPanelEvents } from "./commands/prompt";
import { wireSessionEvents, wireMessageEvents } from "./handlers";
import { VscodePlatform } from "./platform/adapters/vscode";
import type { PlatformAPI } from "./platform/platform";
import type { ContextAttachmentDTO } from "./types/chat";
import type { FileSystemAPI } from "./platform/filesystem";
import type { EditorAPI } from "./platform/editor";
import { TreeItem, TreeItemCollapsibleState } from "vscode";

// ============================================================================
// Global State
// ============================================================================

let extensionContext: vscode.ExtensionContext;
let platform: PlatformAPI;
let orchestrator: SessionOrchestrator;
let registry: AgentRegistry;
let statusTracker: AgentStatusTracker;
let historyStore: SessionHistoryStore;
let persistentHistory: PersistentHistoryStore | null = null;
let statusBar: AgentStatusBar;
let treeProvider: ReturnType<typeof createAgentTreeProvider>;
let chatPanel: ChatPanel | null = null;
const presenter = new ChatPresenter();

// ============================================================================
// Adaptor wrappers (Platform API → plain-function signatures for wireChatPanelEvents / registerSessionCommands)
// ============================================================================

function resolveFile(filePath: string, cwd?: string): Promise<ContextAttachmentDTO> {
  return resolveFilePlatform(platform.fs, filePath, cwd) as Promise<ContextAttachmentDTO>;
}

function resolveSelection(): Promise<ContextAttachmentDTO | null> {
  return resolveSelectionPlatform(platform.editor) as Promise<ContextAttachmentDTO | null>;
}

function resolveDiff(): Promise<ContextAttachmentDTO | null> {
  return resolveDiffPlatform(platform.editor) as Promise<ContextAttachmentDTO | null>;
}

function searchFiles(query: string, cwd?: string) {
  return searchFilesPlatform(platform.fs, query, cwd);
}

function searchSymbols(query: string) {
  return searchSymbolsPlatform(platform.editor, query);
}

function resolveSymbolByName(name: string): Promise<ContextAttachmentDTO> {
  return resolveSymbolByNamePlatform(platform.editor, platform.fs, name);
}

// TreeView adaptor: maps AgentTreeItem → vscode.TreeItem
function toTreeItem(item: AgentTreeItem): TreeItem {
  const vscodeItem = new vscode.TreeItem(
    item.label,
    item.collapsibleState === "none"
      ? TreeItemCollapsibleState.None
      : item.collapsibleState === "collapsed"
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.Expanded,
  );
  if (item.iconPath) vscodeItem.iconPath = new vscode.ThemeIcon(item.iconPath);
  if (item.description) vscodeItem.description = item.description;
  if (item.contextValue) vscodeItem.contextValue = item.contextValue;
  return vscodeItem;
}

// ============================================================================
// Helpers
// ============================================================================

function getChatPanel(): ChatPanel | null {
  return chatPanel;
}

function setChatPanel(panel: ChatPanel): void {
  chatPanel = panel;
}

function updateContext(): void {
  const agents = orchestrator.getAllAgents();
  const connected = agents.length > 0;
  const hasRunning = agents.some((a) => a.sessions.some((s) => s.status === "running"));
  void vscode.commands.executeCommand("setContext", "acp.connected", connected);
  void vscode.commands.executeCommand("setContext", "acp.hasAgents", connected);
  void vscode.commands.executeCommand("setContext", "acp.turnActive", hasRunning);
}

function sendTabsToChatPanel(): void {
  if (!chatPanel) return;

  presenter.setWorkspace(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, path: f.uri.fsPath })),
  );

  for (const agentStatus of orchestrator.getAllAgents()) {
    const config = registry.getAgent(agentStatus.agentId);
    presenter.upsertAgent(agentStatus.agentId, agentStatus.agentId, agentStatus.state, config?.color);
    presenter.setAgentInfo(agentStatus.agentId, orchestrator.getAgentInfo(agentStatus.agentId));

    for (const s of agentStatus.sessions) {
      const info = orchestrator.getSessionInfo(agentStatus.agentId, s.sessionId);
      presenter.upsertSession(s, agentStatus.agentId, info?.createdAt ?? new Date());
    }
  }

  const allTabs = Array.from(presenter.buildSetTabsMessage().tabs);
  let activeAgentId = [...orchestrator.getAllAgents()].find(
    (a) => orchestrator.getActiveSessionId(a.agentId)
  )?.agentId ?? null;
  let activeSessionId = activeAgentId
    ? orchestrator.getActiveSessionId(activeAgentId) ?? null
    : null;
  if (!activeSessionId && allTabs.length === 1) {
    activeSessionId = allTabs[0].sessionId;
    activeAgentId = allTabs[0].agentId;
    orchestrator.setActiveSession(activeAgentId, activeSessionId);
  }

  if (activeSessionId && activeAgentId) {
    presenter.setActiveSession(activeAgentId, activeSessionId);
  }

  chatPanel.postMessage(presenter.buildSetTabsMessage());
}

function wireChatPanelEventsLocal(): void {
  wireChatPanelEvents(
    chatPanel,
    orchestrator,
    sendTabsToChatPanel,
    resolveFile,
    resolveSelection,
    resolveDiff,
    searchFiles,
    searchSymbols,
    resolveSymbolByName,
    persistentHistory ?? undefined,
  );
}

async function pickAgentByName(name?: string): Promise<AgentConfig | undefined> {
  if (name) {
    const config = registry.getAgent(name);
    if (config) return config;
    void vscode.window.showErrorMessage(`Agent "${name}" not found in acp.agents configuration.`);
    return undefined;
  }
  const agents = registry.getAgents();
  if (agents.length === 0) {
    void vscode.window.showErrorMessage("ACP: No agents configured");
    return undefined;
  }
  if (agents.length === 1) return agents[0];
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({ label: `$(hubot) ${a.name}`, description: a.command, config: a })),
    { placeHolder: "Select agent to connect" },
  );
  return pick?.config;
}

async function pickConnectedAgent(placeHolder: string): Promise<string | undefined> {
  const agents = orchestrator.getAllAgents();
  if (agents.length === 0) {
    void vscode.window.showWarningMessage("ACP: No connected agents");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({ label: `$(hubot) ${a.agentId}`, description: a.state, agentId: a.agentId })),
    { placeHolder },
  );
  return pick?.agentId;
}

// ============================================================================
// Activation / Deactivation
// ============================================================================

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log("ACP Client extension is now active");
  extensionContext = context;

  // Create platform adapter
  platform = new VscodePlatform({ context });
  await platform.initialize();

  statusBar = new AgentStatusBar(platform.ui);
  registry = new AgentRegistry(platform);
  orchestrator = new SessionOrchestrator({ ui: platform.ui, fs: platform.fs });
  statusTracker = new AgentStatusTracker();
  historyStore = new SessionHistoryStore(platform.context.globalState);

  persistentHistory = new PersistentHistoryStore({
    maxAgeDays: 90,
    maxSessions: 1000,
    maxMessagesPerSession: 10000,
  });
  await persistentHistory.open();
  orchestrator.setHistoryStore(persistentHistory);
  orchestrator.setSessionHistoryStore(historyStore);

  registerCommands(context);
  updateContext();

  treeProvider = createAgentTreeProvider(orchestrator, platform.ui);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("acp.agentTree", {
      onDidChangeTreeData: treeProvider.onDidChangeTreeData as unknown as vscode.Event<AgentTreeItem | undefined>,
      getTreeItem(element: AgentTreeItem): TreeItem {
        return toTreeItem(element);
      },
      getChildren(element?: AgentTreeItem): AgentTreeItem[] | Thenable<AgentTreeItem[]> {
        return treeProvider.getChildren(element);
      },
    }),
  );

  wireOrchestratorEvents();

  for (const agent of registry.getAutoConnectAgents()) {
    for (const entry of agent.autoConnect ?? []) {
      await cmdConnect(agent, entry, agent.openChat !== false);
    }
  }
}

export function deactivate(): void {
  orchestrator.dispose();
  persistentHistory?.close();
  statusTracker.dispose();
  statusBar.dispose();
  void platform?.dispose();
  console.log("ACP Client extension is now deactivated");
}

// ============================================================================
// Orchestrator Events → UI updates (delegated to handlers/)
// ============================================================================

function wireOrchestratorEvents(): void {
  wireSessionEvents({
    orchestrator,
    getChatPanel,
    presenter,
    statusTracker,
    statusBar,
    treeProvider,
    historyStore,
    updateContext,
    sendTabs: sendTabsToChatPanel,
  });

  wireMessageEvents({
    orchestrator,
    getChatPanel,
    presenter,
    statusTracker,
    treeProvider,
    updateContext,
    sendTabs: sendTabsToChatPanel,
  });
}

// ============================================================================
// Command Registration
// ============================================================================

function registerCommands(context: vscode.ExtensionContext): void {
  const connectDisposables = registerConnectCommands(
    context,
    orchestrator,
    registry,
    getChatPanel,
    setChatPanel,
    sendTabsToChatPanel,
    wireChatPanelEventsLocal,
    pickConnectedAgent,
    pickAgentByName,
  );

  const sessionDisposables = registerSessionCommands(
    orchestrator,
    registry,
    getChatPanel,
    () => ensureChatPanel(
      getChatPanel,
      setChatPanel,
      context.extensionUri,
      sendTabsToChatPanel,
      wireChatPanelEventsLocal,
      orchestrator,
    ),
    pickConnectedAgent,
    historyStore,
    resolveFile,
    resolveSelection,
    resolveDiff,
  );

  const setModeCmd = vscode.commands.registerCommand("acp.setMode", () => {
    void vscode.window.showWarningMessage("ACP: setMode not yet implemented");
  });
  const showTrafficCmd = vscode.commands.registerCommand("acp.showTraffic", () => {
    void vscode.window.showWarningMessage("ACP: showTraffic not yet implemented");
  });

  for (const d of [...connectDisposables, ...sessionDisposables, setModeCmd, showTrafficCmd]) {
    context.subscriptions.push(d);
  }
}

// ============================================================================
// cmdConnect — connect + optional auto-open chat
// ============================================================================

async function cmdConnect(
  agentConfig?: AgentConfig | string,
  entry?: AutoConnectEntry,
  autoOpenChat: boolean = true,
): Promise<void> {
  let config: AgentConfig;
  if (typeof agentConfig === "string" || !agentConfig) {
    const name = typeof agentConfig === "string" ? agentConfig : undefined;
    const resolved = await pickAgentByName(name);
    if (!resolved) return;
    config = resolved;
  } else {
    config = agentConfig;
  }

  try {
    await orchestrator.connectAgent(config.id, config);

    const fallbackWs = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    let ws: string;
    if (entry?.workspace) {
      const p = entry.workspace;
      ws = path.isAbsolute(p) ? p : path.resolve(fallbackWs, p);
    } else {
      ws = fallbackWs;
    }

    const sessionId = await orchestrator.createSession(config.id, ws);

    if (entry?.sessionName) {
      const info = orchestrator.getSessionInfo(config.id, sessionId);
      if (info) info.title = entry.sessionName;
    }

    if (autoOpenChat) {
      ensureChatPanel(
        getChatPanel,
        setChatPanel,
        extensionContext.extensionUri,
        sendTabsToChatPanel,
        wireChatPanelEventsLocal,
        orchestrator,
      );
      const info = orchestrator.getSessionInfo(config.id, sessionId);
      if (info) getChatPanel()?.setActiveSession(config.id, sessionId, info);
    }
    void vscode.window.showInformationMessage(`ACP: Connected to ${config.name}`);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ACP: Connection failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
