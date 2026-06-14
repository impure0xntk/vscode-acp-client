import * as vscode from "vscode";
import * as path from "path";
import { getLogger } from "../../platform/backends";

const log = getLogger("extension");
import {
  SessionOrchestrator,
  AgentConfig,
  AutoConnectEntry,
} from "../../application/orchestrator";
import { AgentRegistry } from "../../adapter/agent/registry";
import { AgentStatusTracker } from "../../adapter/agent/status";
import { SessionHistoryStore } from "../../application/session/historyStore";
import { PersistentHistoryStore } from "../../application/session/persistentHistory";
import { AgentStatusBar } from "./vscode-ui/statusbar";
import { ChatPanel } from "./vscode-ui/chatPanel";
import { ChatPresenter } from "./vscode-ui/presenter";
import {
  resolveFile as resolveFilePlatform,
  resolveSelection as resolveSelectionPlatform,
  resolveDiff as resolveDiffPlatform,
} from "../../adapter/context/assembler";
import { searchFiles as searchFilesPlatform } from "../../adapter/context/file";
import {
  searchSymbols as searchSymbolsPlatform,
  resolveSymbolByName as resolveSymbolByNamePlatform,
} from "../../adapter/context/symbol";
import {
  createAgentTreeProvider,
  type TreeProvider,
  type AgentTreeItem,
} from "./vscode-ui/tree";
import { ensureChatPanel, registerConnectCommands } from "./commands/connect";
import { registerSessionCommands } from "./commands/session";
import { registerExportDebugLogCommand } from "./commands/exportDebugLog";
import { LogEntrySinkImpl } from "../../domain/services/log-entry-sink";
import { wireChatPanelEvents } from "./commands/prompt";
import {
  wireSessionEvents,
  wireMessageEvents,
} from "../../application/handlers";
import { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";
import { MessageBus } from "../../domain/services/message-bus";
import { FileLockManager } from "../../domain/services/file-lock-manager";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import { VscodePlatform } from "../../platform/adapters/vscode";
import type { PlatformAPI } from "../../platform/platform";
import type { ContextAttachmentDTO } from "../../domain/models/chat";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { EditorAPI } from "../../platform/editor";
import { TreeItem, TreeItemCollapsibleState } from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import type { ClearLogsOptions } from "../../platform/logStorage";

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
let meshOrchestrator: MeshOrchestrator | null = null;
const presenter = new ChatPresenter();

// ============================================================================
// Adaptor wrappers (Platform API → plain-function signatures for wireChatPanelEvents / registerSessionCommands)
// ============================================================================

function resolveFile(
  filePath: string,
  cwd?: string
): Promise<ContextAttachmentDTO> {
  return resolveFilePlatform(
    platform.fs,
    filePath,
    cwd
  ) as Promise<ContextAttachmentDTO>;
}

function resolveSelection(): Promise<ContextAttachmentDTO | null> {
  return resolveSelectionPlatform(
    platform.editor
  ) as Promise<ContextAttachmentDTO | null>;
}

function resolveDiff(): Promise<ContextAttachmentDTO | null> {
  return resolveDiffPlatform(
    platform.editor
  ) as Promise<ContextAttachmentDTO | null>;
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
        : TreeItemCollapsibleState.Expanded
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

// ── Statusline helpers ────────────────────────────────────────────────────

const execAsync = promisify(exec);

async function getStatuslineInfo(workspaceRoot: string): Promise<{
  hostname: string;
  repoName: string;
  branch: string;
  tag?: string;
}> {
  const hostname = os.hostname();

  let repoName = path.basename(workspaceRoot);
  try {
    const { stdout } = await execAsync("git remote get-url origin", {
      cwd: workspaceRoot,
    });
    const remote = stdout.trim();
    // Extract repo name from URL: "org/repo.git" or "org/repo"
    const match = remote.match(/[:/]([^/]+?)(\.git)?$/);
    if (match) repoName = match[1];
  } catch {
    // No remote, use directory name
  }

  let branch = "";
  try {
    const { stdout } = await execAsync("git branch --show-current", {
      cwd: workspaceRoot,
    });
    branch = stdout.trim();
  } catch {
    // Detached HEAD — try short SHA
    try {
      const { stdout } = await execAsync("git rev-parse --short HEAD", {
        cwd: workspaceRoot,
      });
      branch = stdout.trim();
    } catch {
      branch = "—";
    }
  }

  let tag: string | undefined;
  try {
    const { stdout } = await execAsync("git describe --tags --exact-match", {
      cwd: workspaceRoot,
    });
    tag = stdout.trim();
  } catch {
    // No exact tag match — omit
  }

  return { hostname, repoName, branch, tag };
}

async function sendStatuslineInfo(): Promise<void> {
  if (!chatPanel) return;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) return;

  const info = await getStatuslineInfo(ws);
  chatPanel.postMessage({ type: "statusline", ...info });
}

function setChatPanel(panel: ChatPanel): void {
  chatPanel = panel;
  // Wire extension logger so webview log messages appear in OutputChannel
  chatPanel.logger = {
    debug: (msg) => log.debug(msg),
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
  };
  // Send statusline info when chat panel is first created
  void sendStatuslineInfo();
}

function updateContext(): void {
  const agents = orchestrator.getAllAgents();
  const connected = agents.length > 0;
  const hasRunning = agents.some((a) =>
    a.sessions.some((s) => s.status === "running")
  );
  void vscode.commands.executeCommand("setContext", "acp.connected", connected);
  void vscode.commands.executeCommand("setContext", "acp.hasAgents", connected);
  void vscode.commands.executeCommand(
    "setContext",
    "acp.turnActive",
    hasRunning
  );
}

function sendOverviewPosition(): void {
  const pos = vscode.workspace
    .getConfiguration("acp")
    .get<string>("sessionOverviewPosition", "right");
  chatPanel?.postMessage({
    type: "sessionOverview:position",
    payload: { position: pos },
  });
}

function sendTabsToChatPanel(): void {
  if (!chatPanel) return;

  presenter.setWorkspace(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }))
  );

  // Collect valid session keys from orchestrator
  const validKeys = new Set<string>();
  for (const agentStatus of orchestrator.getAllAgents()) {
    const config = registry.getAgent(agentStatus.agentId);
    presenter.upsertAgent(
      agentStatus.agentId,
      agentStatus.agentId,
      agentStatus.state,
      config?.color
    );
    presenter.setAgentInfo(
      agentStatus.agentId,
      orchestrator.getAgentInfo(agentStatus.agentId)
    );

    for (const s of agentStatus.sessions) {
      const info = orchestrator.getSessionInfo(
        agentStatus.agentId,
        s.sessionId
      );
      presenter.upsertSession(
        s,
        agentStatus.agentId,
        info?.createdAt ?? new Date()
      );
      if (info) {
        chatPanel.pushSessionInfo(agentStatus.agentId, s.sessionId, info);
      }
      validKeys.add(`${agentStatus.agentId}:${s.sessionId}`);
    }
  }

  // Remove sessions from presenter that no longer exist in orchestrator
  const currentMsg = presenter.buildSetTabsMessage();
  for (const tab of currentMsg.tabs) {
    if (!validKeys.has(`${tab.agentId}:${tab.sessionId}`)) {
      presenter.removeSession(tab.agentId, tab.sessionId);
    }
  }

  const allTabs = Array.from(presenter.buildSetTabsMessage().tabs);
  let activeAgentId =
    [...orchestrator.getAllAgents()].find((a) =>
      orchestrator.getActiveSessionId(a.agentId)
    )?.agentId ?? null;
  let activeSessionId = activeAgentId
    ? (orchestrator.getActiveSessionId(activeAgentId) ?? null)
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

  // Push session overview in sync with tabs — same timing, same session set
  const overview = orchestrator.getSessionOverview();
  chatPanel.postMessage({
    type: "sessionOverview:state",
    payload: overview,
  });
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
    meshOrchestrator ?? undefined
  );
}

