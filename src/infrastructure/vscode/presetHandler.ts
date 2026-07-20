import * as vscode from "vscode";
import * as path from "path";
import { getLogger } from "../../platform/backends";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { AgentRegistry } from "../../adapter/agent/registry";
import type { PlatformAPI } from "../../platform/platform";
import type { ChatPresenter } from "./vscode-ui/presenter";
import type { PresetConfig } from "../../domain/models/agent";
import type {
  AgentConfig,
  AutoConnectEntry,
} from "../../application/session/types";
import type { PersistentHistoryStore } from "../../application/session/persistentHistory";
import type { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";
import type { SupervisorOrchestrator } from "../../domain/services/supervisor-orchestrator";
import { SessionStateBridge } from "./vscode-ui/sessionStateBridge";
import { ChatPanel } from "./vscode-ui/chatPanel";
import { wireChatPanelEvents } from "./commands/prompt";
import {
  getChatPanel,
  setChatPanel,
  resolveFile,
  resolveSelection,
  resolveDiff,
  searchFiles,
  searchSymbols,
  resolveSymbolByName,
} from "./contextHelpers";
import { sendTabsToChatPanel } from "./tabsHandler";
import { scheduleStatuslineInfo } from "./statuslineHelpers";
import { pickAgentByName } from "./agentPicker";

const log = getLogger("presetHandler");

// -- Dependencies -------------------------------------------------------------

export interface PresetDeps {
  orchestrator: SessionOrchestrator;
  registry: AgentRegistry;
  platform: PlatformAPI;
  presenter: ChatPresenter;
  bridge: SessionStateBridge;
  persistentHistory: PersistentHistoryStore | null;
  meshOrchestrator: MeshOrchestrator | null;
  supervisorOrchestrator: SupervisorOrchestrator | null;
  extensionUri: vscode.Uri;
}

// -- Internal: wire chat panel events -----------------------------------------

function wireChatPanelEventsLocal(deps: PresetDeps): void {
  const p = deps.platform;
  wireChatPanelEvents(
    getChatPanel(),
    deps.orchestrator,
    () =>
      sendTabsToChatPanel(
        deps.orchestrator,
        deps.registry,
        deps.presenter,
        deps.bridge
      ),
    (fp, cwd?) => resolveFile(p, fp, cwd),
    () => resolveSelection(p),
    () => resolveDiff(p),
    (q, cwd?) => searchFiles(p, q, cwd),
    (q) => searchSymbols(p, q),
    (name) => resolveSymbolByName(p, name),
    deps.persistentHistory ?? undefined,
    deps.meshOrchestrator ?? undefined,
    deps.supervisorOrchestrator ?? undefined
  );
}

// -- Internal: ensure chat panel is created -----------------------------------

function ensureChatPanelReady(deps: PresetDeps): void {
  if (getChatPanel()) return;

  const panel = ChatPanel.reveal(deps.extensionUri);
  setChatPanel(panel);
  wireChatPanelEventsLocal(deps);
  sendTabsToChatPanel(
    deps.orchestrator,
    deps.registry,
    deps.presenter,
    deps.bridge,
    true
  );

  // Mirror the active-session restore logic
  const agents = deps.orchestrator.getAllAgents();
  if (agents.length > 0) {
    const active = agents[0];
    const activeSess =
      active.sessions.find(
        (s) =>
          deps.orchestrator.getActiveSessionId(active.agentId) === s.sessionId
      ) ?? active.sessions[0];
    if (activeSess) {
      const info = deps.orchestrator.getSessionInfo(
        active.agentId,
        activeSess.sessionId
      );
      if (info) {
        getChatPanel()?.setActiveSession(
          active.agentId,
          activeSess.sessionId,
          info
        );
      }
    }
  }
}

// -- applyPreset --------------------------------------------------------------

export async function applyPreset(
  deps: PresetDeps,
  preset: PresetConfig
): Promise<void> {
  const { orchestrator, registry, bridge } = deps;
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

  // Ensure chat panel is created
  ensureChatPanelReady(deps);

  const panel = getChatPanel();
  if (panel) {
    scheduleStatuslineInfo(getChatPanel);
    if (preset.layout) {
      bridge.postMessage({
        type: "unifiedChat:setLayout",
        layout: preset.layout,
        splitRatio: preset.splitRatio,
      });
    }
    for (const s of connectedSessions) {
      if (orchestrator.isSessionPinned(s.agentId, s.sessionId)) {
        bridge.postMessage({
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

// -- cmdConnect ---------------------------------------------------------------

export async function cmdConnect(
  deps: PresetDeps,
  agentConfig?: AgentConfig | string,
  entry?: AutoConnectEntry,
  autoOpenChat = true
): Promise<void> {
  const { orchestrator, registry, bridge } = deps;

  let config: AgentConfig;
  if (typeof agentConfig === "string" || !agentConfig) {
    const name = typeof agentConfig === "string" ? agentConfig : undefined;
    const resolved = await pickAgentByName(registry, name);
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

    if (entry?.pinned !== false) {
      orchestrator.pinSession(config.id, sessionId);
    }

    if (autoOpenChat) {
      ensureChatPanelReady(deps);
      const info = orchestrator.getSessionInfo(config.id, sessionId);
      if (info) getChatPanel()?.setActiveSession(config.id, sessionId, info);
      scheduleStatuslineInfo(getChatPanel);
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
