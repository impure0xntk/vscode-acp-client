// ============================================================================
// MessageBus unit tests
// ============================================================================

import * as assert from "assert";
import { MessageBus } from "../../domain/services/message-bus";
import type { P2PMessage } from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeMessage(
  overrides: Partial<P2PMessage> & { to: string }
): P2PMessage {
  const base = {
    id: crypto.randomUUID(),
    type: "question" as const,
    from: "agent-a",
    timestamp: new Date(),
    payload: { question: "hello" as const },
  };
  return { ...base, ...overrides, to: overrides.to };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  afterEach(() => {
    bus.dispose();
  });

  describe("subscribe", () => {
    it("should register a handler and dispatch messages", () => {
      const received: P2PMessage[] = [];
      bus.subscribe("agent-a", async (msg) => {
        received.push(msg);
      });

      const msg = makeMessage({ from: "agent-b", to: "agent-a" });
      void bus.send(msg);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          assert.strictEqual(received.length, 1);
          assert.strictEqual(received[0].id, msg.id);
          resolve();
        }, 10);
      });
    });

    it("should support multiple handlers for the same agent", async () => {
      const log1: string[] = [];
      const log2: string[] = [];

      bus.subscribe("agent-a", async () => {
        log1.push("h1");
      });
      bus.subscribe("agent-a", async () => {
        log2.push("h2");
      });

      await bus.send(makeMessage({ from: "agent-b", to: "agent-a" }));

      assert.deepStrictEqual(log1, ["h1"]);
      assert.deepStrictEqual(log2, ["h2"]);
    });

    it("should return unsubscribe function that removes handler", async () => {
      const received: P2PMessage[] = [];
      const unsub = bus.subscribe("agent-a", async (msg) => {
        received.push(msg);
      });

      unsub();

      await bus.send(makeMessage({ from: "agent-b", to: "agent-a" }));

      assert.strictEqual(received.length, 0);
    });
  });

  describe("send (directed)", () => {
    it("should deliver to target agent only", async () => {
      const toA: P2PMessage[] = [];
      const toB: P2PMessage[] = [];

      bus.subscribe("agent-a", async (msg) => {
        toA.push(msg);
      });
      bus.subscribe("agent-b", async (msg) => {
        toB.push(msg);
      });

      await bus.send(makeMessage({ from: "agent-c", to: "agent-a" }));

      assert.strictEqual(toA.length, 1);
      assert.strictEqual(toB.length, 0);
    });

    it("should resolve after dispatch", async () => {
      let dispatched = false;
      bus.subscribe("agent-a", async () => {
        dispatched = true;
      });

      await bus.send(makeMessage({ from: "agent-b", to: "agent-a" }));
      assert.strictEqual(dispatched, true);
    });
  });

  describe("send (broadcast)", () => {
    it("should deliver to all subscribers except sender", async () => {
      const received: string[] = [];

      bus.subscribe("agent-a", async () => {
        received.push("a");
      });
      bus.subscribe("agent-b", async () => {
        received.push("b");
      });
      bus.subscribe("agent-c", async () => {
        received.push("c");
      });

      await bus.send(
        makeMessage({ from: "agent-a", to: "broadcast", type: "status_update" })
      );

      assert.ok(received.includes("b"));
      assert.ok(received.includes("c"));
      assert.ok(!received.includes("a"));
    });

    it("should deliver to all when sender is not subscribed", async () => {
      const received: string[] = [];

      bus.subscribe("agent-a", async () => {
        received.push("a");
      });
      bus.subscribe("agent-b", async () => {
        received.push("b");
      });

      await bus.send(
        makeMessage({ from: "unknown", to: "broadcast", type: "status_update" })
      );

      assert.ok(received.includes("a"));
      assert.ok(received.includes("b"));
    });
  });

  describe("queue", () => {
    it("should queue messages when no subscriber exists", async () => {
      await bus.send(makeMessage({ from: "agent-a", to: "offline-agent" }));
      assert.strictEqual(bus.getQueuedCount("offline-agent"), 1);
    });

    it("should drain queued messages on subscribe", async () => {
      const received: P2PMessage[] = [];

      await bus.send(makeMessage({ from: "agent-a", to: "offline-agent" }));
      await bus.send(makeMessage({ from: "agent-a", to: "offline-agent" }));

      assert.strictEqual(bus.getQueuedCount("offline-agent"), 2);

      bus.subscribe("offline-agent", async (msg) => {
        received.push(msg);
      });

      assert.strictEqual(bus.getQueuedCount("offline-agent"), 0);
      assert.strictEqual(received.length, 2);
    });

    it("should support clearQueue", async () => {
      await bus.send(makeMessage({ from: "agent-a", to: "offline-agent" }));
      assert.strictEqual(bus.getQueuedCount("offline-agent"), 1);

      bus.clearQueue("offline-agent");
      assert.strictEqual(bus.getQueuedCount("offline-agent"), 0);
    });
  });

  describe("log", () => {
    it("should record sent messages", async () => {
      const msg = makeMessage({
        from: "agent-a",
        to: "agent-b",
        type: "question",
      });
      await bus.send(msg);

      const log = bus.getLog();
      assert.strictEqual(log.length, 1);
      assert.strictEqual(log[0].messageId, msg.id);
      assert.strictEqual(log[0].type, "question");
      assert.strictEqual(log[0].from, "agent-a");
      assert.strictEqual(log[0].to, "agent-b");
    });

    it("should support clearLog", async () => {
      await bus.send(makeMessage({ from: "agent-a", to: "agent-b" }));
      assert.strictEqual(bus.getLog().length, 1);

      bus.clearLog();
      assert.strictEqual(bus.getLog().length, 0);
    });
  });

  describe("error handling", () => {
    it("should not throw when a handler errors", async () => {
      let secondCalled = false;

      bus.subscribe("agent-a", async () => {
        throw new Error("handler error");
      });
      bus.subscribe("agent-a", async () => {
        secondCalled = true;
      });

      await bus.send(makeMessage({ from: "agent-b", to: "agent-a" }));
      assert.strictEqual(secondCalled, true);
    });
  });

  describe("dispose", () => {
    it("should clear all state", async () => {
      bus.subscribe("agent-a", async () => {});
      await bus.send(makeMessage({ from: "agent-b", to: "offline" }));
      bus.dispose();

      assert.strictEqual(bus.getQueuedCount("offline"), 0);
      assert.strictEqual(bus.getLog().length, 0);
    });
  });
});
