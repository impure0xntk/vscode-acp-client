import * as vscode from "vscode";
import * as path from "path";
import { getLogger } from "../../platform/backends";
import type { PresetConfig } from "../../domain/models/agent";
import type { ContextAttachmentDTO } from "../../domain/models/chat";

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
import { ChatPanel } from "./vscode-ui/chatPanel";
import { ChatPresenter } from "./vscode-ui/presenter";
import {
  resolveFile as resolveFilePlatform,
  resolveSelection as resolveSelectionPlatform,
  resolveDiff as resolveDiffPlatform,
  resolveRange as resolveRangePlatform,
  resolveProblems as resolveProblemsPlatform,
  resolveProblem as resolveProblemPlatform,
  type SerializedRange,
  type ProblemFilter,
} from "../../adapter/context/assembler";
import { searchFiles as searchFilesPlatform } from "../../adapter/context/file";
import {
  searchSymbols as searchSymbolsPlatform,
  resolveSymbolByName as resolveSymbolByNamePlatform,
} from "../../adapter/context/symbol";
import { ensureChatPanel, registerConnectCommands } from "./commands/connect";
import { registerSessionCommands } from "./commands/session";
import { registerQuickFixCommands } from "./commands/quickfix";
import { registerExportDebugLogCommand } from "./commands/exportDebugLog";
import { LogEntrySinkImpl } from "../../domain/services/log-entry-sink";
import { wireChatPanelEvents } from "./commands/prompt";
import { wireSessionEvents } from "../../application/handlers";
import { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";
import { MessageBus } from "../../domain/services/message-bus";
import { FileLockManager } from "../../domain/services/file-lock-manager";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import { SupervisorOrchestrator } from "../../domain/services/supervisor-orchestrator";
import {
  MESH_MARKER_V2_OPEN,
  MESH_MARKER_CLOSE,
} from "../../domain/models/mesh";
import { VscodePlatform, toPlatformUri } from "../../platform/adapters/vscode";
import type { PlatformAPI } from "../../platform/platform";
import type { DiagnosticProblem } from "../../platform/editor";

import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import type { ClearLogsOptions } from "../../platform/logStorage";

let extensionContext: vscode.ExtensionContext;
let platform: PlatformAPI;
let orchestrator: SessionOrchestrator;
let registry: AgentRegistry;
let statusTracker: AgentStatusTracker;
let historyStore: SessionHistoryStore;
let persistentHistory: PersistentHistoryStore | null = null;
let chatPanel: ChatPanel | null = null;
let meshOrchestrator: MeshOrchestrator | null = null;
let supervisorOrchestrator: SupervisorOrchestrator | null = null;
const presenter = new ChatPresenter();

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

function resolveRangeAt(
  uri: string,
  range: SerializedRange
): Promise<ContextAttachmentDTO | null> {
  const vUri = vscode.Uri.parse(uri);
  return resolveRangePlatform(
    platform.editor,
    toPlatformUri(vUri),
    range
  ) as Promise<ContextAttachmentDTO | null>;
}

function getDiagnostics(): Promise<DiagnosticProblem[]> {
  return platform.editor.getDiagnostics() as Promise<DiagnosticProblem[]>;
}

function getActiveFile(): string | undefined {
  return platform.editor.activeEditor?.filePath;
}

function resolveProblems(
  filter: ProblemFilter
): Promise<ContextAttachmentDTO | null> {
  return resolveProblemsPlatform(
    platform.editor,
    platform.fs,
    filter
  ) as Promise<ContextAttachmentDTO | null>;
}

function resolveProblem(
  problem: DiagnosticProblem
): Promise<ContextAttachmentDTO | null> {
  return resolveProblemPlatform(
    platform.fs,
    problem
  ) as Promise<ContextAttachmentDTO | null>;
}

function searchFiles(query: string, cwd?: string) {
  return searchFilesPlatform(platform.fs, query, cwd);
}

function searchSymbols(query: string) {
  return searchSymbolsPlatform(platform.editor, query);
}

function resolveSymbolByName(name: string): Promise<ContextAttachmentDTO> {
  return resolveSymbolByNamePlatform(
    platform.editor,
    platform.fs,
    name
  ) as Promise<ContextAttachmentDTO>;
}

function getChatPanel(): ChatPanel | null {
  return chatPanel;
}

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
    const match = remote.match(/[:/]([^/]+?)(\.git)?$/);
    if (match) repoName = match[1];
  } catch {}

  let branch = "";
  try {
    const { stdout } = await execAsync("git branch --show-current", {
      cwd: workspaceRoot,
    });
    branch = stdout.trim();
  } catch {
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
  } catch {}

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
  chatPanel.logger = {
    debug: (msg) => log.debug(msg),
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
  };
  void sendStatuslineInfo();
}

