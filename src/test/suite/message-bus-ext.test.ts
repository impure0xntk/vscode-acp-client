// ============================================================================
// MessageBus extension tests
// ============================================================================

import { describe, it, beforeEach } from "mocha";
import * as assert from "assert";
import { MessageBus } from "../../domain/services/message-bus";
import type { P2PMessage } from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeMessage(overrides: Partial<P2PMessage> = {}): P2PMessage {
  return {
    id: crypto.randomUUID(),
    type: "task_request",
    from: "agent-a",
    to: "agent-b",
    timestamp: new Date(),
    payload: { taskId: "t1", title: "Test", description: "Test task" },
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("MessageBus (extensions)", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe("sendToMultiple", () => {
    it("delivers to all specified targets", async () => {
      const received: string[] = [];

      bus.subscribe("agent-b", async (msg) => {
        received.push(`b:${msg.id}`);
      });
      bus.subscribe("agent-c", async (msg) => {
        received.push(`c:${msg.id}`);
      });

      const msg = makeMessage();
      await bus.sendToMultiple(["agent-b", "agent-c"], msg);

      assert.strictEqual(received.length, 2);
      assert.ok(received.includes(`b:${msg.id}`));
      assert.ok(received.includes(`c:${msg.id}`));
    });

    it("queues messages for offline targets", async () => {
      const msg = makeMessage({ to: "agent-offline" });
      await bus.sendToMultiple(["agent-offline"], msg);

      assert.strictEqual(bus.getQueuedCount("agent-offline"), 1);
    });
  });

  describe("broadcast", () => {
    it("delivers to all subscribers except sender", async () => {
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

      await bus.broadcast(makeMessage({ from: "agent-a" }));

      // agent-a should NOT receive (it's the sender)
      assert.ok(!received.includes("a"));
      assert.ok(received.includes("b"));
      assert.ok(received.includes("c"));
    });
  });

  describe("getRecentLogs", () => {
    it("returns last N entries in order", async () => {
      for (let i = 0; i < 5; i++) {
        await bus.send(makeMessage({ id: `msg-${i}` }));
      }

      const recent = bus.getRecentLogs(3);
      assert.strictEqual(recent.length, 3);
      assert.strictEqual(recent[0].messageId, "msg-2");
      assert.strictEqual(recent[1].messageId, "msg-3");
      assert.strictEqual(recent[2].messageId, "msg-4");
    });

    it("returns all when limit exceeds log size", async () => {
      await bus.send(makeMessage({ id: "only" }));
      const recent = bus.getRecentLogs(100);
      assert.strictEqual(recent.length, 1);
    });
  });
});
