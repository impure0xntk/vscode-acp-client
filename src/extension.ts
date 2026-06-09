import * as vscode from "vscode";
import * as path from "path";
import { SessionOrchestrator, AgentConfig, AutoConnectEntry } from "./session/orchestrator";
import type { SessionInfo } from "./session/types";
import type { ChatMessage } from "./types/chat";
import { AgentRegistry } from "./agent/registry";
import { AgentStatusTracker } from "./agent/status";
import { SessionHistoryStore, HistoryEntry } from "./session/historyStore";
import { PersistentHistoryStore, PersistentSessionEntry, SessionMessages } from "./session/persistentHistory";
import { AgentStatusBar } from "./statusbar/manager";
import { ChatPanel } from "./providers/chatPanel";
import { resolveFile, resolveSelection, resolveDiff } from "./context/assembler";
import { searchFiles } from "./context/fileContext";
import { searchSymbols, resolveSymbolByName } from "./context/symbolContext";
import { createAgentTreeProvider, type TreeProvider } from "./tree/provider";
import { ensureChatPanel, registerConnectCommands } from "./commands/connect";
import { registerSessionCommands } from "./commands/session";
import { wireChatPanelEvents } from "./commands/prompt";
import { SessionNotification } from "@agentclientprotocol/sdk";

// ============================================================================
// Global State
// ============================================================================

let extensionContext: vscode.ExtensionContext;
let orchestrator: SessionOrchestrator;
let registry: AgentRegistry;
let statusTracker: AgentStatusTracker;
let historyStore: SessionHistoryStore;
let persistentHistory: PersistentHistoryStore | null = null;
let statusBar: AgentStatusBar;
let treeProvider: TreeProvider;
let chatPanel: ChatPanel | null = null;

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
  const allSessions = [];
  const agents: Array<{ agentId: string; name: string; state: string; color?: string }> = [];
  for (const agentStatus of orchestrator.getAllAgents()) {
    agents.push({
      agentId: agentStatus.agentId,
      name: agentStatus.agentId,
      state: agentStatus.state,
      color: registry.getAgent(agentStatus.agentId)?.color,
    });
    const activeSessId = orchestrator.getActiveSessionId(agentStatus.agentId);
    for (const s of agentStatus.sessions) {
      const info = orchestrator.getSessionInfo(agentStatus.agentId, s.sessionId);
      allSessions.push({
        sessionId: s.sessionId,
        agentId: agentStatus.agentId,
        title: s.title,
        status: s.status,
        unreadCount: 0,
        tokenUsage: { inputTokens: s.tokenUsage.input, outputTokens: s.tokenUsage.output, totalTokens: s.tokenUsage.total },
        contextWindowMax: info?.contextWindowMax,
        sessionStartMs: info?.createdAt?.getTime() ?? Date.now(),
        lastActivity: Date.now(),
        isDirty: false,
        cwd: s.cwd,
        model: s.model,
        mode: s.mode,
      });
    }
  }
  // Determine active session — fallback to the first session if exactly one exists
  let activeAgentId = [...orchestrator.getAllAgents()].find(
    (a) => orchestrator.getActiveSessionId(a.agentId)
  )?.agentId ?? null;
  let activeSessionId = activeAgentId
    ? orchestrator.getActiveSessionId(activeAgentId) ?? null
    : null;
  if (!activeSessionId && allSessions.length === 1) {
    activeSessionId = allSessions[0].sessionId;
    activeAgentId = allSessions[0].agentId;
    orchestrator.setActiveSession(activeAgentId, activeSessionId);
  }
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  // Build agentInfoMap for webview
  const agentInfoMap: Record<string, unknown> = {};
  for (const agent of orchestrator.getAllAgents()) {
    const info = orchestrator.getAgentInfo(agent.agentId);
    if (info) agentInfoMap[agent.agentId] = info;
  }
  chatPanel.postMessage({
    type: "setTabs",
    tabs: allSessions,
    activeSessionId,
    activeAgentId,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    agents,
    workspaceFolders,
    agentInfoMap,
  });
}

function wireChatPanelEventsLocal(): void {
  wireChatPanelEvents(chatPanel, orchestrator, sendTabsToChatPanel, resolveFile, resolveSelection, resolveDiff, searchFiles, searchSymbols, resolveSymbolByName, persistentHistory ?? undefined);
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
    { placeHolder: "Select agent to connect" }
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
    { placeHolder }
  );
  return pick?.agentId;
}

