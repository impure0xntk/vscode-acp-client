import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { MeshOrchestrator } from "../../../domain/services/mesh-orchestrator";
import type { SupervisorOrchestrator } from "../../../domain/services/supervisor-orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import { SessionStateBridge } from "../vscode-ui/sessionStateBridge";
import type { ChatPresenter } from "../vscode-ui/presenter";
import type { AgentStatusTracker } from "../../../adapter/agent/status";
import type { SessionHistoryStore } from "../../../application/session/historyStore";
import type { DiagnosticBackend } from "../../../platform/diagnostics";
import { wireOrchestratorEvents } from "./orchestratorEvents";
import { wireMeshEvents } from "./meshEvents";

export interface EventWiringDeps {
  orchestrator: SessionOrchestrator;
  meshOrchestrator: MeshOrchestrator | null;
  supervisorOrchestrator: SupervisorOrchestrator | null;
  /** Session-state bridge — all panels receive events through this. */
  bridge: SessionStateBridge;
  getChatPanel: () => ChatPanel | null;
  presenter: ChatPresenter;
  statusTracker: AgentStatusTracker;
  historyStore: SessionHistoryStore;
  diagnostics: DiagnosticBackend;
  updateContext: () => void;
  sendTabs: () => void;
}

/**
 * Wire all orchestrator → webview event forwarding. Called once from activate().
 */
export function wireAllEvents(deps: EventWiringDeps): void {
  wireOrchestratorEvents({
    orchestrator: deps.orchestrator,
    bridge: deps.bridge,
    getChatPanel: deps.getChatPanel,
    presenter: deps.presenter,
    statusTracker: deps.statusTracker,
    historyStore: deps.historyStore,
    diagnostics: deps.diagnostics,
    updateContext: deps.updateContext,
    sendTabs: deps.sendTabs,
  });

  if (deps.meshOrchestrator) {
    wireMeshEvents({
      meshOrchestrator: deps.meshOrchestrator,
      supervisorOrchestrator: deps.supervisorOrchestrator,
      orchestrator: deps.orchestrator,
      getChatPanel: deps.getChatPanel,
    });
  }
}
