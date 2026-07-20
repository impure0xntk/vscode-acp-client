import * as vscode from "vscode";
import { getLogger } from "../../platform/backends";
import { ApplicationBuilder } from "./ApplicationBuilder";
import type { Application } from "./ApplicationBuilder";
import { ChatPanel } from "./vscode-ui/chatPanel";
import { SessionStateBridge } from "./vscode-ui/sessionStateBridge";
import { ChatPresenter } from "./vscode-ui/presenter";
import {
  getChatPanel,
  setChatPanel,
  resolveFile,
  resolveSelection,
  resolveDiff,
  resolveRangeAt,
  resolveProblem,
  searchFiles,
  searchSymbols,
  resolveSymbolByName,
} from "./contextHelpers";
import { sendStatuslineInfo, scheduleStatuslineInfo } from "./statuslineHelpers";
import { updateContext, sendOverviewPosition, sendTabsToChatPanel } from "./tabsHandler";
import { pickAgentByName, pickConnectedAgent } from "./agentPicker";
import { wireChatPanelEvents } from "./commands/prompt";
import { applyPreset, cmdConnect } from "./presetHandler";
import type { PresetDeps } from "./presetHandler";
import { wireAllEvents } from "./events/index";
import { registerAllCommands } from "./commands/index";
import type { CommandRegDeps } from "./commands/index";

const log = getLogger("extension");

// -- Module-level state -------------------------------------------------------

let extensionContext: vscode.ExtensionContext;
let app: Application;
let bridge: SessionStateBridge;
const presenter = new ChatPresenter();

// -- Helpers: build CommandRegDeps from Application + presenters ---------------

function buildCommandDeps(): CommandRegDeps {
  const p = app.platform;
  return {
    context: extensionContext,
    orchestrator: app.orchestrator,
    registry: app.registry,
    getChatPanel,
    setChatPanel,
    sendTabs: () =>
      sendTabsToChatPanel(
        app.orchestrator,
        app.registry,
        presenter,
        bridge
      ),
    wireChatPanelEvents: (
      panel,
      orchestrator,
      sendTabs,
      resolveFileFn,
      resolveSelectionFn,
      resolveDiffFn,
      searchFilesFn,
      searchSymbolsFn,
      resolveSymbolByNameFn,
      persistentHistoryArg,
      meshOrchestratorArg,
      supervisorOrchestratorArg
    ) =>
      wireChatPanelEvents(
        panel,
        orchestrator,
        sendTabs,
        resolveFileFn,
        resolveSelectionFn,
        resolveDiffFn,
        searchFilesFn,
        searchSymbolsFn,
        resolveSymbolByNameFn,
        persistentHistoryArg,
        meshOrchestratorArg,
        supervisorOrchestratorArg
      ),
    pickConnectedAgent: (ph: string) =>
      pickConnectedAgent(app.orchestrator, ph),
    pickAgentByName: (name?: string) =>
      pickAgentByName(app.registry, name),
    historyStore: app.historyStore as unknown as CommandRegDeps["historyStore"],
    persistentHistory: app.persistentHistory,
    resolveFile: (path, cwd) => resolveFile(p, path, cwd),
    resolveSelection: () => resolveSelection(p),
    resolveDiff: () => resolveDiff(p),
    resolveProblem: (problem) => resolveProblem(p, problem),
    resolveRangeAt: (uri, range) => resolveRangeAt(p, uri, range),
    searchFiles: (query: string, cwd?: string) =>
      searchFiles(p, query, cwd),
    searchSymbols: (query: string) => searchSymbols(p, query),
    resolveSymbolByName: (name: string) =>
      resolveSymbolByName(p, name),
    meshOrchestrator: app.meshOrchestrator ?? undefined,
    supervisorOrchestrator: app.supervisorOrchestrator ?? undefined,
  };
}

function buildPresetDeps(): PresetDeps {
  return {
    orchestrator: app.orchestrator,
    registry: app.registry,
    platform: app.platform,
    presenter,
    bridge,
    persistentHistory: app.persistentHistory,
    meshOrchestrator: app.meshOrchestrator,
    supervisorOrchestrator: app.supervisorOrchestrator,
    extensionUri: extensionContext.extensionUri,
  };
}

