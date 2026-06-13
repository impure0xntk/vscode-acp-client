import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { StateManager } from "../../domain/services/state-manager";

// ============================================================================
// State Manager Tests
// ============================================================================

describe("StateManager — State Access", () => {
  let sm: StateManager;

  beforeEach(() => {
    sm = new StateManager();
  });

  it("returns initial empty state", () => {
    const state = sm.getState();
    assert.strictEqual(state.sessions.size, 0);
    assert.strictEqual(state.agents.size, 0);
    assert.strictEqual(state.activeTasks.size, 0);
    assert.strictEqual(state.messageHistory.size, 0);
    assert.strictEqual(state.eventLog.length, 0);
  });

  it("state is readonly type", () => {
    const state = sm.getState();
    // Verify the return type is Readonly<OrchestrationState>
    // (getState() creates a new object each call, not the internal state)
    assert.strictEqual(Array.isArray(state.eventLog), true);
  });
});

describe("StateManager — Event Application", () => {
  let sm: StateManager;

  beforeEach(() => {
    sm = new StateManager();
  });

  it("appends event to log on applyEvent", () => {
    const event = sm.createEvent("session.created", { agentId: "claude" });
    sm.applyEvent(event);
    assert.strictEqual(sm.getState().eventLog.length, 1);
    assert.strictEqual(sm.getState().eventLog[0].type, "session.created");
  });

  it("createEvent generates unique IDs", () => {
    const e1 = sm.createEvent("session.created", {});
    const e2 = sm.createEvent("session.created", {});
    assert.notStrictEqual(e1.id, e2.id);
  });

  it("createEvent sets timestamp", () => {
    const before = new Date();
    const event = sm.createEvent("session.created", {});
    const after = new Date();
    assert.ok(event.timestamp >= before && event.timestamp <= after);
  });
});

describe("StateManager — Subscription", () => {
  let sm: StateManager;

  beforeEach(() => {
    sm = new StateManager();
  });

  it("subscriber receives event on applyEvent", () => {
    let received = false;
    sm.subscribe("session.created", () => {
      received = true;
    });
    sm.applyEvent(sm.createEvent("session.created", {}));
    assert.strictEqual(received, true);
  });

  it("subscriber receives event payload", () => {
    let payload: unknown = null;
    sm.subscribe("session.created", (event) => {
      payload = event.payload;
    });
    sm.applyEvent(sm.createEvent("session.created", { agentId: "test" }));
    assert.deepStrictEqual(payload, { agentId: "test" });
  });

  it("unsubscribe stops delivery", () => {
    let count = 0;
    const unsub = sm.subscribe("session.created", () => {
      count++;
    });
    sm.applyEvent(sm.createEvent("session.created", {}));
    unsub();
    sm.applyEvent(sm.createEvent("session.created", {}));
    assert.strictEqual(count, 1);
  });

  it("subscribeAll receives all event types", () => {
    const types: string[] = [];
    sm.subscribeAll((event) => {
      types.push(event.type);
    });
    sm.applyEvent(sm.createEvent("session.created", {}));
    sm.applyEvent(sm.createEvent("message.received", {}));
    sm.applyEvent(sm.createEvent("task.created", {}));
    assert.strictEqual(types.length, 3);
    assert.ok(types.includes("session.created"));
    assert.ok(types.includes("message.received"));
    assert.ok(types.includes("task.created"));
  });

  it("multiple subscribers all receive the same event", () => {
    let c1 = 0,
      c2 = 0;
    sm.subscribe("session.created", () => {
      c1++;
    });
    sm.subscribe("session.created", () => {
      c2++;
    });
    sm.applyEvent(sm.createEvent("session.created", {}));
    assert.strictEqual(c1, 1);
    assert.strictEqual(c2, 1);
  });

  it("listener error does not prevent other listeners", () => {
    let received = false;
    sm.subscribe("session.created", () => {
      throw new Error("test error");
    });
    sm.subscribe("session.created", () => {
      received = true;
    });
    sm.applyEvent(sm.createEvent("session.created", {}));
    assert.strictEqual(received, true);
  });
});

describe("StateManager — Event Log Query", () => {
  let sm: StateManager;

  beforeEach(() => {
    sm = new StateManager();
    sm.applyEvent(sm.createEvent("session.created", { a: 1 }));
    sm.applyEvent(sm.createEvent("message.received", { a: 2 }));
    sm.applyEvent(sm.createEvent("session.created", { a: 3 }));
  });

  it("getEventLog returns all events without filter", () => {
    assert.strictEqual(sm.getEventLog().length, 3);
  });

  it("getEventLog filters by types", () => {
    const events = sm.getEventLog({ types: ["session.created"] });
    assert.strictEqual(events.length, 2);
  });

  it("getEventLog filters by since", () => {
    // Add a future event by manipulating the timestamp after creation
    const event = sm.createEvent("session.created", {});
    sm.applyEvent(event);
    // Use a 'since' that is after all events were created
    const farFuture = new Date(Date.now() + 10000);
    const events = sm.getEventLog({ since: farFuture });
    assert.strictEqual(events.length, 0);
  });

  it("dispose clears listeners", () => {
    let count = 0;
    sm.subscribe("session.created", () => {
      count++;
    });
    sm.dispose();
    sm.applyEvent(sm.createEvent("session.created", {}));
    assert.strictEqual(count, 0);
  });
});