// ============================================================================
// Activation / Deactivation
// ============================================================================

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log("ACP Client extension is now active");
  extensionContext = context;

  statusBar = new AgentStatusBar();
  registry = new AgentRegistry(context);
  orchestrator = new SessionOrchestrator();
  statusTracker = new AgentStatusTracker();
  historyStore = new SessionHistoryStore(context);

  // Initialize persistent history store
  persistentHistory = new PersistentHistoryStore({
    maxAgeDays: 90,
    maxSessions: 1000,
    maxMessagesPerSession: 10000,
  });
  await persistentHistory.open();
  orchestrator.setHistoryStore(persistentHistory);
  orchestrator.setSessionHistoryStore(historyStore);

  wireOrchestratorEvents();
  registerCommands(context);
  updateContext();

  treeProvider = createAgentTreeProvider(orchestrator);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("acp.agentTree", treeProvider),
  );

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
  console.log("ACP Client extension is now deactivated");
}

// ============================================================================
// Orchestrator Events → UI updates
// ============================================================================

function wireOrchestratorEvents(): void {
  orchestrator.on("agentConnected", (agentId: string) => {
    statusTracker.updateAgentStatus(agentId, { state: "idle" });
    statusBar.setConnected(true, agentId);
    updateContext();
    treeProvider.refresh();
    sendTabsToChatPanel();
    // Send agent info to webview
    const agentInfo = orchestrator.getAgentInfo(agentId);
    if (agentInfo) {
      chatPanel?.setAgentInfo(agentId, agentInfo);
    }
  });

  orchestrator.on("agentDisconnected", (agentId: string) => {
    statusTracker.removeAgent(agentId);
    updateContext();
    treeProvider.refresh();
    sendTabsToChatPanel();
  });

  orchestrator.on("sessionCreated", ({ agentId, sessionId, cwd }: { agentId: string; sessionId: string; cwd?: string }) => {
    statusTracker.updateSessionStatus(agentId, sessionId, {
      sessionId, title: sessionId.slice(0, 8), status: "idle", isActive: true,
      messageCount: 0, tokenUsage: { input: 0, output: 0, total: 0 },
    });
    statusTracker.setActiveSession(agentId, sessionId);
    sendTabsToChatPanel();
    treeProvider.refresh();
    updateContext();

    // Warn if the session cwd is outside the current workspace
    if (cwd) {
      const wsFolders = vscode.workspace.workspaceFolders ?? [];
      if (wsFolders.length > 0) {
        const isInsideWorkspace = wsFolders.some(
          (f) => cwd === f.uri.fsPath || cwd.startsWith(f.uri.fsPath + path.sep)
        );
        if (!isInsideWorkspace) {
          void vscode.window.showWarningMessage(
            `ACP: Session working directory "${cwd}" is outside the current workspace`
          );
        }
      }
    }
  });

  orchestrator.on("sessionActiveChanged", ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
    statusTracker.setActiveSession(agentId, sessionId);
    const info = orchestrator.getSessionInfo(agentId, sessionId);
    if (info) {
      chatPanel?.setActiveSession(agentId, sessionId, info);
    }
    treeProvider.refresh();
  });

  orchestrator.on("sessionTurnActiveChanged", ({ agentId, sessionId, active }: { agentId: string; sessionId: string; active: boolean }) => {
    chatPanel?.pushTurnActive(agentId, sessionId, active);
    // Intentionally no sendTabsToChatPanel() here — a full tab refresh
    // would reset the active session and force-focus a different tab.
  });

  orchestrator.on("sessionMessage", ({ agentId, sessionId, message }: { agentId: string; sessionId: string; message: ChatMessage }) => {
    const info = orchestrator.getSessionInfo(agentId, sessionId);
    chatPanel?.pushMessage(agentId, sessionId, message, info?.cwd);
  });

  orchestrator.on("sessionClosed", ({ agentId, sessionId }: { agentId: string; sessionId: string }) => {
    const info = orchestrator.getSessionInfo(agentId, sessionId);
    if (info) {
      const entry: HistoryEntry = {
        sessionId, agentId, title: info.title, cwd: info.cwd, status: info.status,
        createdAt: info.createdAt.toISOString(), updatedAt: info.updatedAt.toISOString(),
        messageCount: info.messages.length, tokenUsage: info.tokenUsage,
      };
      void historyStore.addEntry(entry);
    }
    treeProvider.refresh();
    sendTabsToChatPanel();
  });

  orchestrator.on("sessionCommandsUpdated", ({ agentId, sessionId, commands }: { agentId: string; sessionId: string; commands: unknown[] }) => {
    console.log("[extension] sessionCommandsUpdated", { agentId, sessionId, commands });
    chatPanel?.pushAvailableCommands(agentId, sessionId, commands);
  });

  orchestrator.on("sessionUpdate", (event: { agentId: string; sessionId: string; notification: SessionNotification }) => {
    const { agentId, sessionId, notification } = event;
    const update = notification.update;

    // Forward raw SDK notification to the webview for UI rendering
    chatPanel?.pushSessionNotification(agentId, sessionId, notification);

    statusTracker.updateSessionStatus(agentId, sessionId, {
      sessionId,
      title: orchestrator.getSessionInfo(agentId, sessionId)?.title ?? sessionId,
      status: "running", isActive: true,
      messageCount: orchestrator.getSessionInfo(agentId, sessionId)?.messages.length ?? 0,
      tokenUsage: orchestrator.getSessionInfo(agentId, sessionId)?.tokenUsage ?? { input: 0, output: 0, total: 0 },
    });
    treeProvider.refresh();
    updateContext();

    if (update.sessionUpdate === "current_mode_update" || update.sessionUpdate === "config_option_update" || update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      sendTabsToChatPanel();
    }

    // Forward usage_update: push lightweight update + full tab refresh
    if (update.sessionUpdate === "usage_update") {
      const sessionInfo = orchestrator.getSessionInfo(agentId, sessionId);
      if (sessionInfo) {
        chatPanel?.pushSessionUsage(
          agentId,
          sessionId,
          {
            inputTokens: sessionInfo.tokenUsage.input,
            outputTokens: sessionInfo.tokenUsage.output,
            totalTokens: sessionInfo.tokenUsage.total,
          },
          sessionInfo.contextWindowMax,
        );
        // Also refresh tabs so token/contextWindowMax propagate to inactive tabs
        sendTabsToChatPanel();
      }
    }
  });

  // Notify webview when a background session completes (not the active tab).
  // Only sends a lightweight status update — never calls sendTabsToChatPanel()
  // to avoid disrupting the user's current tab focus.
  orchestrator.on("sessionCompleted", ({ agentId, sessionId, title }: { agentId: string; sessionId: string; title: string }) => {
    const activeSessionId = chatPanel ? orchestrator.getActiveSessionId(agentId) : undefined;
    if (sessionId !== activeSessionId) {
      chatPanel?.postMessage({ type: "session/completed", agentId, sessionId, title });
    }
    // Always update tab status — session turn ended, mark as completed/idle
    chatPanel?.postMessage({ type: "updateTab", sessionId, agentId, updates: { status: "completed" } });
  });
}

