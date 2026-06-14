// ============================================================================
// Mesh Marker Parser v2 unit tests
// ============================================================================

import * as assert from "assert";
import {
  parseMeshMarkers,
  serializeToMarker,
} from "../../shared/util/mesh-marker-parser";
import type { P2PMessage } from "../../domain/models/mesh";
import {
  MESH_MARKER_OPEN,
  MESH_MARKER_CLOSE,
  MESH_MARKER_V2_OPEN,
} from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeMessage(overrides: Partial<P2PMessage> = {}): P2PMessage {
  return {
    id: crypto.randomUUID(),
    type: "question",
    from: "agent-a",
    to: "agent-b",
    timestamp: new Date(),
    payload: { question: "hello" },
    ...overrides,
  };
}

const SAMPLE_V1_ENVELOPE = {
  version: "1.0",
  type: "question",
  id: "v1-id-1",
  to: "agent-b",
  payload: { question: "hello v1" },
};

const SAMPLE_V2_ENVELOPE = {
  version: "2.0",
  type: "task_request",
  id: "v2-id-1",
  from: "agent-x",
  to: "agent-y",
  mode: "direct",
  payload: {
    taskId: "task-1",
    title: "Test task",
    description: "A test task",
  },
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("mesh-marker-parser v2", () => {
  // -----------------------------------------------------------------------
  // 1. Parse v2 marker with JSON envelope
  // -----------------------------------------------------------------------

  describe("v2 marker parsing", () => {
    it("should parse v2 marker with JSON envelope", () => {
      const raw = `before${MESH_MARKER_V2_OPEN}${JSON.stringify(SAMPLE_V2_ENVELOPE)}${MESH_MARKER_CLOSE}after`;
      const result = parseMeshMarkers(raw, "fallback-from");

      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].type, "task_request");
      assert.strictEqual(result.messages[0].id, "v2-id-1");
      assert.strictEqual(result.messages[0].from, "agent-x"); // from envelope, not param
      assert.strictEqual(result.messages[0].to, "agent-y");
      assert.deepStrictEqual(result.messages[0].payload, {
        taskId: "task-1",
        title: "Test task",
        description: "A test task",
      });
    });
  });

  // -----------------------------------------------------------------------
  // 2. Parse v1 marker (backward compat)
  // -----------------------------------------------------------------------

  describe("v1 backward compatibility", () => {
    it("should still parse v1 markers correctly", () => {
      const raw = `before${MESH_MARKER_OPEN}${JSON.stringify(SAMPLE_V1_ENVELOPE)}${MESH_MARKER_CLOSE}after`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].type, "question");
      assert.strictEqual(result.messages[0].id, "v1-id-1");
      assert.strictEqual(result.messages[0].from, "agent-a"); // from param
      assert.strictEqual(result.messages[0].to, "agent-b");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Parse mixed v1 and v2 in same output
  // -----------------------------------------------------------------------

  describe("mixed v1 and v2", () => {
    it("should parse both v1 and v2 markers in same output", () => {
      const raw = `text ${MESH_MARKER_V2_OPEN}${JSON.stringify(SAMPLE_V2_ENVELOPE)}${MESH_MARKER_CLOSE} middle ${MESH_MARKER_OPEN}${JSON.stringify(SAMPLE_V1_ENVELOPE)}${MESH_MARKER_CLOSE} end`;
      const result = parseMeshMarkers(raw, "fallback-agent");

      assert.strictEqual(result.messages.length, 2);

      // v2 message first (appears first in raw)
      assert.strictEqual(result.messages[0].id, "v2-id-1");
      assert.strictEqual(result.messages[0].from, "agent-x");

      // v1 message second
      assert.strictEqual(result.messages[1].id, "v1-id-1");
      assert.strictEqual(result.messages[1].from, "fallback-agent");
    });
  });

  // -----------------------------------------------------------------------
  // 4. V2 envelope with all fields
  // -----------------------------------------------------------------------

  describe("v2 full envelope", () => {
    it("should parse v2 envelope with all fields (from, to, mode, payload, metadata)", () => {
      const fullEnvelope = {
        version: "2.0",
        type: "task_response",
        id: "full-v2-id",
        from: "worker-agent",
        to: "supervisor-agent",
        mode: "supervisor",
        payload: {
          taskId: "task-42",
          status: "completed",
          output: "All done",
          modifiedFiles: ["src/index.ts"],
          tokenUsage: { input: 100, output: 200, total: 300 },
        },
        metadata: {
          replyTo: "msg-0",
          priority: "high",
          ttl: 300,
        },
      };
      const raw = `${MESH_MARKER_V2_OPEN}${JSON.stringify(fullEnvelope)}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "ignored-from");

      assert.strictEqual(result.messages.length, 1);
      const msg = result.messages[0];
      assert.strictEqual(msg.id, "full-v2-id");
      assert.strictEqual(msg.type, "task_response");
      assert.strictEqual(msg.from, "worker-agent");
      assert.strictEqual(msg.to, "supervisor-agent");
      assert.deepStrictEqual(msg.payload, fullEnvelope.payload);
      assert.deepStrictEqual(msg.metadata, fullEnvelope.metadata);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Sanitization removes both v1 and v2 markers
  // -----------------------------------------------------------------------

  describe("sanitization", () => {
    it("should remove both v1 and v2 markers from sanitized output", () => {
      const raw = `hello ${MESH_MARKER_V2_OPEN}${JSON.stringify(SAMPLE_V2_ENVELOPE)}${MESH_MARKER_CLOSE} world ${MESH_MARKER_OPEN}${JSON.stringify(SAMPLE_V1_ENVELOPE)}${MESH_MARKER_CLOSE} end`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.ok(!result.sanitized.includes(MESH_MARKER_V2_OPEN));
      assert.ok(!result.sanitized.includes(MESH_MARKER_OPEN));
      assert.ok(!result.sanitized.includes(MESH_MARKER_CLOSE));
      assert.ok(result.sanitized.includes("hello"));
      assert.ok(result.sanitized.includes("world"));
      assert.ok(result.sanitized.includes("end"));
    });
  });

  // -----------------------------------------------------------------------
  // 6. Invalid JSON inside marker → skipped gracefully
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("should skip v2 marker with invalid JSON", () => {
      const raw = `${MESH_MARKER_V2_OPEN}{invalid json${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 0);
    });

    it("should skip v1 marker with invalid JSON", () => {
      const raw = `${MESH_MARKER_OPEN}{invalid json${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 0);
    });
  });

  // -----------------------------------------------------------------------
  // 7. V2 with metadata.source field
  // -----------------------------------------------------------------------

  describe("v2 with metadata.source", () => {
    it("should parse v2 envelope with metadata.source field", () => {
      const envelopeWithSource = {
        version: "2.0",
        type: "status_update",
        id: "src-id-1",
        from: "agent-1",
        to: "broadcast",
        mode: "fanout",
        payload: {
          agentId: "agent-1",
          status: "working",
          currentTask: "task-99",
          progress: 50,
        },
        metadata: {
          source: {
            type: "agent",
            agentId: "agent-1",
          },
        },
      };
      const raw = `${MESH_MARKER_V2_OPEN}${JSON.stringify(envelopeWithSource)}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "ignored");

      assert.strictEqual(result.messages.length, 1);
      const msg = result.messages[0];
      assert.strictEqual(msg.id, "src-id-1");
      assert.strictEqual(msg.from, "agent-1");
      assert.deepStrictEqual(msg.metadata, envelopeWithSource.metadata);
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("should return empty when no markers present", () => {
      const result = parseMeshMarkers("plain text without markers", "agent-a");
      assert.strictEqual(result.messages.length, 0);
      assert.strictEqual(result.sanitized, "plain text without markers");
    });

    it("should handle multiple v2 markers", () => {
      const env1 = { ...SAMPLE_V2_ENVELOPE, id: "v2-multi-1" };
      const env2 = { ...SAMPLE_V2_ENVELOPE, id: "v2-multi-2" };
      const raw = `${MESH_MARKER_V2_OPEN}${JSON.stringify(env1)}${MESH_MARKER_CLOSE} and ${MESH_MARKER_V2_OPEN}${JSON.stringify(env2)}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "fallback");

      assert.strictEqual(result.messages.length, 2);
      assert.strictEqual(result.messages[0].id, "v2-multi-1");
      assert.strictEqual(result.messages[1].id, "v2-multi-2");
    });

    it("should still serialize to v1 format when version=1 (backward compat)", () => {
      const msg = makeMessage({ id: "ser-1", type: "question" });
      const serialized = serializeToMarker(msg, "1");

      assert.ok(serialized.startsWith(MESH_MARKER_OPEN));
      assert.ok(serialized.endsWith(MESH_MARKER_CLOSE));
      assert.ok(!serialized.includes("v2"));
    });

    it("should serialize to v2 format by default", () => {
      const msg = makeMessage({ id: "ser-2", type: "question" });
      const serialized = serializeToMarker(msg);

      assert.ok(serialized.startsWith(MESH_MARKER_V2_OPEN));
      assert.ok(serialized.endsWith(MESH_MARKER_CLOSE));
    });
  });
});