function updateContext(): void {
  const agents = orchestrator.getAllAgents();
  const connected = agents.length > 0;
  const hasRunning = agents.some((a) =>
    a.sessions.some((s) => s.status === "running")
  );
  void vscode.commands.executeCommand("setContext", "acp.connected", connected);
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

// Debounced sendTabsToChatPanel — coalesces rapid calls within 100ms
// into a single webview postMessage + overview computation.
let sendTabsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let sendTabsScheduled = false;

function sendTabsToChatPanel(immediate = false): void {
  if (immediate) {
    if (sendTabsDebounceTimer) {
      clearTimeout(sendTabsDebounceTimer);
      sendTabsDebounceTimer = null;
    }
    sendTabsScheduled = false;
    sendTabsNow();
    return;
  }

  // Skip if already scheduled — the pending timer will pick up latest state
  if (sendTabsScheduled) return;
  sendTabsScheduled = true;
  sendTabsDebounceTimer = setTimeout(() => {
    sendTabsDebounceTimer = null;
    sendTabsScheduled = false;
    sendTabsNow();
  }, 100);
}

function sendTabsNow(): void {
  if (!chatPanel) return;
  presenter.setWorkspace(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }))
  );

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

  const currentMsg = presenter.buildSetTabsMessage();
  for (const tab of currentMsg.tabs) {
    if (!validKeys.has(`${tab.agentId}:${tab.sessionId}`)) {
      presenter.removeSession(tab.agentId, tab.sessionId);
    }
  }

  const allTabs = currentMsg.tabs;
  let activeAgentId: string | null = null;
  for (const a of orchestrator.getAllAgents()) {
    if (orchestrator.getActiveSessionId(a.agentId)) {
      activeAgentId = a.agentId;
      break;
    }
  }
  let activeSessionId = activeAgentId
    ? (orchestrator.getActiveSessionId(activeAgentId) ?? null)
    : null;
  if (activeSessionId && activeAgentId) {
    presenter.setActiveSession(activeAgentId, activeSessionId);
  } else if (!activeSessionId && allTabs.length === 1) {
    // Do NOT call orchestrator.setActiveSession() — would steal focus from user
    presenter.setActiveSession(allTabs[0].agentId, allTabs[0].sessionId);
  }

  chatPanel.postMessage(presenter.buildSetTabsMessage());

  // Use fast path — skips recentResponses extraction per session
  const overview = orchestrator.getSessionOverview({
    withRecentResponses: false,
  });
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
    meshOrchestrator ?? undefined,
    supervisorOrchestrator ?? undefined
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

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  log.info("extension activating");
  extensionContext = context;

  // Create platform adapter
  platform = new VscodePlatform({ context });
  await platform.initialize();
  log.info("ACP Client extension activated");

  registry = new AgentRegistry(platform);
  orchestrator = new SessionOrchestrator({ ui: platform.ui, fs: platform.fs });

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

  supervisorOrchestrator = new SupervisorOrchestrator({
    meshOrchestrator: meshOrchestrator!,
    sessionOrchestrator: orchestrator,
    taskBoardStore,
    postMessage: (msg) => {
      if (!chatPanel) return;
      // PlanOutboundMessage uses type "plan.update" | "plan.stepUpdate" | "plan.executionResult"
      // Cast to the webview message format
      chatPanel.postMessage(
        msg as unknown as { type: string; [key: string]: unknown }
      );
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

  const logSink = new LogEntrySinkImpl();
  logSink.setStore(persistentHistory);
  ChatPanel.setLogSink(logSink);

  registerCommands(context);
  updateContext();

  wireOrchestratorEvents(meshOrchestrator);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void sendStatuslineInfo();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("acp.sessionOverviewPosition")) {
        void sendOverviewPosition();
      }
    })
  );

  const preset = registry.loadPreset(platform);
  if (preset) {
    log.info("applying preset", {
      label: preset.label,
      sessions: preset.sessions.length,
    });
    await applyPreset(preset);
  } else {
    const autoConnectAgents = registry.getAutoConnectAgents();
    log.info("auto-connect agents", { count: autoConnectAgents.length });
    for (const agent of autoConnectAgents) {
      for (const entry of agent.autoConnect ?? []) {
        await cmdConnect(agent, entry, agent.openChat !== false);
      }
    }
  }

  log.info("extension activated");
}

export function deactivate(): void {
  log.info("extension deactivating");
  orchestrator.dispose();
  persistentHistory?.dispose();
  statusTracker.dispose();
  void platform?.dispose();
  log.info("extension deactivated");
}

