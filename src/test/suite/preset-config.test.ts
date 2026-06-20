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
    findFilesInDirectory: async () => [],
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
// AgentRegistry.loadPreset — settings reading
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

  it("preserves session-level workspace and sessionName", () => {
    const platform = makePlatform({
      presets: {
        default: "dev",
        configs: {
          dev: {
            label: "dev",
            sessions: [
              {
                agent: "claude",
                workspace: "../../",
                sessionName: "Backend 1",
              },
              {
                agent: "goose",
                workspace: "/absolute/path",
                sessionName: "Frontend 1",
                mode: "review",
              },
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
        configs: {
          myPreset: {
            sessions: [{ agent: "claude" }],
          },
        },
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

  it("returns undefined when sessions is not an array", () => {
    const platform = makePlatform({
      presets: {
        default: "bad",
        configs: {
          bad: {
            label: "Bad",
            sessions: "not-an-array",
          },
        },
      },
    });
    const registry = new AgentRegistry(platform);
    assert.strictEqual(registry.loadPreset(platform), undefined);
  });
});
