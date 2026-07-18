import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { StateManager } from "../../domain/services/state-manager";
import { SessionManager } from "../../domain/services/session-manager";
import { AgentRegistryService } from "../../domain/services/agent-registry";
import { MessageRouterService } from "../../domain/services/message-router";
import { TaskSchedulerService } from "../../domain/services/task-scheduler";
import type { AgentDefinition } from "../../domain/models/agent";
import type { TaskDefinition } from "../../domain/models/task";

// ============================================================================
// Domain Service Integration Tests
//
// Formerly tested through the Orchestrator facade
// (src/application/orchestrator.ts — deleted as dead code).
// These tests exercise StateManager, SessionManager, AgentRegistryService,
// MessageRouterService, and TaskSchedulerService directly.
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

describe("Domain Services — Session Lifecycle", () => {
  let state: StateManager;
  let sessions: SessionManager;

  beforeEach(() => {
    state = new StateManager();
    sessions = new SessionManager(state);
  });

  afterEach(() => {
    sessions.dispose();
    state.dispose();
  });

  it("createSession creates a session", () => {
    const session = sessions.createSession("claude", "sess-1", {
      variables: { key: "value" },
      childSessionIds: [],
      metadata: {},
    });
    assert.strictEqual(session.id, "sess-1");
    assert.strictEqual(session.agentId, "claude");
  });

  it("createSession passes context variables", () => {
    const session = sessions.createSession("claude", "sess-1", {
      variables: { foo: "bar" },
      childSessionIds: [],
      metadata: {},
    });
    assert.deepStrictEqual(session.context.variables, { foo: "bar" });
    assert.deepStrictEqual(session.context.childSessionIds, []);
    assert.deepStrictEqual(session.context.metadata, {});
  });

  it("updateSessionStatus sets status to idle", () => {
    sessions.createSession("claude", "sess-1", {
      variables: {},
      childSessionIds: [],
      metadata: {},
    });
    sessions.updateSessionStatus("claude", "sess-1", "idle");
    const session = sessions.getSession("claude", "sess-1");
    assert.strictEqual(session!.status, "idle");
  });
});

describe("Domain Services — State Management", () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
  });

  afterEach(() => {
    state.dispose();
  });

  it("subscribe returns an unsubscribe function", () => {
    const unsub = state.subscribe("session.created", () => {});
    assert.strictEqual(typeof unsub, "function");
    unsub();
  });

  it("subscribeAll returns an unsubscribe function", () => {
    const unsub = state.subscribeAll(() => {});
    assert.strictEqual(typeof unsub, "function");
    unsub();
  });

  it("getState returns current orchestration state", () => {
    const s = state.getState();
    assert.ok(s);
    assert.strictEqual(s.sessions.size, 0);
    assert.strictEqual(s.eventLog.length, 0);
  });

  it("events are recorded in state after applyEvent", () => {
    const event = state.createEvent("session.created", {});
    state.applyEvent(event);
    assert.ok(state.getState().eventLog.length > 0);
  });
});

describe("Domain Services — Agent Registry", () => {
  let state: StateManager;
  let registry: AgentRegistryService;

  beforeEach(() => {
    state = new StateManager();
    registry = new AgentRegistryService(state);
  });

  afterEach(() => {
    registry.dispose();
    state.dispose();
  });

  it("registered agents appear in agentRegistry", () => {
    const agent = makeAgent();
    registry.registerAgent(agent);
    assert.ok(registry.getAgent("claude"));
  });
});

describe("Domain Services — Message Router", () => {
  let state: StateManager;
  let router: MessageRouterService;

  beforeEach(() => {
    state = new StateManager();
    router = new MessageRouterService(state);
  });

  afterEach(() => {
    router.dispose();
    state.dispose();
  });

  it("messageRouter routes messages and records in state", async () => {
    const msg = {
      id: "msg-1",
      sessionId: "sess-1",
      role: "user" as const,
      content: [],
      timestamp: new Date(),
    };
    const result = await router.route(msg);
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.sessionId, "sess-1");
  });
});

