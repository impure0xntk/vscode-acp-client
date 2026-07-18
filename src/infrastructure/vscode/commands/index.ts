import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { AgentRegistry } from "../../../adapter/agent/registry";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type { AgentConfig } from "../../../application/session/types";
import type { PersistentHistoryStore } from "../../../application/session/persistentHistory";
import type { ContextAttachmentDTO } from "../../../domain/models/chat";
import type { DiagnosticProblem } from "../../../platform/editor";
import type { SerializedRange } from "../../../adapter/context/assembler";
import { registerConnectCommands, ensureChatPanel } from "./connect";
import { registerSessionCommands } from "./session";
import { registerQuickFixCommands } from "./quickfix";
import { registerUICommands } from "./uiCommands";
import { registerMeshCommands } from "./meshCommands";
import { registerExportDebugLogCommand } from "./exportDebugLog";
import { registerProblemQuickFixProvider } from "./problemQuickFix";

export { ensureChatPanel };

/**
 * All dependencies needed by the command registration modules.
 */
export interface CommandRegDeps {
  context: vscode.ExtensionContext;
  orchestrator: SessionOrchestrator;
  registry: AgentRegistry;
  getChatPanel: () => ChatPanel | null;
  setChatPanel: (panel: ChatPanel) => void;
  sendTabs: () => void;
  wireChatPanelEvents: () => void;
  pickConnectedAgent: (placeHolder: string) => Promise<string | undefined>;
  pickAgentByName: (name?: string) => Promise<AgentConfig | undefined>;
  historyStore: {
    getEntries: () => Array<{
      sessionId: string;
      agentId: string;
      title: string;
      cwd: string;
      status: string;
      createdAt: string;
      messageCount: number;
      tokenUsage: { input: number; output: number; total: number };
    }>;
    clear: () => Promise<void>;
  };
  persistentHistory: PersistentHistoryStore | null;
  resolveFile: (path: string, cwd?: string) => Promise<ContextAttachmentDTO>;
  resolveSelection: () => Promise<ContextAttachmentDTO | null>;
  resolveDiff: () => Promise<ContextAttachmentDTO | null>;
  resolveProblem: (problem: DiagnosticProblem) => Promise<ContextAttachmentDTO | null>;
  resolveRangeAt: (uri: string, range: SerializedRange) => Promise<ContextAttachmentDTO | null>;
}

/**
 * Register all VS Code commands. Called once from activate().
 */
export function registerAllCommands(deps: CommandRegDeps): void {
  const {
    context,
    orchestrator,
    registry,
    getChatPanel,
    setChatPanel,
    sendTabs,
    wireChatPanelEvents,
    pickConnectedAgent,
    pickAgentByName,
    historyStore,
    persistentHistory,
    resolveFile,
    resolveSelection,
    resolveDiff,
    resolveProblem,
    resolveRangeAt,
  } = deps;

  const extensionUri = context.extensionUri;

  const ensureCp = () =>
    ensureChatPanel(
      getChatPanel,
      setChatPanel,
      extensionUri,
      sendTabs,
      wireChatPanelEvents,
      orchestrator
    );

  const connectDisposables = registerConnectCommands(
    context,
    orchestrator,
    registry,
    getChatPanel,
    setChatPanel,
    sendTabs,
    wireChatPanelEvents,
    pickConnectedAgent,
    pickAgentByName
  );

  const sessionDisposables = registerSessionCommands(
    orchestrator,
    registry,
    getChatPanel,
    ensureCp,
    pickConnectedAgent,
    historyStore,
    persistentHistory,
    resolveFile,
    resolveSelection,
    resolveDiff,
    resolveProblem,
    sendTabs
  );

  const quickFixDisposables = registerQuickFixCommands(
    orchestrator,
    getChatPanel,
    ensureCp,
    resolveSelection,
    resolveRangeAt
  );

  const uiDisposables = registerUICommands(ensureCp, getChatPanel, context);
  const meshDisposables = registerMeshCommands(getChatPanel, ensureCp, context);
  const exportDebugLogDisposable = registerExportDebugLogCommand(
    context,
    () => persistentHistory
  );
  const problemQuickFixDisposable = registerProblemQuickFixProvider();

  for (const d of [
    ...connectDisposables,
    ...sessionDisposables,
    ...quickFixDisposables,
    ...uiDisposables,
    ...meshDisposables,
    exportDebugLogDisposable,
    problemQuickFixDisposable,
  ]) {
    context.subscriptions.push(d);
  }
}
