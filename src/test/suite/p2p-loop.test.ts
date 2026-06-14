// ============================================================================
// P2P loop integration test
//
// Verifies the full cycle:
//   agent output → marker parse → MessageBus route → forward to target agent
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4 (P2P mode)
// ============================================================================

import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import { MessageBus } from "../../domain/services/message-bus";
import {
  parseMeshMarkers,
  serializeToMarker,
} from "../../shared/util/mesh-marker-parser";
import type { P2PMessage } from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function createMessage(overrides: Partial<P2PMessage> = {}): P2PMessage {
  return {
    id: "msg-" + Math.random().toString(36).slice(2, 8),
    type: "task_request",
    from: "agent-a",
    to: "agent-b",
    timestamp: new Date(),
    payload: {
      taskId: "task-" + Math.random().toString(36).slice(2, 6),
      title: "Test task",
      description: "Test description",
    },
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("P2P Loop Integration", () => {
  let bus: MessageBus;
  let receivedByAgentB: P2PMessage[];
  let receivedByAgentC: P2PMessage[];

  beforeEach(() => {
    bus = new MessageBus();
    receivedByAgentB = [];
    receivedByAgentC = [];

    bus.subscribe("agent-b", async (msg) => {
      receivedByAgentB.push(msg);
    });
    bus.subscribe("agent-c", async (msg) => {
      receivedByAgentC.push(msg);
    });
  });

  afterEach(() => {
    bus.dispose();
  });

  // -----------------------------------------------------------------------
  // v2 round-trip
  // -----------------------------------------------------------------------

  it("v2 marker survives parse → send → parse round-trip", async () => {
    const original = createMessage({
      from: "agent-a",
      to: "agent-b",
      type: "task_request",
      payload: {
        taskId: "task-rt1",
        title: "Round-trip task",
        description: "Verify v2 round-trip",
        priority: "high" as const,
      },
    });

    const markerText = serializeToMarker(original, "2");
    assert.ok(markerText.includes("[ACP_MESH_MESSAGE v2]"));
    assert.ok(markerText.includes('"version":"2.0"'));
    assert.ok(markerText.includes('"from":"agent-a"'));
    assert.ok(markerText.includes('"to":"agent-b"'));

    const { messages, sanitized } = parseMeshMarkers(markerText, "agent-a");
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(sanitized, "");

    const parsed = messages[0];
    assert.strictEqual(parsed.id, original.id);
    assert.strictEqual(parsed.type, "task_request");
    assert.strictEqual(parsed.from, "agent-a");
    assert.strictEqual(parsed.to, "agent-b");
    const p = parsed.payload as Record<string, unknown>;
    assert.strictEqual(p.taskId, "task-rt1");
    assert.strictEqual(p.title, "Round-trip task");
    assert.strictEqual(p.description, "Verify v2 round-trip");
    assert.strictEqual(p.priority, "high");
  });

  it("v2 marker → MessageBus → subscriber receives correct message", async () => {
    const msg = createMessage({
      from: "agent-a",
      to: "agent-b",
      type: "question",
      payload: { question: "What is the status?" },
    });

    const markerText = serializeToMarker(msg, "2");
    const { messages } = parseMeshMarkers(markerText, "agent-a");
    for (const parsed of messages) {
      await bus.send(parsed);
    }

    assert.strictEqual(receivedByAgentB.length, 1);
    assert.strictEqual(receivedByAgentB[0].type, "question");
    assert.strictEqual(receivedByAgentB[0].from, "agent-a");
    const q = receivedByAgentB[0].payload as { question?: string };
    assert.strictEqual(q.question, "What is the status?");
  });

  // -----------------------------------------------------------------------
  // v1 round-trip (backward compatibility)
  // -----------------------------------------------------------------------

  it("v1 marker still works for backward compatibility", () => {
    const msg = createMessage({
      from: "agent-a",
      to: "agent-b",
      type: "status_update",
      payload: { agentId: "agent-a", status: "working" },
    });

    const markerText = serializeToMarker(msg, "1");
    assert.ok(markerText.includes("[ACP_MESH_MESSAGE]"));
    assert.ok(!markerText.includes("v2"));

    const { messages } = parseMeshMarkers(markerText, "agent-a");
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, "status_update");
    assert.strictEqual(messages[0].from, "agent-a");
  });

  // -----------------------------------------------------------------------
  // Mixed markers and text
  // -----------------------------------------------------------------------

  it("extracts v2 markers from mixed agent output, sanitizes text", () => {
    const msg = createMessage({
      from: "agent-a",
      to: "agent-b",
      type: "task_delegate",
      payload: { agentIndex: 0, description: "Implement feature X" },
    });

    const markerText = serializeToMarker(msg, "2");
    const rawOutput = [
      "Let me analyze the codebase first.",
      "",
      markerText,
      "",
      "After delegation, I will monitor progress.",
    ].join("\n");

    const { messages, sanitized } = parseMeshMarkers(rawOutput, "agent-a");

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, "task_delegate");
    assert.ok(!sanitized.includes("[ACP_MESH_MESSAGE"));
    assert.ok(sanitized.includes("Let me analyze"));
    assert.ok(sanitized.includes("After delegation"));
  });

  it("v2 markers take priority over v1 when both match the same content", () => {
    const v2Envelope = JSON.stringify({
      version: "2.0",
      type: "task_request",
      id: "test-priority",
      from: "agent-a",
      to: "agent-b",
      mode: "p2P",
      payload: { taskId: "t1", title: "Priority test", description: "v2 wins" },
    });

    const raw = `[ACP_MESH_MESSAGE v2]${v2Envelope}[/ACP_MESH_MESSAGE]`;

    const { messages } = parseMeshMarkers(raw, "agent-x");
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].from, "agent-a"); // v2 from field, not agent-x
  });

  // -----------------------------------------------------------------------
  // Invalid / edge case markers
  // -----------------------------------------------------------------------

  it("ignores invalid JSON inside v2 markers", () => {
    const raw =
      "[ACP_MESH_MESSAGE v2]{ not valid json }[/ACP_MESH_MESSAGE]";
    const { messages } = parseMeshMarkers(raw, "agent-a");
    assert.strictEqual(messages.length, 0);
  });

  it("ignores v2 markers missing required fields", () => {
    const raw = JSON.stringify({
      version: "2.0",
      type: "task_request",
      // missing from, to, mode, payload
    });
    const input = `[ACP_MESH_MESSAGE v2]${raw}[/ACP_MESH_MESSAGE]`;
    const { messages } = parseMeshMarkers(input, "agent-a");
    assert.strictEqual(messages.length, 0);
  });

  it("ignores empty v2 markers", () => {
    const raw = "[ACP_MESH_MESSAGE v2]   [/ACP_MESH_MESSAGE]";
    const { messages } = parseMeshMarkers(raw, "agent-a");
    assert.strictEqual(messages.length, 0);
  });

  // -----------------------------------------------------------------------
  // Broadcast via v2
  // -----------------------------------------------------------------------

  it("v2 broadcast message reaches all subscribers except sender", async () => {
    const msg = createMessage({
      from: "agent-a",
      to: "broadcast",
      type: "broadcast",
      payload: { event: "code_review_complete", data: { file: "auth.ts" } },
    });

    const markerText = serializeToMarker(msg, "2");
    const { messages } = parseMeshMarkers(markerText, "agent-a");

    await bus.send({ ...messages[0], to: "broadcast" });

    assert.strictEqual(receivedByAgentB.length, 1);
    assert.strictEqual(receivedByAgentC.length, 1);
    assert.strictEqual(receivedByAgentB[0].type, "broadcast");
  });

  // -----------------------------------------------------------------------
  // Multiple messages in single output
  // -----------------------------------------------------------------------

  it("extracts multiple v2 markers from single agent output", () => {
    const msgs = [
      createMessage({ to: "agent-b", type: "task_delegate", payload: { agentIndex: 0, description: "Task 1" } }),
      createMessage({ to: "agent-c", type: "task_delegate", payload: { agentIndex: 1, description: "Task 2" } }),
      createMessage({ to: "agent-b", type: "status_update", payload: { agentId: "agent-a", status: "working" } }),
    ];

    const raw = msgs
      .map((m) => `Some text\n${serializeToMarker(m, "2")}\n`)
      .join("\n");

    const { messages, sanitized } = parseMeshMarkers(raw, "agent-a");
    assert.strictEqual(messages.length, 3);

    const toAgentB = messages.filter((m: P2PMessage) => m.to === "agent-b");
    const toAgentC = messages.filter((m: P2PMessage) => m.to === "agent-c");
    assert.strictEqual(toAgentB.length, 2);
    assert.strictEqual(toAgentC.length, 1);

    assert.ok(!sanitized.includes("[ACP_MESH_MESSAGE"));
    assert.ok(sanitized.includes("Some text"));
  });

  // -----------------------------------------------------------------------
  // v2 default version
  // -----------------------------------------------------------------------

  it("default serializeToMarker version is v2", () => {
    const msg = createMessage({ from: "agent-a", to: "agent-b" });
    const markerText = serializeToMarker(msg);
    assert.ok(markerText.includes("[ACP_MESH_MESSAGE v2]"));
  });

  // -----------------------------------------------------------------------
  // Mode field in v2
  // -----------------------------------------------------------------------

  it("v2 marker includes mode field", () => {
    const msg = createMessage({ from: "agent-a", to: "agent-b" });
    const markerText = serializeToMarker(msg, "2");

    const jsonStr = markerText.slice(
      markerText.indexOf("{"),
      markerText.lastIndexOf("}") + 1
    );
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    assert.strictEqual(parsed.mode, "p2P");
  });
});
