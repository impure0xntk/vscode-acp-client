// ============================================================================
// Agent Registry — in-memory agent definition store
// ============================================================================

import type { AgentDefinition } from "../models/agent";
import { StateManager } from "./state-manager";

// ============================================================================
// Agent Registry Service
// ============================================================================

export class AgentRegistryService {
  private agents: Map<string, AgentDefinition> = new Map();
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  // ========================================================================
  // Registration
  // ========================================================================

  registerAgent(definition: AgentDefinition): void {
    this.agents.set(definition.id, definition);
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  // ========================================================================
  // Lookup
  // ========================================================================

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

  // ========================================================================
  // Bulk Load
  // ========================================================================

  loadAgents(definitions: AgentDefinition[]): void {
    for (const def of definitions) {
      this.agents.set(def.id, def);
    }
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  dispose(): void {
    this.agents.clear();
  }
}
