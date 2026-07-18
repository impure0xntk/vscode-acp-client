import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { AgentRegistry } from "../../adapter/agent/registry";
import type { ChatPanel } from "./vscode-ui/chatPanel";
import type { ChatPresenter } from "./vscode-ui/presenter";

let sendTabsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let sendTabsScheduled = false;

function updateContext(orchestrator: SessionOrchestrator): void {
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

function sendOverviewPosition(getChatPanel: () => ChatPanel | null): void {
  const pos = vscode.workspace
    .getConfiguration("acp")
    .get<string>("sessionOverviewPosition", "right");
  getChatPanel()?.postMessage({
    type: "sessionOverview:position",
    payload: { position: pos },
  });
}

function sendTabsToChatPanel(
  orchestrator: SessionOrchestrator,
  registry: AgentRegistry,
  presenter: ChatPresenter,
  getChatPanel: () => ChatPanel | null,
  immediate = false
): void {
  if (immediate) {
    if (sendTabsDebounceTimer) {
      clearTimeout(sendTabsDebounceTimer);
      sendTabsDebounceTimer = null;
    }
    sendTabsScheduled = false;
    sendTabsNow(orchestrator, registry, presenter, getChatPanel);
    return;
  }
  if (sendTabsScheduled) return;
  sendTabsScheduled = true;
  sendTabsDebounceTimer = setTimeout(() => {
    sendTabsDebounceTimer = null;
    sendTabsScheduled = false;
    sendTabsNow(orchestrator, registry, presenter, getChatPanel);
  }, 100);
}

function sendTabsNow(
  orchestrator: SessionOrchestrator,
  registry: AgentRegistry,
  presenter: ChatPresenter,
  getChatPanel: () => ChatPanel | null
): void {
  const cp = getChatPanel();
  if (!cp) return;

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
        cp.pushSessionInfo(agentStatus.agentId, s.sessionId, info);
      }
      validKeys.add(`${agentStatus.agentId}:${s.sessionId}`);
    }
  }

  // Remove stale tabs
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
    presenter.setActiveSession(allTabs[0].agentId, allTabs[0].sessionId);
  }

  cp.postMessage(presenter.buildSetTabsMessage());

  const overview = orchestrator.getSessionOverview({
    withRecentResponses: false,
  });
  cp.postMessage({
    type: "sessionOverview:state",
    payload: overview,
  });
}

export { updateContext, sendOverviewPosition, sendTabsToChatPanel };
