import * as assert from "assert";
import { describe, it } from "mocha";
import { AgentRegistry } from "../../adapter/agent/registry";
import type { PlatformAPI } from "../../platform/platform";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { ExtensionContextAPI } from "../../platform/context";
import type { Memento } from "../../platform/context";

// ============================================================================
// Helpers — minimal stubs
// ============================================================================

function makeMemento(): Memento {
  return {
    get: () => undefined,
    update: async () => {},
    keys: () => [],
    setKeysForSync: () => {},
  };
}

function makePlatform(configValues: Record<string, unknown>): PlatformAPI {
  const fsStub: FileSystemAPI = {
    readFile: async () => "",
    writeFile: async () => {},
    fileExists: async () => false,
    stat: async () => ({ type: "file", mtime: 0, size: 0 }),
    findFiles: async () => [],
    watchFiles: () => () => {},
    captureSnapshot: async () => ({ path: "", content: "", mtime: 0 }),
    uri: () => ({
      scheme: "file",
      fsPath: "",
      path: "",
      with: () => ({}) as any,
      toString: () => "",
    }),
    joinPath: () => ({
      scheme: "file",
      fsPath: "",
      path: "",
      with: () => ({}) as any,
      toString: () => "",
    }),
    basename: () => "",
    dirname: () => "",
    relativePath: () => "",
    isAbsolutePath: (p: string) => p.startsWith("/"),
    getConfiguration: () => ({
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const v = configValues[key];
        return v !== undefined ? (v as T) : defaultValue;
      },
    }),
    workspaceRoots: ["/workspace"],
    workspaceRoot: "/workspace",
    resolvePath: (base: string, rel: string) =>
      rel.startsWith("/") ? rel : `${base}/${rel}`,
  };

  const ctxStub: ExtensionContextAPI = {
    globalState: makeMemento(),
    workspaceState: makeMemento(),
    storageUri: undefined,
    extensionUri: {
      scheme: "file",
      fsPath: "",
      path: "",
      with: () => ({}) as any,
      toString: () => "",
    },
    addSubscription: () => {},
  };

  return {
    platform: "node",
    version: "0.0.0",
    fs: fsStub,
    context: ctxStub,
    editor: {} as any,
    terminal: {} as any,
    orchestration: {} as any,
    logStorage: {} as any,
    ui: {} as any,
    initialize: async () => {},
    dispose: async () => {},
  };
}

// ============================================================================
// AgentRegistry — loadFromSettings
// ============================================================================

