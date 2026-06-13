import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { AgentRegistryService } from "../../domain/services/agent-registry";
import { StateManager } from "../../domain/services/state-manager";
import type { AgentDefinition } from "../../domain/models/agent";

// ============================================================================
// Agent Registry Service Tests
// ============================================================================

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "claude",
    name: "Claude",
    description: "Test agent",
    systemPrompt: "You are a test agent.",
    allowedTools: ["read_file", "write_file"],
    ...overrides,
  };
}

describe("AgentRegistryService — Registration", () => {
  let sm: StateManager;
  let registry: AgentRegistryService;

  beforeEach(() => {
    sm = new StateManager();
    registry = new AgentRegistryService(sm);
  });

  it("registers an agent", () => {
    const agent = makeAgent();
    registry.registerAgent(agent);
    assert.ok(registry.getAgent("claude"));
    assert.strictEqual(registry.getAgent("claude")!.name, "Claude");
  });

  it("unregisters an agent", () => {
    registry.registerAgent(makeAgent());
    registry.unregisterAgent("claude");
    assert.strictEqual(registry.getAgent("claude"), undefined);
  });

  it("loadAgents registers multiple agents", () => {
    const agents = [
      makeAgent({ id: "claude", name: "Claude" }),
      makeAgent({ id: "gpt4", name: "GPT-4" }),
    ];
    registry.loadAgents(agents);
    assert.strictEqual(registry.listAgents().length, 2);
    assert.ok(registry.getAgent("claude"));
    assert.ok(registry.getAgent("gpt4"));
  });
});

describe("AgentRegistryService — Lookup", () => {
  let registry: AgentRegistryService;

  beforeEach(() => {
    const sm = new StateManager();
    registry = new AgentRegistryService(sm);
    registry.loadAgents([
      makeAgent({ id: "claude", allowedTools: ["read_file", "write_file"] }),
      makeAgent({ id: "gpt4", allowedTools: ["read_file", "execute"] }),
    ]);
  });

  it("getAgent returns undefined for unknown agent", () => {
    assert.strictEqual(registry.getAgent("unknown"), undefined);
  });

  it("findAgentByTool returns matching agents", () => {
    const result = registry.findAgentByTool("read_file");
    assert.strictEqual(result.length, 2);
  });

  it("findAgentByTool returns empty for unknown tool", () => {
    const result = registry.findAgentByTool("nonexistent_tool");
    assert.strictEqual(result.length, 0);
  });

  it("listAgents returns all registered agents", () => {
    const agents = registry.listAgents();
    assert.strictEqual(agents.length, 2);
  });
});

describe("AgentRegistryService — Handoffs", () => {
  let registry: AgentRegistryService;

  beforeEach(() => {
    const sm = new StateManager();
    registry = new AgentRegistryService(sm);
    registry.loadAgents([
      makeAgent({ id: "claude", handoffs: ["gpt4"] }),
      makeAgent({ id: "gpt4", handoffs: [] }),
    ]);
  });

  it("getHandoffTargets returns valid targets", () => {
    const targets = registry.getHandoffTargets("claude");
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].id, "gpt4");
  });

  it("getHandoffTargets returns empty for agent without handoffs", () => {
    const targets = registry.getHandoffTargets("gpt4");
    assert.strictEqual(targets.length, 0);
  });

  it("getHandoffTargets returns empty for unknown agent", () => {
    const targets = registry.getHandoffTargets("unknown");
    assert.strictEqual(targets.length, 0);
  });

  it("getHandoffTargets filters out non-existent targets", () => {
    const sm = new StateManager();
    const reg = new AgentRegistryService(sm);
    reg.registerAgent(makeAgent({ id: "solo", handoffs: ["nonexistent"] }));
    const targets = reg.getHandoffTargets("solo");
    assert.strictEqual(targets.length, 0);
  });
});

describe("AgentRegistryService — Cleanup", () => {
  it("dispose clears all agents", () => {
    const sm = new StateManager();
    const registry = new AgentRegistryService(sm);
    registry.loadAgents([makeAgent({ id: "a1" }), makeAgent({ id: "a2" })]);
    registry.dispose();
    assert.strictEqual(registry.listAgents().length, 0);
  });
});