async function pickAgentByName(
  name?: string
): Promise<AgentConfig | undefined> {
  if (name) {
    const config = registry.getAgent(name);
    if (config) return config;
    void vscode.window.showErrorMessage(
      `Agent "${name}" not found in acp.agents configuration.`
    );
    return undefined;
  }
  const agents = registry.getAgents();
  if (agents.length === 0) {
    void vscode.window.showErrorMessage("ACP: No agents configured");
    return undefined;
  }
  if (agents.length === 1) return agents[0];
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: `$(hubot) ${a.name}`,
      description: a.command,
      config: a,
    })),
    { placeHolder: "Select agent to connect" }
  );
  return pick?.config;
}

async function pickConnectedAgent(
  placeHolder: string
): Promise<string | undefined> {
  const agents = orchestrator.getAllAgents();
  if (agents.length === 0) {
    void vscode.window.showWarningMessage("ACP: No connected agents");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: `$(hubot) ${a.agentId}`,
      description: a.state,
      agentId: a.agentId,
    })),
    { placeHolder }
  );
  return pick?.agentId;
}

// ============================================================================
// Activation / Deactivation
// ============================================================================

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  log.info("extension activating");
  extensionContext = context;

  // Create platform adapter
  platform = new VscodePlatform({ context });
  await platform.initialize();

  statusBar = new AgentStatusBar(platform.ui);
  registry = new AgentRegistry(platform);
  orchestrator = new SessionOrchestrator({ ui: platform.ui, fs: platform.fs });

  // MeshOrchestrator: wraps SessionOrchestrator for P2P/multi-agent routing
  const messageBus = new MessageBus();
  const fileLockManager = new FileLockManager();
  const taskBoardStore = new TaskBoardStore();
  meshOrchestrator = new MeshOrchestrator({
    sessionOrchestrator: orchestrator,
    messageBus,
    fileLockManager,
    taskBoardStore,
    pushUserMessage: (agentId, sessionId, message) => {
      chatPanel?.pushMessage(agentId, sessionId, message);
    },
  });

  statusTracker = new AgentStatusTracker();
  historyStore = new SessionHistoryStore(platform.context.globalState);

  persistentHistory = new PersistentHistoryStore({
    maxAgeDays: 90,
    maxSessions: 1000,
    maxMessagesPerSession: 10000,
  });
  await persistentHistory.initialize(context.globalStorageUri.fsPath);
  (platform as VscodePlatform).setLogStore(persistentHistory);
  orchestrator.setHistoryStore(persistentHistory);
  orchestrator.setSessionHistoryStore(historyStore);

  // Wire log entry sink for webview logs
  const logSink = new LogEntrySinkImpl();
  logSink.setStore(persistentHistory);
  ChatPanel.setLogSink(logSink);

  registerCommands(context);
  updateContext();

  treeProvider = createAgentTreeProvider(orchestrator, platform.ui);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("acp.agentTree", {
      onDidChangeTreeData:
        treeProvider.onDidChangeTreeData as unknown as vscode.Event<
          AgentTreeItem | undefined
        >,
      getTreeItem(element: AgentTreeItem): TreeItem {
        return toTreeItem(element);
      },
      getChildren(
        element?: AgentTreeItem
      ): AgentTreeItem[] | Thenable<AgentTreeItem[]> {
        return treeProvider.getChildren(element);
      },
    })
  );

  wireOrchestratorEvents(meshOrchestrator);

  // Send statusline info when workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void sendStatuslineInfo();
    })
  );

  // Listen for sessionOverviewPosition configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("acp.sessionOverviewPosition")) {
        void sendOverviewPosition();
      }
    })
  );

  const autoConnectAgents = registry.getAutoConnectAgents();
  log.info("auto-connect agents", { count: autoConnectAgents.length });
  for (const agent of autoConnectAgents) {
    for (const entry of agent.autoConnect ?? []) {
      await cmdConnect(agent, entry, agent.openChat !== false);
    }
  }

  log.info("extension activated");
}