// ============================================================================
// Command Registration
// ============================================================================

function registerCommands(context: vscode.ExtensionContext): void {
  const connectDisposables = registerConnectCommands(
    context, orchestrator, registry,
    getChatPanel, setChatPanel, sendTabsToChatPanel, wireChatPanelEventsLocal,
    pickConnectedAgent, pickAgentByName
  );

  const sessionDisposables = registerSessionCommands(
    orchestrator, registry,
    getChatPanel,
    () => ensureChatPanel(getChatPanel, setChatPanel, context.extensionUri, sendTabsToChatPanel, wireChatPanelEventsLocal, orchestrator),
    pickConnectedAgent,
    historyStore, resolveFile, resolveSelection, resolveDiff
  );

  // Stub commands
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

// Re-export cmdConnect for auto-connect
// entry: optional AutoConnectEntry with workspace/sessionName overrides
// autoOpenChat: if true (default), open chat panel and add a session tab
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

    // Resolve workspace: entry.workspace → fallback
    const fallbackWs = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    let ws: string;
    if (entry?.workspace) {
      const p = entry.workspace;
      ws = path.isAbsolute(p) ? p : path.resolve(fallbackWs, p);
    } else {
      ws = fallbackWs;
    }

    const sessionId = await orchestrator.createSession(config.id, ws);

    // Override session title if entry.sessionName provided
    if (entry?.sessionName) {
      const info = orchestrator.getSessionInfo(config.id, sessionId);
      if (info) info.title = entry.sessionName;
    }

    if (autoOpenChat) {
      ensureChatPanel(getChatPanel, setChatPanel, extensionContext.extensionUri, sendTabsToChatPanel, wireChatPanelEventsLocal, orchestrator);
      const info = orchestrator.getSessionInfo(config.id, sessionId);
      if (info) getChatPanel()?.setActiveSession(config.id, sessionId, info);
    }
    void vscode.window.showInformationMessage(`ACP: Connected to ${config.name}`);
  } catch (err) {
    void vscode.window.showErrorMessage(`ACP: Connection failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}
