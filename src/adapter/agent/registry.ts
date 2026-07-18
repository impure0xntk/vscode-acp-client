import type { AgentConfig } from "../../application/session/types";
import type { PlatformAPI } from "../../platform";
import type { Memento } from "../../platform/context";

export type { AgentConfig };

export interface PresetSessionEntry {
  agent: string;
  workspace?: string;
  sessionName?: string;
  mode?: string;
  /** Whether the auto-created session should be pinned. Defaults to true. */
  pinned?: boolean;
}

export interface PresetConfig {
  label: string;
  layout?: "single" | "split" | "grid";
  splitRatio?: number;
  sessions: PresetSessionEntry[];
}

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

  /**
   * Load the active preset configuration from settings.
   * Returns the resolved PresetConfig if `acp.presets.default` is set
   * and the named config exists, otherwise undefined.
   */
  loadPreset(platform: PlatformAPI): PresetConfig | undefined {
    const cfg = platform.fs.getConfiguration("acp");
    const presetsObj = cfg.get<{
      default: string;
      configs: Record<string, PresetConfig>;
    }>("presets", { default: "", configs: {} }) ?? { default: "", configs: {} };
    const defaultName = presetsObj.default;
    if (!defaultName) return undefined;

    const configs = presetsObj.configs ?? {};
    const preset = configs[defaultName];
    if (!preset || !Array.isArray(preset.sessions)) return undefined;

    return {
      label: preset.label ?? defaultName,
      layout: preset.layout,
      splitRatio: preset.splitRatio,
      sessions: preset.sessions.map((raw) => {
        const s = raw as unknown as Record<string, unknown>;
        return {
          agent: String(s.agent ?? ""),
          workspace: typeof s.workspace === "string" ? s.workspace : undefined,
          sessionName:
            typeof s.sessionName === "string" ? s.sessionName : undefined,
          mode: typeof s.mode === "string" ? s.mode : undefined,
          pinned:
            typeof s.pinned === "boolean" ? s.pinned : undefined,
        };
      }),
    };
  }

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
        | import("../../application/session/types").AutoConnectEntry[]
        | undefined;
      if (Array.isArray(a.autoConnect)) {
        autoConnect = (a.autoConnect as Array<unknown>)
          .filter(
            (e): e is Record<string, unknown> =>
              typeof e === "object" && e !== null && !Array.isArray(e)
          )
          .filter((entry) => typeof entry.workspace === "string")
          .map((entry) => ({
            workspace: entry.workspace as string,
            sessionName:
              typeof entry.sessionName === "string"
                ? entry.sessionName
                : undefined,
            pinned:
              typeof entry.pinned === "boolean" ? entry.pinned : undefined,
          }));
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
