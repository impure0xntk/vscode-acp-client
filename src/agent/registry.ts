import * as vscode from "vscode";
import type { AgentConfig } from "../session/orchestrator";

export type { AgentConfig };

// ============================================================================
// Agent Registry
// ============================================================================

const CUSTOM_AGENTS_KEY = "acp.customAgents";

export class AgentRegistry {
  private settingsAgents: AgentConfig[] = [];
  private customAgents: AgentConfig[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.settingsAgents = this.loadFromSettings();
    this.customAgents = this.loadCustomAgents();
  }

  // ========================================================================
  // Public API
  // ========================================================================

  getAgents(): AgentConfig[] {
    const merged = new Map<string, AgentConfig>();
    for (const agent of this.settingsAgents) {
      merged.set(agent.id, agent);
    }
    for (const agent of this.customAgents) {
      merged.set(agent.id, agent);
    }
    return Array.from(merged.values());
  }

  getAgent(id: string): AgentConfig | undefined {
    const custom = this.customAgents.find((a) => a.id === id);
    if (custom) {
      return custom;
    }
    return this.settingsAgents.find((a) => a.id === id);
  }

  async addAgent(config: AgentConfig): Promise<void> {
    const idx = this.customAgents.findIndex((a) => a.id === config.id);
    if (idx >= 0) {
      this.customAgents[idx] = config;
    } else {
      this.customAgents.push(config);
    }
    await this.persistCustomAgents(this.customAgents);
  }

  async removeAgent(id: string): Promise<void> {
    this.customAgents = this.customAgents.filter((a) => a.id !== id);
    await this.persistCustomAgents(this.customAgents);
  }

  async updateAgent(id: string, updates: Partial<AgentConfig>): Promise<void> {
    const idx = this.customAgents.findIndex((a) => a.id === id);
    if (idx >= 0) {
      this.customAgents[idx] = { ...this.customAgents[idx], ...updates };
      await this.persistCustomAgents(this.customAgents);
    } else {
      const settingsAgent = this.settingsAgents.find((a) => a.id === id);
      if (settingsAgent) {
        const merged = { ...settingsAgent, ...updates, id };
        this.customAgents.push(merged);
        await this.persistCustomAgents(this.customAgents);
      }
    }
  }

  getAutoConnectAgents(): AgentConfig[] {
    return this.getAgents().filter((a) => (a.autoConnect?.length ?? 0) > 0);
  }

  // ========================================================================
  // Private
  // ========================================================================

  private loadFromSettings(): AgentConfig[] {
    const config = vscode.workspace.getConfiguration("acp");
    const agentsObj = config.get<Record<string, AgentConfig>>("agents");
    if (!agentsObj || typeof agentsObj !== "object") {
      return [];
    }
    return Object.entries(agentsObj).map(([key, a]) => {
      // autoConnect: AutoConnectEntry[] (array only)
      let autoConnect: import("../session/orchestrator").AutoConnectEntry[] | undefined;
      if (Array.isArray(a.autoConnect)) {
        autoConnect = (a.autoConnect as Array<Record<string, unknown>>).map((entry) => ({
          workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
          sessionName: typeof entry.sessionName === "string" ? entry.sessionName : undefined,
        }));
      }
      return {
        id: key,
        name: a.name ?? key,
        command: a.command ?? "",
        args: Array.isArray(a.args) ? a.args : [],
        env: a.env && typeof a.env === "object" ? a.env : {},
        autoConnect,
        openChat: a.openChat !== false,
        icon: a.icon,
        color: a.color,
        maxConcurrentSessions: a.maxConcurrentSessions ?? 5,
      };
    });
  }

  private loadCustomAgents(): AgentConfig[] {
    const stored = this.context.globalState.get<AgentConfig[]>(CUSTOM_AGENTS_KEY);
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored;
  }

  private async persistCustomAgents(agents: AgentConfig[]): Promise<void> {
    await this.context.globalState.update(CUSTOM_AGENTS_KEY, agents);
  }
}
