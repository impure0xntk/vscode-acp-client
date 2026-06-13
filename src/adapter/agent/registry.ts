import type { AgentConfig } from "../../application/orchestrator";
import type { PlatformAPI } from "../../platform";
import type { Memento } from "../../platform/context";

export type { AgentConfig };

// ============================================================================
// Agent Registry
// ============================================================================

const CUSTOM_AGENTS_KEY = "acp.customAgents";

export class AgentRegistry {
  private settingsAgents: AgentConfig[] = [];
  private customAgents: AgentConfig[] = [];
  private globalState: Memento;

  constructor(platform: PlatformAPI) {
    this.globalState = platform.context.globalState;
    this.settingsAgents = this.loadFromSettings(platform);
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

  private loadCustomAgents(): AgentConfig[] {
    const stored = this.globalState.get<AgentConfig[]>(CUSTOM_AGENTS_KEY);
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored;
  }

  private async persistCustomAgents(agents: AgentConfig[]): Promise<void> {
    await this.globalState.update(CUSTOM_AGENTS_KEY, agents);
  }

  private loadFromSettings(platform: PlatformAPI): AgentConfig[] {
    const config = platform.fs.getConfiguration("acp");
    const agentsObj = config.get<Record<string, AgentConfig>>("agents");
    if (!agentsObj || typeof agentsObj !== "object") {
      return [];
    }
    return Object.entries(agentsObj).map(([key, raw]) => {
      const a = raw as unknown as Record<string, unknown>;
      let autoConnect:
        | import("../../application/orchestrator").AutoConnectEntry[]
        | undefined;
      if (Array.isArray(a.autoConnect)) {
        autoConnect = (a.autoConnect as Array<Record<string, unknown>>).map(
          (entry) => ({
            workspace:
              typeof entry.workspace === "string" ? entry.workspace : undefined,
            sessionName:
              typeof entry.sessionName === "string"
                ? entry.sessionName
                : undefined,
          })
        );
      }
      return {
        id: key,
        name: (a.name as string) ?? key,
        command: (a.command as string) ?? "",
        args: Array.isArray(a.args) ? (a.args as string[]) : [],
        env:
          a.env && typeof a.env === "object"
            ? (a.env as Record<string, string>)
            : {},
        autoConnect,
        openChat: (a.openChat as boolean) !== false,
        icon: a.icon as string | undefined,
        color: a.color as string | undefined,
        maxConcurrentSessions: (a.maxConcurrentSessions as number) ?? 5,
      };
    });
  }
}
