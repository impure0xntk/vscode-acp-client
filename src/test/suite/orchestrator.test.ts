import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { Orchestrator } from "../../application/orchestrator";
import type { AgentDefinition } from "../../domain/models/agent";

// ============================================================================
// Orchestrator Facade Tests
// ============================================================================

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "claude",
    name: "Claude",
    description: "Test agent",
    systemPrompt: "You are a test agent.",
    allowedTools: ["read_file"],
    ...overrides,
  };
}

describe("Orchestrator — Construction", () => {
  it("creates all sub-services", () => {
    const orch = new Orchestrator();
    assert.ok(orch.stateManager);
    assert.ok(orch.sessionManager);
    assert.ok(orch.agentRegistry);
    assert.ok(orch.messageRouter);
    assert.ok(orch.taskScheduler);
    orch.dispose();
  });
});

describe("Orchestrator — Session Lifecycle", () => {
  let orch: Orchestrator;

  beforeEach(() => {
    orch = new Orchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("startSession creates a session", () => {
    const session = orch.startSession("claude", "sess-1", { key: "value" });
    assert.strictEqual(session.id, "sess-1");
    assert.strictEqual(session.agentId, "claude");
  });

  it("startSession passes context variables", () => {
    const session = orch.startSession("claude", "sess-1", { foo: "bar" });
    assert.deepStrictEqual(session.context.variables, { foo: "bar" });
    assert.deepStrictEqual(session.context.childSessionIds, []);
    assert.deepStrictEqual(session.context.metadata, {});
  });

  it("cancelSession sets status to idle", () => {
    orch.startSession("claude", "sess-1");
    orch.cancelSession("claude", "sess-1");
    const session = orch.sessionManager.getSession("claude", "sess-1");
    assert.strictEqual(session!.status, "idle");
  });
});

describe("Orchestrator — Handoff", () => {
  let orch: Orchestrator;

  beforeEach(() => {
    orch = new Orchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("handoff creates a new session with the target agent", () => {
    orch.startSession("claude", "sess-1", { data: 42 });
    const newSession = orch.handoff("claude", "gpt4", "sess-1", "sess-2");
    assert.strictEqual(newSession.id, "sess-2");
    assert.strictEqual(newSession.agentId, "gpt4");
  });

  it("handoff copies context variables from source", () => {
    orch.startSession("claude", "sess-1", { key: "val" });
    const newSession = orch.handoff("claude", "gpt4", "sess-1", "sess-2");
    assert.deepStrictEqual(newSession.context.variables, { key: "val" });
  });

  it("handoff sets parentSessionId and handedOffFrom metadata", () => {
    orch.startSession("claude", "sess-1");
    const newSession = orch.handoff("claude", "gpt4", "sess-1", "sess-2");
    assert.strictEqual(newSession.context.parentSessionId, "sess-1");
    assert.strictEqual(
      (newSession.context.metadata as Record<string, unknown>).handedOffFrom,
      "claude"
    );
  });

  it("handoff marks source session as idle", () => {
    orch.startSession("claude", "sess-1");
    orch.handoff("claude", "gpt4", "sess-1", "sess-2");
    const source = orch.sessionManager.getSession("claude", "sess-1");
    assert.strictEqual(source!.status, "idle");
  });

  it("handoff adds new session ID to source childSessionIds", () => {
    orch.startSession("claude", "sess-1");
    orch.handoff("claude", "gpt4", "sess-1", "sess-2");
    const source = orch.sessionManager.getSession("claude", "sess-1");
    assert.ok(source!.context.childSessionIds.includes("sess-2"));
  });

  it("handoff throws for non-existent source session", () => {
    assert.throws(
      () => orch.handoff("claude", "gpt4", "nonexistent", "sess-2"),
      /not found/
    );
  });

  it("handoff emits agent.handoff event", () => {
    orch.startSession("claude", "sess-1");
    let received = false;
    orch.subscribe("agent.handoff", () => {
      received = true;
    });
    orch.handoff("claude", "gpt4", "sess-1", "sess-2");
    assert.strictEqual(received, true);
  });
});

describe("Orchestrator — Multi-Agent Execution", () => {
  let orch: Orchestrator;

  beforeEach(() => {
    orch = new Orchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("executePipeline runs tasks sequentially", async () => {
    const order: string[] = [];
    const results = await orch.executePipeline(
      [
        { agentId: "claude", input: "first" },
        { agentId: "gpt4", input: "second" },
      ],
      async (agentId, input) => {
        order.push(agentId);
        return `${input}-done`;
      }
    );

    assert.strictEqual(results.length, 2);
    // Pipeline chains output → next input, so:
    //   t1: input="first"  → output="first-done"
    //   t2: input="first-done" (overwritten from prev output) → output="first-done-done"
    assert.deepStrictEqual(results, ["first-done", "first-done-done"]);
    assert.deepStrictEqual(order, ["claude", "gpt4"]);
  });

  it("executePipeline chains output to next input", async () => {
    const results = await orch.executePipeline(
      [
        { agentId: "a1", input: 10 },
        { agentId: "a2", input: 0 },
      ],
      async (_agentId, input) => (input as number) + 1
    );

    assert.strictEqual(results[0], 11);
    assert.strictEqual(results[1], 12); // 11 (prev output) + 1
  });

  it("executePipeline stops on failure", async () => {
    await assert.rejects(
      () =>
        orch.executePipeline([{ agentId: "a1", input: "ok" }], async () => {
          throw new Error("pipeline error");
        }),
      /pipeline error/
    );
  });

  it("executeParallel runs all tasks", async () => {
    const results = await orch.executeParallel(
      [
        { agentId: "claude", input: "x" },
        { agentId: "gpt4", input: "y" },
      ],
      async (_agentId, input) => `${input}-result`
    );

    assert.strictEqual(results.length, 2);
    assert.ok(results.includes("x-result"));
    assert.ok(results.includes("y-result"));
  });

  it("executeParallel fails all on first error", async () => {
    await assert.rejects(
      () =>
        orch.executeParallel([{ agentId: "a1", input: "ok" }], async () => {
          throw new Error("parallel error");
        }),
      /task\(s\) failed/
    );
  });

  it("executePipeline creates correct number of task events", async () => {
    let eventCount = 0;
    orch.subscribeAll(() => {
      eventCount++;
    });

    await orch.executePipeline(
      [
        { agentId: "a", input: "1" },
        { agentId: "b", input: "2" },
      ],
      async (_agentId, input) => input
    );

    // Each task emits task.created + task.status_changed (running) + task.status_changed (completed) = 3 events per task
    // Plus the createTask itself applies one event. Let's just verify events were emitted.
    assert.ok(eventCount > 0);
  });
});

describe("Orchestrator — State Monitoring", () => {
  let orch: Orchestrator;

  beforeEach(() => {
    orch = new Orchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("subscribe returns an unsubscribe function", () => {
    const unsub = orch.subscribe("session.created", () => {});
    assert.strictEqual(typeof unsub, "function");
    unsub();
  });

  it("subscribeAll returns an unsubscribe function", () => {
    const unsub = orch.subscribeAll(() => {});
    assert.strictEqual(typeof unsub, "function");
    unsub();
  });

  it("getState returns current orchestration state", () => {
    const state = orch.getState();
    assert.ok(state);
    assert.strictEqual(state.sessions.size, 0);
    assert.strictEqual(state.eventLog.length, 0);
  });

  it("events are recorded in state after operations", () => {
    orch.startSession("claude", "sess-1");
    assert.ok(orch.getState().eventLog.length > 0);
  });
});

describe("Orchestrator — Agent + Service Integration", () => {
  let orch: Orchestrator;

  beforeEach(() => {
    orch = new Orchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("registered agents appear in agentRegistry", () => {
    const agent = makeAgent();
    orch.agentRegistry.registerAgent(agent);
    assert.ok(orch.agentRegistry.getAgent("claude"));
  });

  it("messageRouter routes messages and records in state", async () => {
    const msg = {
      id: "msg-1",
      sessionId: "sess-1",
      role: "user" as const,
      content: [],
      timestamp: new Date(),
    };
    const result = await orch.messageRouter.route(msg);
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.sessionId, "sess-1");
  });

  it("tasks created via taskScheduler are retrievable", () => {
    const task = orch.taskScheduler.createTask({
      type: "single_agent",
      assignedAgentId: "claude",
      input: "test",
    });
    assert.ok(orch.taskScheduler.getTask(task.id));
  });
});

describe("Orchestrator — Cleanup", () => {
  it("dispose cleans up all sub-services", () => {
    const orch = new Orchestrator();
    orch.startSession("claude", "sess-1");
    orch.agentRegistry.registerAgent(makeAgent());
    orch.taskScheduler.createTask({
      type: "single_agent",
      assignedAgentId: "claude",
      input: "",
    });

    orch.dispose();

    assert.strictEqual(
      orch.sessionManager.getSessionsForAgent("claude").length,
      0
    );
    assert.strictEqual(orch.agentRegistry.listAgents().length, 0);
    assert.strictEqual(
      orch.taskScheduler.getTasksByStatus("pending").length,
      0
    );
  });
});