function wireOrchestratorEvents(meshOrch: MeshOrchestrator): void {
  wireSessionEvents({
    orchestrator,
    getChatPanel,
    presenter,
    statusTracker,
    historyStore,
    updateContext,
    sendTabs: sendTabsToChatPanel,
  });

  meshOrch.onExtractedMessage = (msg) => {
    if (!chatPanel) return;
    switch (msg.type) {
      case "plan_proposal": {
        if (supervisorOrchestrator) {
          const agentId = msg.agentId;
          const activeSessionId =
            orchestrator.getActiveSessionId(agentId) ?? "";
          const envelope = {
            version: "2.0",
            type: msg.type,
            id: msg.id ?? crypto.randomUUID(),
            from: msg.from,
            to: msg.to,
            mode: "p2P",
            payload: msg.payload,
            metadata: msg.metadata,
          };
          const rawOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify(envelope)}${MESH_MARKER_CLOSE}`;
          supervisorOrchestrator.parsePlanFromOutput(
            agentId,
            activeSessionId,
            rawOutput
          );
        }
        break;
      }
      case "plan_update": {
        const payload = msg.payload as
          | {
              steps?: Array<{
                id: string;
                description: string;
                status: string;
              }>;
              status?: string;
            }
          | undefined;
        chatPanel.postMessage({
          type: "plan.update",
          agentId: msg.agentId,
          sessionId: "",
          steps: payload?.steps ?? [],
          status:
            (payload?.status as
              | "pending"
              | "approved"
              | "rejected"
              | "executing"
              | "completed") ?? "pending",
        });
        break;
      }
      case "task_delegate": {
        chatPanel.postMessage({
          type: "agent.status",
          agentId: msg.to,
          status: "running",
          currentTask: (msg.payload as { description?: string })?.description,
        });
        break;
      }
      case "task_response": {
        if (supervisorOrchestrator) {
          supervisorOrchestrator.handleTaskResponse(msg);
        }
        break;
      }
      case "status_update": {
        const payload = msg.payload as
          | {
              agentId?: string;
              status?: string;
              currentTask?: string;
              progress?: number;
            }
          | undefined;
        if (payload?.agentId) {
          chatPanel.postMessage({
            type: "agent.status",
            agentId: payload.agentId,
            status:
              (payload.status as
                | "idle"
                | "running"
                | "waiting"
                | "error"
                | "completed") ?? "idle",
            currentTask: payload.currentTask,
            progress: payload.progress,
          });
        }
        break;
      }
    }
  };

  orchestrator.on("sessionOverview:update", (overview) => {
    if (!chatPanel) return;
    chatPanel.postMessage({
      type: "sessionOverview:state",
      payload: overview,
    });
  });

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

  orchestrator.on("sessionTitleChanged", ({ agentId, sessionId, title }) => {
    if (!chatPanel) return;
    chatPanel.postMessage({ type: "session/title", agentId, sessionId, title });
    sendTabsToChatPanel();
  });

  orchestrator.on("sessionPinned", ({ agentId, sessionId }) => {
    if (!chatPanel) return;
    chatPanel.postMessage({ type: "session.pinned", agentId, sessionId });
  });

  orchestrator.on("sessionUnpinned", ({ agentId, sessionId }) => {
    if (!chatPanel) return;
    chatPanel.postMessage({ type: "session.unpinned", agentId, sessionId });
  });

  orchestrator.on(
    "sessionContextCompressed",
    ({ agentId, sessionId, contextWindowMax, usedBefore, usedAfter }) => {
      orchestrator.handleContextCompression(
        agentId,
        sessionId,
        contextWindowMax,
        usedBefore,
        usedAfter
      );
    }
  );

  void sendOverviewPosition();
}

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
    getDiagnostics,
    getActiveFile,
    resolveProblems,
    resolveProblem,
    sendTabsToChatPanel
  );

  const quickFixDisposables = registerQuickFixCommands(
    orchestrator,
    getChatPanel,
    () =>
      ensureChatPanel(
        getChatPanel,
        setChatPanel,
        extensionContext.extensionUri,
        sendTabsToChatPanel,
        wireChatPanelEventsLocal,
        orchestrator
      ),
    resolveSelection,
    resolveRangeAt
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
          {
            label: "All logs",
            description: "Delete all persisted log entries",
            value: "all" as const,
          },
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
        await vscode.window.showInformationMessage(
          "ACP: No log entries to clear."
        );
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
      chatPanel.postMessage({ type: "sessionOverview:toggle" });
      const overview = orchestrator.getSessionOverview({
        withRecentResponses: true,
      });
      chatPanel.postMessage({
        type: "sessionOverview:state",
        payload: overview,
      });
    }
  );

  const startTeamCmd = vscode.commands.registerCommand(
    "acp.startTeam",
    async () => {
      ensureChatPanel(
        getChatPanel,
        setChatPanel,
        extensionContext.extensionUri,
        sendTabsToChatPanel,
        wireChatPanelEventsLocal,
        orchestrator
      );
    }
  );

  const splitVerticalCmd = vscode.commands.registerCommand(
    "acp.splitVertical",
    () => {
      chatPanel?.postMessage({
        type: "unifiedChat:setSplitDirection",
        direction: "vertical",
      });
    }
  );

  const splitHorizontalCmd = vscode.commands.registerCommand(
    "acp.splitHorizontal",
    () => {
      chatPanel?.postMessage({
        type: "unifiedChat:setSplitDirection",
        direction: "horizontal",
      });
    }
  );

  const setPanelModeUnifiedCmd = vscode.commands.registerCommand(
    "acp.setPanelMode.unified",
    () => {
      chatPanel?.postMessage({ type: "panelMode:set", mode: "unified" });
    }
  );

  const setPanelModeSupervisorCmd = vscode.commands.registerCommand(
    "acp.setPanelMode.supervisor",
    () => {
      chatPanel?.postMessage({ type: "panelMode:set", mode: "supervisor" });
    }
  );

  for (const d of [
    ...connectDisposables,
    ...sessionDisposables,
    ...quickFixDisposables,
    setModeCmd,
    showTrafficCmd,
    toggleOverviewCmd,
    startTeamCmd,
    splitVerticalCmd,
    splitHorizontalCmd,
    setPanelModeUnifiedCmd,
    setPanelModeSupervisorCmd,
    clearLogsCmd,
    exportDebugLogCmd,
  ]) {
    context.subscriptions.push(d);
  }
}

async function applyPreset(preset: PresetConfig): Promise<void> {
  const wsFolders = (vscode.workspace.workspaceFolders ?? []).map(
    (f) => f.uri.fsPath
  );
  const fallbackWs = wsFolders[0] ?? process.cwd();

  const connectedSessions: Array<{
    agentId: string;
    sessionId: string;
    title: string;
  }> = [];

  for (const entry of preset.sessions) {
    const agentConfig = registry.getAgent(entry.agent);
    if (!agentConfig) {
      log.warn("preset: agent not found, skipping", { agent: entry.agent });
      continue;
    }

    try {
      await orchestrator.connectAgent(agentConfig.id, agentConfig);
    } catch (err) {
      log.error("preset: failed to connect agent", {
        agent: entry.agent,
        error: err,
      });
      continue;
    }

    let ws: string;
    if (entry.workspace) {
      const p = entry.workspace;
      ws = path.isAbsolute(p) ? p : path.resolve(fallbackWs, p);
    } else {
      ws = fallbackWs;
    }

    try {
      const sessionId = await orchestrator.createSession(agentConfig.id, ws);

      const title = entry.sessionName;
      if (title) {
        const info = orchestrator.getSessionInfo(agentConfig.id, sessionId);
        if (info) info.title = title;
      }

      // Pin auto-created sessions by default unless explicitly disabled.
      if (entry.pinned !== false) {
        orchestrator.pinSession(agentConfig.id, sessionId);
      }

      connectedSessions.push({
        agentId: agentConfig.id,
        sessionId,
        title: title ?? agentConfig.id,
      });

      log.info("preset: session created", {
        agent: entry.agent,
        sessionId,
        workspace: ws,
        title,
      });
    } catch (err) {
      log.error("preset: failed to create session", {
        agent: entry.agent,
        workspace: ws,
        error: err,
      });
    }
  }

  if (connectedSessions.length === 0) {
    log.warn("preset: no sessions created");
    return;
  }

  ensureChatPanel(
    getChatPanel,
    setChatPanel,
    extensionContext.extensionUri,
    sendTabsToChatPanel,
    wireChatPanelEventsLocal,
    orchestrator
  );

  const panel = getChatPanel();
  if (panel) {
    if (preset.layout) {
      panel.postMessage({
        type: "unifiedChat:setLayout",
        layout: preset.layout,
        splitRatio: preset.splitRatio,
      });
    }

    // Re-emit pin state now that the chat panel exists. The orchestrator
    // emits `sessionPinned` while sessions are created above, but chatPanel
    // is still null at that point, so those `session.pinned` notifications are
    // dropped. The webview reflects pin state only from those notifications,
    // so without this re-emit the preset sessions would never appear pinned.
    for (const s of connectedSessions) {
      if (orchestrator.isSessionPinned(s.agentId, s.sessionId)) {
        panel.postMessage({
          type: "session.pinned",
          agentId: s.agentId,
          sessionId: s.sessionId,
        });
      }
    }
  }

  void vscode.window.showInformationMessage(
    `ACP: Preset "${preset.label}" applied — ${connectedSessions.length} session(s)`
  );
}

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

    // Pin auto-created sessions by default unless explicitly disabled.
    if (entry?.pinned !== false) {
      orchestrator.pinSession(config.id, sessionId);
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
