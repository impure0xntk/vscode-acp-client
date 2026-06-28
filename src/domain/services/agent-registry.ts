import type { AgentDefinition } from "../models/agent";
import { StateManager } from "./state-manager";

export class AgentRegistryService {
  private agents: Map<string, AgentDefinition> = new Map();
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  registerAgent(definition: AgentDefinition): void {
    this.agents.set(definition.id, definition);
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  getAgent(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  findAgentByTool(toolName: string): AgentDefinition[] {
    const result: AgentDefinition[] = [];
    for (const [, agent] of this.agents) {
      if (agent.allowedTools.includes(toolName)) {
        result.push(agent);
      }
    }
    return result;
  }

  getHandoffTargets(agentId: string): AgentDefinition[] {
    const agent = this.agents.get(agentId);
    if (!agent?.handoffs) return [];
    return agent.handoffs
      .map((id) => this.agents.get(id))
      .filter((a): a is AgentDefinition => a !== undefined);
  }

  listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  loadAgents(definitions: AgentDefinition[]): void {
    for (const def of definitions) {
      this.agents.set(def.id, def);
    }
  }

  dispose(): void {
    this.agents.clear();
  }
}
