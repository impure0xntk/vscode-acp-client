import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import { useMessageStore } from "../../../store/messageStore";

// ── webviewMessageHandler — file-write + writeSeq integration ──────────────
//
// Test the store-level effects of the three handler functions that coordinate
// file-write tracking.  We don't call the handler functions directly (they
// are bound to window.addEventListener), but we replicate their store
// interactions to verify correctness:
//
//   handleSessionFileWrite  → fileWriteStore.addWrite(agentId, sessionId, path, content)
//   handleSessionStreamStart → fileWriteStore.currentSeq() → messageStore.updateLastAgentMessage({ writeSeq })
//   handleSessionTurnActive(active=false) → fileWriteStore.clearSession(agentId, sessionId)

describe("webviewMessageHandler — file-write & writeSeq integration", () => {
  const agentId = "claude";
  const sessionId = "sess-filewrite";
  const msgKey = `${agentId}:${sessionId}`;

  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
    useMessageStore.setState({ perSession: {}, streaming: {} });
  });

  // ── handleSessionFileWrite → fileWriteStore.addWrite ─────────────

  describe("handleSessionFileWrite → addWrite", () => {
    it("adds a write record with correct path and content", () => {
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/foo.ts", "line1\nline2");
      const writes = useFileWriteStore.getState().getWritesForSession(agentId, sessionId);
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(writes[0].path, "/foo.ts");
      assert.strictEqual(writes[0].content, "line1\nline2");
      assert.strictEqual(writes[0].seq, 0);
    });

    it("increments global seq across writes from different sessions", () => {
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/a.ts", "a");
      useFileWriteStore.getState().addWrite(agentId, "other-sess", "/b.ts", "b");
      const w1 = useFileWriteStore.getState().getWritesForSession(agentId, sessionId);
      const w2 = useFileWriteStore.getState().getWritesForSession(agentId, "other-sess");
      assert.strictEqual(w1[0].seq, 0);
      assert.strictEqual(w2[0].seq, 1);
    });
  });

  // ── handleSessionStreamStart → currentSeq → updateLastAgentMessage ──

  describe("handleSessionStreamStart → writeSeq stamp", () => {
    it("stamps writeSeq=0 on first agent message when no writes have occurred", () => {
      const writeSeq = useFileWriteStore.getState().currentSeq();
      assert.strictEqual(writeSeq, 0);

      // Simulate what handleSessionStreamStart does
      useMessageStore.getState().appendMessage(msgKey, {
        id: "msg-1",
        role: "agent",
        content: "thinking",
        timestamp: Date.now(),
        agentId,
        sessionId,
      });
      useMessageStore.getState().updateLastAgentMessage(msgKey, { writeSeq });

      const msgs = useMessageStore.getState().perSession[msgKey];
      assert.strictEqual(msgs[0].writeSeq, 0);
    });

    it("stamps writeSeq=N (current seq) after N writes have been recorded", () => {
      // Agent streams step1 → writeSeq=0 (no writes yet)
      // During step1 streaming, 2 writes happen
      // Agent streams step2 → writeSeq=2 (2 writes recorded)
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/a.ts", "a"); // seq=0
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/b.ts", "b"); // seq=1

      const writeSeqStep2 = useFileWriteStore.getState().currentSeq();
      assert.strictEqual(writeSeqStep2, 2);
    });
  });

  // ── handleSessionTurnActive(active=false) → clearSession ─────────

  describe("handleSessionTurnActive(active=false) → clearSession", () => {
    it("clears writes when turn ends, leaving seq counter intact", () => {
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/a.ts", "a"); // seq=0
      assert.strictEqual(useFileWriteStore.getState().currentSeq(), 1);

      // Turn ends → clearSession
      useFileWriteStore.getState().clearSession(agentId, sessionId);
      assert.strictEqual(
        useFileWriteStore.getState().getWritesForSession(agentId, sessionId).length, 0
      );
      // Seq counter preserved — next write gets seq=1 (continues from global)
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/b.ts", "b");
      const writes = useFileWriteStore.getState().getWritesForSession(agentId, sessionId);
      assert.strictEqual(writes[0].seq, 1);
    });

    it("does not affect writes of other sessions when clearing", () => {
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/a.ts", "a");
      useFileWriteStore.getState().addWrite(agentId, "other", "/b.ts", "b");

      useFileWriteStore.getState().clearSession(agentId, sessionId);
      assert.strictEqual(
        useFileWriteStore.getState().getWritesForSession(agentId, "other").length, 1
      );
    });
  });

  // ── End-to-end flow: streamStart → writes → turnEnd → new turn ───

  describe("full turn flow: stream → write → clear → new turn", () => {
    it("properly resets for a new turn after clearing", () => {
      // Turn 1: streamStart(writeSeq=0) → write → turnEnd(clear)
      const writeSeq1 = useFileWriteStore.getState().currentSeq();
      assert.strictEqual(writeSeq1, 0);

      useFileWriteStore.getState().addWrite(agentId, sessionId, "/a.ts", "a"); // seq=0
      assert.strictEqual(useFileWriteStore.getState().currentSeq(), 1);

      // Turn ends
      useFileWriteStore.getState().clearSession(agentId, sessionId);

      // Turn 2: streamStart(writeSeq=1) → writes → summary only sees turn 2 writes
      const writeSeq2 = useFileWriteStore.getState().currentSeq();
      assert.strictEqual(writeSeq2, 1);

      useFileWriteStore.getState().addWrite(agentId, sessionId, "/c.ts", "c\nc"); // seq=1
      useFileWriteStore.getState().addWrite(agentId, sessionId, "/d.ts", "d");   // seq=2

      const writes = useFileWriteStore.getState().getWritesForSession(agentId, sessionId);
      assert.strictEqual(writes.length, 2);
      assert.strictEqual(writes[0].path, "/c.ts");
      assert.strictEqual(writes[1].path, "/d.ts");
    });
  });
});