// -- Wire chat panel events (local wrapper called by commands and preset) ------

function wireChatPanelEventsLocal(): void {
  const p = app.platform;
  wireChatPanelEvents(
    getChatPanel(),
    app.orchestrator,
    () =>
      sendTabsToChatPanel(
        app.orchestrator,
        app.registry,
        presenter,
        bridge
      ),
    (fp: string, cwd?: string) => resolveFile(p, fp, cwd),
    () => resolveSelection(p),
    () => resolveDiff(p),
    (q: string, cwd?: string) => searchFiles(p, q, cwd),
    (q: string) => searchSymbols(p, q),
    (name: string) => resolveSymbolByName(p, name),
    app.persistentHistory ?? undefined,
    app.meshOrchestrator ?? undefined,
    app.supervisorOrchestrator ?? undefined
  );
}

// -- Activate / Deactivate -----------------------------------------------------

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  log.info("extension activating");
  extensionContext = context;

  // 0. Create the session-state bridge before any panels are created.
  //    All panels register themselves during createPanel() and receive
  //    orchestrator events through this bridge automatically.
  bridge = new SessionStateBridge();
  ChatPanel._stateBridge = bridge;

  // 1. Build application services
  const builder = await ApplicationBuilder.create(context);
  builder.buildAll({ get: () => getChatPanel() });
  app = builder.build();
  app.orchestrator.setSessionHistoryStore(app.historyStore);

  // Init persistent history off the critical path
  if (app.persistentHistory) {
    builder
      .initHistory(context.globalStorageUri.fsPath)
      .catch((err) =>
        log.error("failed to initialize persistent history", {}, err as Error)
      );
  }

  // 2. Register all commands
  registerAllCommands(buildCommandDeps());
  updateContext(app.orchestrator);

  // 3. Wire orchestrator + mesh events through the bridge
  wireAllEvents({
    orchestrator: app.orchestrator,
    meshOrchestrator: app.meshOrchestrator,
    supervisorOrchestrator: app.supervisorOrchestrator,
    bridge,
    getChatPanel,
    presenter,
    statusTracker: app.statusTracker,
    historyStore: app.historyStore,
    diagnostics: app.platform.diagnostics,
    updateContext: () => updateContext(app.orchestrator),
    sendTabs: () =>
      sendTabsToChatPanel(
        app.orchestrator,
        app.registry,
        presenter,
        bridge
      ),
  });

  // 4. Workspace + config change listeners
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void sendStatuslineInfo(getChatPanel);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("acp.sessionOverviewPosition")) {
        sendOverviewPosition(bridge);
      }
    })
  );

  // 5. Preset / auto-connect on startup
  const presetDeps = buildPresetDeps();
  const preset = app.registry.loadPreset(app.platform);
  if (preset) {
    log.info("applying preset", {
      label: preset.label,
      sessions: preset.sessions.length,
    });
    await applyPreset(presetDeps, preset);
  } else {
    const autoConnectAgents = app.registry.getAutoConnectAgents();
    log.info("auto-connect agents", { count: autoConnectAgents.length });
    const maxConcurrent = Math.max(
      1,
      vscode.workspace
        .getConfiguration("acp")
        .get<number>("maxConcurrentAgents", 5)
    );
    const tasks: Promise<void>[] = [];
    for (const agent of autoConnectAgents) {
      for (const entry of agent.autoConnect ?? []) {
        tasks.push(
          cmdConnect(presetDeps, agent, entry, agent.openChat !== false)
        );
      }
    }
    if (tasks.length > 0) {
      const chunks: Promise<void>[][] = [];
      for (let i = 0; i < tasks.length; i += maxConcurrent) {
        chunks.push(tasks.slice(i, i + maxConcurrent));
      }
      for (const chunk of chunks) {
        await Promise.all(chunk);
      }
    }
  }

  log.info("extension activated");
}

export function deactivate(): void {
  log.info("extension deactivating");
  app?.orchestrator.dispose();
  app?.persistentHistory?.dispose();
  app?.statusTracker.dispose();
  void app?.platform?.dispose();
  log.info("extension deactivated");
}
