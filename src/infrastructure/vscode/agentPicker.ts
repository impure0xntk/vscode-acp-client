import * as vscode from "vscode";
import type { AgentRegistry } from "../../adapter/agent/registry";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { AgentConfig } from "../../application/session/types";

/** Show quick-pick for an agent by name, or pick interactively if name not given. */
export async function pickAgentByName(
  registry: AgentRegistry,
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

/** Show quick-pick for an already-connected agent. */
export async function pickConnectedAgent(
  orchestrator: SessionOrchestrator,
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