describe("AgentRegistry — loadFromSettings", () => {
  it("returns empty when no agents configured", () => {
    const platform = makePlatform({});
    const registry = new AgentRegistry(platform);
    const agents = registry.getAgents();
    assert.strictEqual(agents.length, 0);
  });

  it("loads a single agent", () => {
    const platform = makePlatform({
      agents: {
        claude: {
          name: "Claude",
          command: "npx",
          args: ["@anthropic/claude-agent-acp"],
          env: { ANTHROPIC_API_KEY: "test" },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const agents = registry.getAgents();
    assert.strictEqual(agents.length, 1);
    const agent = agents[0];
    assert.strictEqual(agent.id, "claude");
    assert.strictEqual(agent.name, "Claude");
    assert.strictEqual(agent.command, "npx");
    assert.deepStrictEqual(agent.args, ["@anthropic/claude-agent-acp"]);
    assert.deepStrictEqual(agent.env, { ANTHROPIC_API_KEY: "test" });
  });

  it("loads multiple agents", () => {
    const platform = makePlatform({
      agents: {
        claude: { command: "npx", args: ["claude-acp"] },
        goose: { command: "goose", args: ["acp"] },
      },
    });
    const registry = new AgentRegistry(platform);
    const agents = registry.getAgents();
    assert.strictEqual(agents.length, 2);
    const ids = agents.map((a) => a.id).sort();
    assert.deepStrictEqual(ids, ["claude", "goose"]);
  });

  it("uses id as name when name is missing", () => {
    const platform = makePlatform({
      agents: {
        myagent: { command: "echo", args: [] },
      },
    });
    const registry = new AgentRegistry(platform);
    const agent = registry.getAgent("myagent");
    assert.ok(agent);
    assert.strictEqual(agent!.name, "myagent");
  });

  it("defaults args to empty array", () => {
    const platform = makePlatform({
      agents: {
        a: { command: "echo" },
      },
    });
    const registry = new AgentRegistry(platform);
    const agent = registry.getAgent("a");
    assert.ok(agent);
    assert.deepStrictEqual(agent!.args, []);
  });

  it("defaults env to empty object", () => {
    const platform = makePlatform({
      agents: {
        a: { command: "echo", args: [] },
      },
    });
    const registry = new AgentRegistry(platform);
    const agent = registry.getAgent("a");
    assert.ok(agent);
    assert.deepStrictEqual(agent!.env, {});
  });

  it("defaults openChat to true", () => {
    const platform = makePlatform({
      agents: {
        a: { command: "echo" },
      },
    });
    const registry = new AgentRegistry(platform);
    const agent = registry.getAgent("a");
    assert.ok(agent);
    assert.strictEqual(agent!.openChat, true);
  });

  it("respects openChat false", () => {
    const platform = makePlatform({
      agents: {
        a: { command: "echo", openChat: false },
      },
    });
    const registry = new AgentRegistry(platform);
    const agent = registry.getAgent("a");
    assert.ok(agent);
    assert.strictEqual(agent!.openChat, false);
  });

  it("defaults maxConcurrentSessions to 5", () => {
    const platform = makePlatform({
      agents: {
        a: { command: "echo" },
      },
    });
    const registry = new AgentRegistry(platform);
    const agent = registry.getAgent("a");
    assert.ok(agent);
    assert.strictEqual(agent!.maxConcurrentSessions, 5);
  });

  it("parses autoConnect entries", () => {
    const platform = makePlatform({
      agents: {
        a: {
          command: "echo",
          autoConnect: [
            { workspace: "/path/to/ws1", sessionName: "Backend" },
            { workspace: "/path/to/ws2" },
          ],
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const agents = registry.getAutoConnectAgents();
    assert.strictEqual(agents.length, 1);
    assert.strictEqual(agents[0].autoConnect!.length, 2);
    assert.strictEqual(agents[0].autoConnect![0].workspace, "/path/to/ws1");
    assert.strictEqual(agents[0].autoConnect![0].sessionName, "Backend");
    assert.strictEqual(agents[0].autoConnect![1].workspace, "/path/to/ws2");
    assert.strictEqual(agents[0].autoConnect![1].sessionName, undefined);
  });

  it("getAutoConnectAgents filters agents without autoConnect", () => {
    const platform = makePlatform({
      agents: {
        a: { command: "echo" },
        b: {
          command: "echo",
          autoConnect: [{ workspace: "/ws" }],
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const auto = registry.getAutoConnectAgents();
    assert.strictEqual(auto.length, 1);
    assert.strictEqual(auto[0].id, "b");
  });

  it("skips invalid autoConnect entries", () => {
    const platform = makePlatform({
      agents: {
        a: {
          command: "echo",
          autoConnect: [
            { workspace: "/valid" },
            "not-an-object",
            { name: "missing-workspace" },
          ],
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const agent = registry.getAgent("a");
    assert.ok(agent);
    // Only the valid entry survives; malformed entries are skipped by
    // the guard in loadFromSettings that requires workspace to be a string.
    assert.strictEqual(agent!.autoConnect!.length, 1);
  });
});

// ============================================================================
// AgentRegistry — getAgent / getAgents
// ============================================================================

describe("AgentRegistry — getAgent / getAgents", () => {
  it("returns undefined for unknown agent", () => {
    const platform = makePlatform({});
    const registry = new AgentRegistry(platform);
    assert.strictEqual(registry.getAgent("nope"), undefined);
  });

  it("finds agent by id", () => {
    const platform = makePlatform({
      agents: { a: { command: "echo" } },
    });
    const registry = new AgentRegistry(platform);
    assert.ok(registry.getAgent("a"));
    assert.strictEqual(registry.getAgent("a")!.command, "echo");
  });

  it("getAgents returns all configured agents", () => {
    const platform = makePlatform({
      agents: {
        a: { command: "echo" },
        b: { command: "cat" },
      },
    });
    const registry = new AgentRegistry(platform);
    const agents = registry.getAgents();
    assert.strictEqual(agents.length, 2);
  });

  it("custom agents override settings agents with same id", async () => {
    const platform = makePlatform({
      agents: { a: { command: "echo", args: ["old"] } },
    });
    const registry = new AgentRegistry(platform);
    await registry.addAgent({
      id: "a",
      name: "Override",
      command: "echo",
      args: ["new"],
    });
    const agent = registry.getAgent("a");
    assert.ok(agent);
    assert.strictEqual(agent!.name, "Override");
    assert.deepStrictEqual(agent!.args, ["new"]);
  });
});

// ============================================================================
// AgentRegistry — loadPreset
// ============================================================================

describe("AgentRegistry.loadPreset", () => {
  it("returns undefined when acp.presets is empty", () => {
    const platform = makePlatform({});
    const registry = new AgentRegistry(platform);
    assert.strictEqual(registry.loadPreset(platform), undefined);
  });

  it("returns undefined when default name is empty", () => {
    const platform = makePlatform({
      presets: { default: "", configs: {} },
    });
    const registry = new AgentRegistry(platform);
    assert.strictEqual(registry.loadPreset(platform), undefined);
  });

  it("returns undefined when named config does not exist", () => {
    const platform = makePlatform({
      presets: { default: "nonexistent", configs: {} },
    });
    const registry = new AgentRegistry(platform);
    assert.strictEqual(registry.loadPreset(platform), undefined);
  });

  it("returns undefined when config has no sessions array", () => {
    const platform = makePlatform({
      presets: {
        default: "broken",
        configs: { broken: { label: "Broken" } },
      },
    });
    const registry = new AgentRegistry(platform);
    assert.strictEqual(registry.loadPreset(platform), undefined);
  });

  it("returns undefined when sessions is not an array", () => {
    const platform = makePlatform({
      presets: {
        default: "bad",
        configs: { bad: { label: "Bad", sessions: "not-an-array" } },
      },
    });
    const registry = new AgentRegistry(platform);
    assert.strictEqual(registry.loadPreset(platform), undefined);
  });

  it("resolves a minimal valid preset", () => {
    const platform = makePlatform({
      presets: {
        default: "dev",
        configs: {
          dev: {
            label: "dev",
            sessions: [{ agent: "claude" }],
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.label, "dev");
    assert.strictEqual(preset!.sessions.length, 1);
    assert.strictEqual(preset!.sessions[0].agent, "claude");
  });

  it("reads layout and splitRatio from preset config", () => {
    const platform = makePlatform({
      presets: {
        default: "dev",
        configs: {
          dev: {
            label: "dev",
            layout: "split",
            splitRatio: 0.6,
            sessions: [{ agent: "claude" }],
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.layout, "split");
    assert.strictEqual(preset!.splitRatio, 0.6);
  });

  it("reads grid layout", () => {
    const platform = makePlatform({
      presets: {
        default: "grid",
        configs: {
          grid: {
            label: "Grid",
            layout: "grid",
            sessions: [{ agent: "a" }, { agent: "b" }],
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.layout, "grid");
  });

  it("preserves session-level workspace, sessionName, and mode", () => {
    const platform = makePlatform({
      presets: {
        default: "dev",
        configs: {
          dev: {
            label: "dev",
            sessions: [
              { agent: "claude", workspace: "../../", sessionName: "Backend 1" },
              { agent: "goose", workspace: "/absolute/path", sessionName: "Frontend 1", mode: "review" },
            ],
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.sessions.length, 2);
    assert.strictEqual(preset!.sessions[0].workspace, "../../");
    assert.strictEqual(preset!.sessions[0].sessionName, "Backend 1");
    assert.strictEqual(preset!.sessions[1].workspace, "/absolute/path");
    assert.strictEqual(preset!.sessions[1].sessionName, "Frontend 1");
    assert.strictEqual(preset!.sessions[1].mode, "review");
  });

  it("uses defaultName as label when label is missing", () => {
    const platform = makePlatform({
      presets: {
        default: "myPreset",
        configs: { myPreset: { sessions: [{ agent: "claude" }] } },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.label, "myPreset");
  });

  it("handles multiple sessions for the same agent", () => {
    const platform = makePlatform({
      presets: {
        default: "multi",
        configs: {
          multi: {
            label: "Multi",
            sessions: [
              { agent: "claude", sessionName: "Backend 1" },
              { agent: "claude", sessionName: "Backend 2" },
              { agent: "claude", sessionName: "Frontend 1" },
              { agent: "claude", sessionName: "Frontend 2" },
            ],
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.sessions.length, 4);
    assert.strictEqual(preset!.sessions[0].sessionName, "Backend 1");
    assert.strictEqual(preset!.sessions[3].sessionName, "Frontend 2");
  });

  it("handles single-agent preset with no layout (single)", () => {
    const platform = makePlatform({
      presets: {
        default: "solo",
        configs: {
          solo: {
            label: "Solo",
            sessions: [{ agent: "claude", sessionName: "Main" }],
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.layout, undefined);
    assert.strictEqual(preset!.splitRatio, undefined);
  });

  it("handles layout 'single' explicitly", () => {
    const platform = makePlatform({
      presets: {
        default: "single",
        configs: {
          single: {
            label: "Single",
            layout: "single",
            sessions: [{ agent: "a" }],
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    const preset = registry.loadPreset(platform);
    assert.ok(preset);
    assert.strictEqual(preset!.layout, "single");
  });
});
