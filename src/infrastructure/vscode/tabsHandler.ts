import * as vscode from "vscode";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { AgentRegistry } from "../../adapter/agent/registry";
import { SessionStateBridge } from "./vscode-ui/sessionStateBridge";
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

function sendOverviewPosition(bridge: SessionStateBridge): void {
  const pos = vscode.workspace
    .getConfiguration("acp")
    .get<string>("sessionOverviewPosition", "right");
  bridge.postMessage({
    type: "sessionOverview:position",
    payload: { position: pos },
  });
}

function sendTabsToBridge(
  orchestrator: SessionOrchestrator,
  registry: AgentRegistry,
  presenter: ChatPresenter,
  bridge: SessionStateBridge,
  immediate = false
): void {
  if (immediate) {
    if (sendTabsDebounceTimer) {
      clearTimeout(sendTabsDebounceTimer);
      sendTabsDebounceTimer = null;
    }
    sendTabsScheduled = false;
    sendTabsNow(orchestrator, registry, presenter, bridge);
    return;
  }
  if (sendTabsScheduled) return;
  sendTabsScheduled = true;
  sendTabsDebounceTimer = setTimeout(() => {
    sendTabsDebounceTimer = null;
    sendTabsScheduled = false;
    sendTabsNow(orchestrator, registry, presenter, bridge);
  }, 100);
}

function sendTabsNow(
  orchestrator: SessionOrchestrator,
  registry: AgentRegistry,
  presenter: ChatPresenter,
  bridge: SessionStateBridge
): void {
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

  const setTabsMsg = presenter.buildSetTabsMessage();

  const overview = orchestrator.getSessionOverview({
    withRecentResponses: false,
  });

  const overviewMsg = {
    type: "sessionOverview:state",
    payload: overview,
  };

  // Broadcast to all registered panels via the bridge (FR-7).
  bridge.postMessage(setTabsMsg);
  bridge.postMessage(overviewMsg);

  // Push full session snapshots so every panel's webview messageStore
  // has messages for the drill-down / restore use case.
  //
  // IMPORTANT: Only push snapshots for sessions that actually have messages
  // in the extension host's SessionState.  Messages are stored in the webview's
  // messageStore via streaming chunks (pushStreamChunk → appendStreamChunk),
  // but the extension host's AppSessionInfo.messages may be empty if the
  // streaming path didn't go through orchestrator.appendMessage().
  // Pushing an empty snapshot would overwrite the webview's message store
  // and make the user's conversation history disappear.
  for (const agentStatus of orchestrator.getAllAgents()) {
    for (const s of agentStatus.sessions) {
      const info = orchestrator.getSessionInfo(
        agentStatus.agentId,
        s.sessionId
      );
      // Only push snapshot if the session has messages in the extension host.
      // Empty snapshots are harmful — they'd wipe out the webview's message store.
      // New sessions without messages don't need snapshots either (setTabs handles
      // the tab creation, and messages arrive via streaming).
      if (info && info.messages.length > 0) {
        bridge.pushSessionSnapshot(agentStatus.agentId, s.sessionId, info);
      }
    }
  }
}

export {
  updateContext,
  sendOverviewPosition,
  sendTabsToBridge as sendTabsToChatPanel,
};