export function deactivate(): void {
  log.info("extension deactivating");
  orchestrator.dispose();
  persistentHistory?.dispose();
  statusTracker.dispose();
  statusBar.dispose();
  void platform?.dispose();
  log.info("extension deactivated");
}

// ============================================================================
// Orchestrator Events → UI updates (delegated to handlers/)
// ============================================================================

function wireOrchestratorEvents(meshOrch: MeshOrchestrator): void {
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
    meshOrchestrator: meshOrch,
  });

  // Session Overview: push updates to webview on debounced orchestrator event
  orchestrator.on("sessionOverview:update", (overview) => {
    if (!chatPanel) return;
    chatPanel.postMessage({
      type: "sessionOverview:state",
      payload: overview,
    });
  });

  // Prompt queue: forward queue events to webview
  orchestrator.on("promptQueued", ({ agentId, sessionId, entry }) => {
    if (!chatPanel) return;
    chatPanel.postMessage({
      type: "queue:added",
      agentId,
      sessionId,
      entry,
    });
  });

  orchestrator.on("promptDequeued", ({ agentId, sessionId }) => {
    if (!chatPanel) return;
    chatPanel.postMessage({
      type: "queue:dequeued",
      agentId,
      sessionId,
    });
  });

  orchestrator.on("promptQueueUpdated", ({ agentId, sessionId, queue }) => {
    if (!chatPanel) return;
    chatPanel.postMessage({
      type: "queue:updated",
      agentId,
      sessionId,
      queue,
    });
  });

  // Send overview position setting to webview
  void sendOverviewPosition();
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
    pickAgentByName
  );

  const sessionDisposables = registerSessionCommands(
    orchestrator,
    registry,
    getChatPanel,
    () =>
      ensureChatPanel(
        getChatPanel,
        setChatPanel,
        context.extensionUri,
        sendTabsToChatPanel,
        wireChatPanelEventsLocal,
        orchestrator
      ),
    pickConnectedAgent,
    historyStore,
    persistentHistory ?? null,
    resolveFile,
    resolveSelection,
    resolveDiff,
    sendTabsToChatPanel
  );

  const setModeCmd = vscode.commands.registerCommand("acp.setMode", () => {
    void vscode.window.showWarningMessage("ACP: setMode not yet implemented");
  });
  const showTrafficCmd = vscode.commands.registerCommand(
    "acp.showTraffic",
    () => {
      void vscode.window.showWarningMessage(
        "ACP: showTraffic not yet implemented"
      );
    }
  );
  const clearLogsCmd = vscode.commands.registerCommand(
    "acp.clearLogs",
    async () => {
      const scope = await vscode.window.showQuickPick(
        [
          { label: "All logs", description: "Delete all persisted log entries", value: "all" as const },
          { label: "Older than 7 days", value: "7d" as const },
          { label: "Older than 30 days", value: "30d" as const },
        ],
        { placeHolder: "Select log entries to clear" }
      );
      if (!scope) return;

      const options: ClearLogsOptions = {};
      if (scope.value === "7d") {
        options.olderThan = Date.now() - 7 * 24 * 60 * 60 * 1000;
      } else if (scope.value === "30d") {
        options.olderThan = Date.now() - 30 * 24 * 60 * 60 * 1000;
      }

      const count = await platform.logStorage.countLogs(options);
      if (count === 0) {
        await vscode.window.showInformationMessage("ACP: No log entries to clear.");
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Delete ${count} log entries? This cannot be undone.`,
        { modal: true },
        "Delete"
      );
      if (confirmed !== "Delete") return;

      const result = await platform.logStorage.clearLogs(options);
      await vscode.window.showInformationMessage(
        `ACP: Cleared ${result.deletedCount} log entries.`
      );
    }
  );

  const exportDebugLogCmd = registerExportDebugLogCommand(
    context,
    () => persistentHistory ?? null
  );

  const toggleOverviewCmd = vscode.commands.registerCommand(
    "acp.toggleSessionOverview",
    () => {
      if (!chatPanel) return;
      // Toggle handled by webview message; just trigger the command
      chatPanel.postMessage({ type: "sessionOverview:toggle" });
      // Push current overview state so the panel shows fresh data on open
      const overview = orchestrator.getSessionOverview();
      chatPanel.postMessage({
        type: "sessionOverview:state",
        payload: overview,
      });
    }
  );

  for (const d of [
    ...connectDisposables,
    ...sessionDisposables,
    setModeCmd,
    showTrafficCmd,
    toggleOverviewCmd,
    clearLogsCmd,
    exportDebugLogCmd,
  ]) {
    context.subscriptions.push(d);
  }
}

// ============================================================================
// cmdConnect — connect + optional auto-open chat
// ============================================================================

async function cmdConnect(
  agentConfig?: AgentConfig | string,
  entry?: AutoConnectEntry,
  autoOpenChat: boolean = true
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

    const fallbackWs =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
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
        orchestrator
      );
      const info = orchestrator.getSessionInfo(config.id, sessionId);
      if (info) getChatPanel()?.setActiveSession(config.id, sessionId, info);
    }
    void vscode.window.showInformationMessage(
      `ACP: Connected to ${config.name}`
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ACP: Connection failed — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
