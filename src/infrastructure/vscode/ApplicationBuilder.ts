import * as vscode from "vscode";
import { getLogger } from "../../platform/backends";
import { VscodePlatform } from "../../platform/adapters/vscode";
import type { PlatformAPI } from "../../platform/platform";
import { SessionOrchestrator } from "../../application/session/orchestrator";
import { AgentRegistry } from "../../adapter/agent/registry";
import { AgentStatusTracker } from "../../adapter/agent/status";
import { SessionHistoryStore } from "../../application/session/historyStore";
import { PersistentHistoryStore } from "../../application/session/persistentHistory";
import { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";
import { MessageBus } from "../../domain/services/message-bus";
import { FileLockManager } from "../../domain/services/file-lock-manager";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import { SupervisorOrchestrator } from "../../domain/services/supervisor-orchestrator";
import { ChatPresenter } from "./vscode-ui/presenter";
import { LogEntrySinkImpl } from "../../domain/services/log-entry-sink";
import { ChatPanel } from "./vscode-ui/chatPanel";

const log = getLogger("ApplicationBuilder");

/**
 * All application services assembled by ApplicationBuilder.
 */
export interface Application {
  platform: PlatformAPI;
  orchestrator: SessionOrchestrator;
  registry: AgentRegistry;
  statusTracker: AgentStatusTracker;
  historyStore: SessionHistoryStore;
  persistentHistory: PersistentHistoryStore | null;
  meshOrchestrator: MeshOrchestrator | null;
  supervisorOrchestrator: SupervisorOrchestrator | null;
  presenter: ChatPresenter;
  chatPanel: ChatPanel | null;
}

/**
 * Composes all application services.  Follows the Builder pattern so
 * optional modules (history, mesh, chat panel) can be added incrementally
 * and the activate() function stays thin.
 */
export class ApplicationBuilder {
  private _platform: PlatformAPI;
  private _orchestrator: SessionOrchestrator;
  private _registry: AgentRegistry;
  private _statusTracker: AgentStatusTracker;
  private _historyStore: SessionHistoryStore;
  private _persistentHistory: PersistentHistoryStore | null = null;
  private _meshOrchestrator: MeshOrchestrator | null = null;
  private _supervisorOrchestrator: SupervisorOrchestrator | null = null;
  private _presenter = new ChatPresenter();
  private _chatPanel: ChatPanel | null = null;
  private _extensionUri: vscode.Uri;

  /** Factory: create + init the platform adapter. */
  static async create(
    context: vscode.ExtensionContext
  ): Promise<ApplicationBuilder> {
    const platform = new VscodePlatform({ context });
    await platform.initialize();
    return new ApplicationBuilder(platform, context.extensionUri);
  }

  private constructor(platform: PlatformAPI, extensionUri: vscode.Uri) {
    this._platform = platform;
    this._extensionUri = extensionUri;
    this._registry = new AgentRegistry(platform);
    this._orchestrator = new SessionOrchestrator({
      ui: platform.ui,
      fs: platform.fs,
    });
    this._statusTracker = new AgentStatusTracker();
    this._historyStore = new SessionHistoryStore(platform.context.globalState);
  }

  /** Wire up persistent history (SQLite-backed). */
  withHistory(): this {
    this._persistentHistory = new PersistentHistoryStore({
      maxAgeDays: 90,
      maxSessions: 1000,
      maxMessagesPerSession: 10000,
    });
    return this;
  }

  /** Create Mesh + Supervisor orchestrators. */
  withMesh(chatPanelRef: { get: () => ChatPanel | null }): this {
    const messageBus = new MessageBus();
    const fileLockManager = new FileLockManager();
    const taskBoardStore = new TaskBoardStore();
    this._meshOrchestrator = new MeshOrchestrator({
      sessionOrchestrator: this._orchestrator,
      messageBus,
      fileLockManager,
      taskBoardStore,
      pushUserMessage: (agentId, sessionId, message) => {
        chatPanelRef.get()?.pushMessage(agentId, sessionId, message);
      },
    });
    this._supervisorOrchestrator = new SupervisorOrchestrator({
      meshOrchestrator: this._meshOrchestrator!,
      sessionOrchestrator: this._orchestrator,
      taskBoardStore,
      postMessage: (msg) => {
        const cp = chatPanelRef.get();
        if (!cp) return;
        cp.postMessage(
          msg as unknown as { type: string; [key: string]: unknown }
        );
      },
    });
    return this;
  }

  /** Convenience: build everything in the standard activation order. */
  buildAll(chatPanelRef: { get: () => ChatPanel | null }): Application {
    this.withHistory();
    this.withMesh(chatPanelRef);
    return this.build();
  }

  build(): Application {
    const logSink = new LogEntrySinkImpl();
    if (this._persistentHistory) {
      logSink.setStore(this._persistentHistory);
    }
    ChatPanel.setLogSink(logSink);

    return {
      platform: this._platform,
      orchestrator: this._orchestrator,
      registry: this._registry,
      statusTracker: this._statusTracker,
      historyStore: this._historyStore,
      persistentHistory: this._persistentHistory,
      meshOrchestrator: this._meshOrchestrator,
      supervisorOrchestrator: this._supervisorOrchestrator,
      presenter: this._presenter,
      chatPanel: this._chatPanel,
    };
  }

  // -- accessors used by activate() --

  get platform(): PlatformAPI {
    return this._platform;
  }
  get orchestrator(): SessionOrchestrator {
    return this._orchestrator;
  }
  get registry(): AgentRegistry {
    return this._registry;
  }
  get statusTracker(): AgentStatusTracker {
    return this._statusTracker;
  }
  get historyStore(): SessionHistoryStore {
    return this._historyStore;
  }
  get persistentHistory(): PersistentHistoryStore | null {
    return this._persistentHistory;
  }
  get meshOrchestrator(): MeshOrchestrator | null {
    return this._meshOrchestrator;
  }
  get supervisorOrchestrator(): SupervisorOrchestrator | null {
    return this._supervisorOrchestrator;
  }
  get presenter(): ChatPresenter {
    return this._presenter;
  }
  get extensionUri(): vscode.Uri {
    return this._extensionUri;
  }

  /** Called after ChatPanel is created — wires the persistent store into the log sink. */
  onHistoryReady(): void {
    if (!this._persistentHistory) return;
    const logSink = new LogEntrySinkImpl();
    logSink.setStore(this._persistentHistory);
    ChatPanel.setLogSink(logSink);
    this._orchestrator.setHistoryStore(this._persistentHistory);
    (this._platform as VscodePlatform).setLogStore(this._persistentHistory);
  }

  /** Defer SQLite init off the critical path; returns a promise that resolves when ready. */
  async initHistory(storagePath: string): Promise<void> {
    if (!this._persistentHistory) return;
    await this._persistentHistory.initialize(storagePath);
    this.onHistoryReady();
  }
}
