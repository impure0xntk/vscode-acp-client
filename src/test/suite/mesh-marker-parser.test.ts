// ============================================================================
// Mesh Marker Parser unit tests
// ============================================================================

import * as assert from "assert";
import {
  parseMeshMarkers,
  serializeToMarker,
} from "../../shared/util/mesh-marker-parser";
import type { P2PMessage } from "../../domain/models/mesh";
import { MESH_MARKER_OPEN, MESH_MARKER_CLOSE } from "../../domain/models/mesh";

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

const SAMPLE_ENVELOPE = {
  version: "1.0",
  type: "question",
  id: "test-id-1",
  to: "agent-b",
  payload: { question: "hello" },
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("mesh-marker-parser", () => {
  // -----------------------------------------------------------------------
  // parseMeshMarkers
  // -----------------------------------------------------------------------

  describe("parseMeshMarkers", () => {
    it("should extract a single JSON marker", () => {
      const raw = `before${MESH_MARKER_OPEN}${JSON.stringify(SAMPLE_ENVELOPE)}${MESH_MARKER_CLOSE}after`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].type, "question");
      assert.strictEqual(result.messages[0].id, "test-id-1");
      assert.strictEqual(result.messages[0].from, "agent-a");
      assert.strictEqual(result.messages[0].to, "agent-b");
    });

    it("should extract multiple markers", () => {
      const env1 = {
        ...SAMPLE_ENVELOPE,
        id: "id-1",
        type: "task_request" as const,
      };
      const env2 = {
        ...SAMPLE_ENVELOPE,
        id: "id-2",
        type: "task_response" as const,
      };
      const raw = `text ${MESH_MARKER_OPEN}${JSON.stringify(env1)}${MESH_MARKER_CLOSE} middle ${MESH_MARKER_OPEN}${JSON.stringify(env2)}${MESH_MARKER_CLOSE} end`;

      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 2);
      assert.strictEqual(result.messages[0].id, "id-1");
      assert.strictEqual(result.messages[1].id, "id-2");
    });

    it("should return empty when no markers present", () => {
      const result = parseMeshMarkers("plain text without markers", "agent-a");
      assert.strictEqual(result.messages.length, 0);
      assert.strictEqual(result.sanitized, "plain text without markers");
    });

    it("should sanitize markers from output", () => {
      const raw = `${MESH_MARKER_OPEN}${JSON.stringify(SAMPLE_ENVELOPE)}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.ok(!result.sanitized.includes(MESH_MARKER_OPEN));
      assert.ok(!result.sanitized.includes(MESH_MARKER_CLOSE));
    });

    it("should preserve text around markers in sanitized output", () => {
      const raw = `hello ${MESH_MARKER_OPEN}${JSON.stringify(SAMPLE_ENVELOPE)}${MESH_MARKER_CLOSE} world`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.ok(result.sanitized.includes("hello"));
      assert.ok(result.sanitized.includes("world"));
      assert.ok(!result.sanitized.includes(MESH_MARKER_OPEN));
    });

    it("should skip malformed JSON content", () => {
      const raw = `${MESH_MARKER_OPEN}{invalid json${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 0);
    });

    it("should skip content missing required fields", () => {
      const raw = `${MESH_MARKER_OPEN}{"version":"1.0"}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 0);
    });

    it("should parse fallback key-value format", () => {
      const kvContent = `type: question\nid: kv-id-1\n to: agent-b`;
      const raw = `${MESH_MARKER_OPEN}${kvContent}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].type, "question");
      assert.strictEqual(result.messages[0].id, "kv-id-1");
      assert.strictEqual(result.messages[0].to, "agent-b");
    });

    it("should use broadcast as default target in fallback format", () => {
      const kvContent = `type: status_update\nid: su-1`;
      const raw = `${MESH_MARKER_OPEN}${kvContent}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].to, "broadcast");
    });

    it("should reject fallback content without type", () => {
      const kvContent = `id: no-type-1\n to: agent-b`;
      const raw = `${MESH_MARKER_OPEN}${kvContent}${MESH_MARKER_CLOSE}`;
      const result = parseMeshMarkers(raw, "agent-a");

      assert.strictEqual(result.messages.length, 0);
    });

    it("should set timestamp on extracted messages", () => {
      const raw = `${MESH_MARKER_OPEN}${JSON.stringify(SAMPLE_ENVELOPE)}${MESH_MARKER_CLOSE}`;
      const before = new Date();
      const result = parseMeshMarkers(raw, "agent-a");
      const after = new Date();

      assert.ok(result.messages[0].timestamp >= before);
      assert.ok(result.messages[0].timestamp <= after);
    });
  });

  // -----------------------------------------------------------------------
  // serializeToMarker
  // -----------------------------------------------------------------------

  describe("serializeToMarker", () => {
    it("should serialize message to v2 marker format by default", () => {
      const msg = makeMessage({ id: "msg-1", type: "question" });
      const serialized = serializeToMarker(msg);

      assert.ok(serialized.startsWith("[ACP_MESH_MESSAGE v2]"));
      assert.ok(serialized.endsWith(MESH_MARKER_CLOSE));
    });

    it("should produce valid JSON inside v2 markers", () => {
      const msg = makeMessage({ id: "msg-2", type: "question", to: "agent-b" });
      const serialized = serializeToMarker(msg);

      const inner = serialized.slice(
        "[ACP_MESH_MESSAGE v2]".length,
        -MESH_MARKER_CLOSE.length
      );
      const parsed = JSON.parse(inner);

      assert.strictEqual(parsed.type, "question");
      assert.strictEqual(parsed.id, "msg-2");
      assert.strictEqual(parsed.to, "agent-b");
      assert.strictEqual(parsed.from, "agent-a");
      assert.strictEqual(parsed.version, "2.0");
      assert.strictEqual(parsed.mode, "p2P");
      assert.deepStrictEqual(parsed.payload, { question: "hello" });
    });

    it("should include metadata when present in v2", () => {
      const msg = makeMessage({
        id: "msg-3",
        type: "question",
        metadata: { priority: "high" },
      });
      const serialized = serializeToMarker(msg);

      const inner = serialized.slice(
        "[ACP_MESH_MESSAGE v2]".length,
        -MESH_MARKER_CLOSE.length
      );
      const parsed = JSON.parse(inner);

      assert.deepStrictEqual(parsed.metadata, { priority: "high" });
    });

    it("should round-trip v2 through parse", () => {
      const original = makeMessage({
        id: "round-trip-1",
        type: "question",
        to: "agent-b",
        payload: { question: "test round-trip" },
      });

      const serialized = serializeToMarker(original);
      const result = parseMeshMarkers(serialized, "agent-a");

      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].id, "round-trip-1");
      assert.strictEqual(result.messages[0].type, "question");
      assert.strictEqual(result.messages[0].to, "agent-b");
      assert.strictEqual(result.messages[0].from, "agent-a");
      assert.deepStrictEqual(result.messages[0].payload, {
        question: "test round-trip",
      });
    });

    it("should serialize to v1 format when version=1", () => {
      const msg = makeMessage({ id: "msg-v1", type: "question", to: "agent-b" });
      const serialized = serializeToMarker(msg, "1");

      assert.ok(serialized.startsWith(MESH_MARKER_OPEN));
      assert.ok(!serialized.includes("v2"));

      const inner = serialized.slice(
        MESH_MARKER_OPEN.length,
        -MESH_MARKER_CLOSE.length
      );
      const parsed = JSON.parse(inner);

      assert.strictEqual(parsed.version, "1.0");
      assert.strictEqual(parsed.type, "question");
      assert.strictEqual(parsed.id, "msg-v1");
    });
  });
});
