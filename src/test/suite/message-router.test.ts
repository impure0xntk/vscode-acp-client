import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { MessageRouterService } from "../../domain/services/message-router";
import { StateManager } from "../../domain/services/state-manager";
import type { Message, MessageRole } from "../../domain/models/message";

// ============================================================================
// Message Router Service Tests
// ============================================================================

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "sess-1",
    role: "user",
    content: [{ type: "text", text: "Hello" }],
    timestamp: new Date(),
    ...overrides,
  };
}

describe("MessageRouterService — Routing", () => {
  let sm: StateManager;
  let router: MessageRouterService;

  beforeEach(() => {
    sm = new StateManager();
    router = new MessageRouterService(sm);
  });

  it("route adds message to history", async () => {
    const msg = makeMessage();
    await router.route(msg);
    const history = router.getHistory("sess-1");
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].id, msg.id);
  });

  it("route returns routing result", async () => {
    const msg = makeMessage();
    const result = await router.route(msg);
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.sessionId, "sess-1");
    assert.strictEqual(result.message.id, msg.id);
  });

  it("route calls registered handler", async () => {
    let handled = false;
    router.registerHandler("user", async () => {
      handled = true;
      return true;
    });
    await router.route(makeMessage({ role: "user" }));
    assert.strictEqual(handled, true);
  });

  it("route returns handled=true when handler returns true", async () => {
    router.registerHandler("user", async () => true);
    const result = await router.route(makeMessage({ role: "user" }));
    assert.strictEqual(result.handled, true);
  });

  it("route returns handled=false when no handler registered", async () => {
    const result = await router.route(makeMessage({ role: "assistant" }));
    assert.strictEqual(result.handled, false);
  });
});

describe("MessageRouterService — Handler Registration", () => {
  let router: MessageRouterService;

  beforeEach(() => {
    const sm = new StateManager();
    router = new MessageRouterService(sm);
  });

  it("registerHandler and unregisterHandler work correctly", async () => {
    let count = 0;
    router.registerHandler("user", async () => {
      count++;
      return true;
    });
    await router.route(makeMessage({ role: "user" }));
    assert.strictEqual(count, 1);

    router.unregisterHandler("user");
    await router.route(makeMessage({ role: "user" }));
    assert.strictEqual(count, 1); // no increment
  });

  it("handler can be replaced", async () => {
    let v1 = 0,
      v2 = 0;
    router.registerHandler("user", async () => {
      v1++;
      return true;
    });
    await router.route(makeMessage({ role: "user" }));
    assert.strictEqual(v1, 1);

    router.registerHandler("user", async () => {
      v2++;
      return true;
    });
    await router.route(makeMessage({ role: "user" }));
    assert.strictEqual(v1, 1); // not called again
    assert.strictEqual(v2, 1);
  });
});

describe("MessageRouterService — History", () => {
  let router: MessageRouterService;

  beforeEach(() => {
    const sm = new StateManager();
    router = new MessageRouterService(sm);
  });

  it("getHistory returns empty for unknown session", () => {
    assert.strictEqual(router.getHistory("unknown").length, 0);
  });

  it("getHistory returns messages in insertion order", async () => {
    const m1 = makeMessage({ id: "m1" });
    const m2 = makeMessage({ id: "m2" });
    const m3 = makeMessage({ id: "m3" });
    await router.route(m1);
    await router.route(m2);
    await router.route(m3);
    const history = router.getHistory("sess-1");
    assert.strictEqual(history.length, 3);
    assert.strictEqual(history[0].id, "m1");
    assert.strictEqual(history[1].id, "m2");
    assert.strictEqual(history[2].id, "m3");
  });

  it("addMessage appends to history", () => {
    const msg = makeMessage({ id: "manual-1" });
    router.addMessage("sess-1", msg);
    const history = router.getHistory("sess-1");
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].id, "manual-1");
  });

  it("clearHistory removes all messages for session", async () => {
    await router.route(makeMessage());
    await router.route(makeMessage());
    assert.strictEqual(router.getHistory("sess-1").length, 2);
    router.clearHistory("sess-1");
    assert.strictEqual(router.getHistory("sess-1").length, 0);
  });

  it("history is isolated per session", async () => {
    await router.route(makeMessage({ id: "m1", sessionId: "sess-1" }));
    await router.route(makeMessage({ id: "m2", sessionId: "sess-2" }));
    assert.strictEqual(router.getHistory("sess-1").length, 1);
    assert.strictEqual(router.getHistory("sess-2").length, 1);
  });
});

describe("MessageRouterService — Cleanup", () => {
  it("dispose clears history and handlers", async () => {
    const sm = new StateManager();
    const router = new MessageRouterService(sm);
    await router.route(makeMessage());
    router.registerHandler("user", async () => true);
    router.dispose();
    assert.strictEqual(router.getHistory("sess-1").length, 0);
  });
});