describe("Domain Services — Task Scheduler", () => {
  let state: StateManager;
  let scheduler: TaskSchedulerService;

  beforeEach(() => {
    state = new StateManager();
    scheduler = new TaskSchedulerService(state);
  });

  afterEach(() => {
    scheduler.dispose();
    state.dispose();
  });

  it("created tasks are retrievable", () => {
    const task = scheduler.createTask({
      type: "single_agent",
      assignedAgentId: "claude",
      input: "test",
    });
    assert.ok(scheduler.getTask(task.id));
  });

  it("executePipeline runs tasks sequentially", async () => {
    const order: string[] = [];
    const tasks: TaskDefinition[] = [
      { type: "single_agent", assignedAgentId: "claude", input: "first" },
      { type: "single_agent", assignedAgentId: "gpt4", input: "second" },
    ];
    const created = tasks.map((def) => scheduler.createTask(def));
    const taskIds = created.map((t) => t.id);

    const results = await scheduler.executePipeline(taskIds, async (task) => {
      order.push(task.assignedAgentId);
      return `${task.input}-done`;
    });

    assert.strictEqual(results.length, 2);
    assert.deepStrictEqual(order, ["claude", "gpt4"]);
  });

  it("executePipeline chains output to next input", async () => {
    const tasks: TaskDefinition[] = [
      { type: "single_agent", assignedAgentId: "a1", input: 10 },
      { type: "single_agent", assignedAgentId: "a2", input: 0 },
    ];
    const created = tasks.map((def) => scheduler.createTask(def));
    const taskIds = created.map((t) => t.id);

    const results = await scheduler.executePipeline(taskIds, async (task) => {
      return (task.input as number) + 1;
    });

    assert.strictEqual(results[0], 11);
    assert.strictEqual(results[1], 12); // pipeline chains prev output to next input
  });

  it("executePipeline stops on failure", async () => {
    const tasks: TaskDefinition[] = [
      { type: "single_agent", assignedAgentId: "a1", input: "ok" },
    ];
    const created = tasks.map((def) => scheduler.createTask(def));

    await assert.rejects(
      () =>
        scheduler.executePipeline([created[0].id], async () => {
          throw new Error("pipeline error");
        }),
      /pipeline error/
    );
  });

  it("executeParallel runs all tasks", async () => {
    const tasks: TaskDefinition[] = [
      { type: "single_agent", assignedAgentId: "claude", input: "x" },
      { type: "single_agent", assignedAgentId: "gpt4", input: "y" },
    ];
    const created = tasks.map((def) => scheduler.createTask(def));
    const taskIds = created.map((t) => t.id);

    const results = await scheduler.executeParallel(taskIds, async (task) => {
      return `${task.input}-result`;
    });

    assert.strictEqual(results.length, 2);
    assert.ok(results.includes("x-result"));
    assert.ok(results.includes("y-result"));
  });

  it("executeParallel fails all on first error", async () => {
    const tasks: TaskDefinition[] = [
      { type: "single_agent", assignedAgentId: "a1", input: "ok" },
    ];
    const created = tasks.map((def) => scheduler.createTask(def));

    await assert.rejects(
      () =>
        scheduler.executeParallel([created[0].id], async () => {
          throw new Error("parallel error");
        }),
      /task\(s\) failed/
    );
  });

  it("getTasksByStatus returns tasks with given status", () => {
    const task = scheduler.createTask({
      type: "single_agent",
      assignedAgentId: "claude",
      input: "",
    });
    const pending = scheduler.getTasksByStatus("pending");
    assert.ok(pending.some((t) => t.id === task.id));
  });
});

describe("Domain Services — Cleanup", () => {
  it("dispose cleans up all sub-services", () => {
    const state = new StateManager();
    const sessions = new SessionManager(state);
    const registry = new AgentRegistryService(state);
    const scheduler = new TaskSchedulerService(state);

    sessions.createSession("claude", "sess-1", {
      variables: {},
      childSessionIds: [],
      metadata: {},
    });
    registry.registerAgent(makeAgent());
    scheduler.createTask({
      type: "single_agent",
      assignedAgentId: "claude",
      input: "",
    });

    // Dispose in reverse order
    scheduler.dispose();
    registry.dispose();
    sessions.dispose();
    state.dispose();

    assert.strictEqual(sessions.getSessionsForAgent("claude").length, 0);
    assert.strictEqual(registry.listAgents().length, 0);
    assert.strictEqual(scheduler.getTasksByStatus("pending").length, 0);
  });
});
