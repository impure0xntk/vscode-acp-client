import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useMessageStore } from "../../store/messageStore";
import type { ChatMessage } from "../../types";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "agent",
    content: "test content",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("messageStore", () => {
  beforeEach(() => {
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
  });

  // ── setMessages ────────────────────────────────────────────────────

  describe("setMessages", () => {
    it("stores messages under perSession[key]", () => {
      const msgs = [makeMessage(), makeMessage()];
      useMessageStore.getState().setMessages("session-1", msgs);
      const state = useMessageStore.getState();
      assert.deepStrictEqual(state.perSession["session-1"], msgs);
    });

    it("is a no-op when called with same reference", () => {
      const msgs = [makeMessage()];
      useMessageStore.getState().setMessages("session-1", msgs);
      const stateBefore = useMessageStore.getState();
      useMessageStore.getState().setMessages("session-1", msgs);
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
    });

    it("replaces existing messages", () => {
      const msgs1 = [makeMessage({ content: "old" })];
      useMessageStore.getState().setMessages("session-1", msgs1);
      const msgs2 = [makeMessage({ content: "new" }), makeMessage()];
      useMessageStore.getState().setMessages("session-1", msgs2);
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][0].content, "new");
    });
  });

  // ── appendMessage ─────────────────────────────────────────────────

  describe("appendMessage", () => {
    it("appends to existing array", () => {
      const msg1 = makeMessage();
      useMessageStore.getState().appendMessage("session-1", msg1);
      const msg2 = makeMessage();
      useMessageStore.getState().appendMessage("session-1", msg2);
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][0], msg1);
      assert.strictEqual(state.perSession["session-1"][1], msg2);
    });

    it("creates new array if key doesn't exist", () => {
      const msg = makeMessage();
      useMessageStore.getState().appendMessage("new-key", msg);
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["new-key"].length, 1);
      assert.strictEqual(state.perSession["new-key"][0], msg);
    });

    it("maintains order across multiple appends", () => {
      const msgs = [makeMessage(), makeMessage(), makeMessage(), makeMessage()];
      for (const m of msgs) {
        useMessageStore.getState().appendMessage("session-1", m);
      }
      const state = useMessageStore.getState();
      for (let i = 0; i < msgs.length; i++) {
        assert.strictEqual(state.perSession["session-1"][i], msgs[i]);
      }
    });
  });

  // ── setStreaming ──────────────────────────────────────────────────

  describe("setStreaming", () => {
    it("sets streaming flag to true", () => {
      useMessageStore.getState().setStreaming("session-1", true);
      assert.strictEqual(
        useMessageStore.getState().streaming["session-1"],
        true
      );
    });

    it("clears streaming flag when set to false", () => {
      useMessageStore.getState().setStreaming("session-1", true);
      useMessageStore.getState().setStreaming("session-1", false);
      // setStreaming(false) sets the value to false (does not delete the key)
      assert.strictEqual(
        useMessageStore.getState().streaming["session-1"],
        false
      );
    });

    it("is a no-op when called with same value", () => {
      useMessageStore.getState().setStreaming("session-1", false);
      const stateBefore = useMessageStore.getState();
      useMessageStore.getState().setStreaming("session-1", false);
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
    });
  });

  // ── appendStreamChunk ─────────────────────────────────────────────

  describe("appendStreamChunk", () => {
    it("creates new agent message if no messages exist", () => {
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "Hello");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(state.perSession["session-1"][0].role, "agent");
      assert.strictEqual(state.perSession["session-1"][0].content, "Hello");
      assert.strictEqual(state.perSession["session-1"][0].agentId, "agent-1");
      assert.strictEqual(state.perSession["session-1"][0].sessionId, "sess-A");
    });

    it("appends to last agent message if it matches agentId", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "Hello",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " World");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(
        state.perSession["session-1"][0].content,
        "Hello World"
      );
    });

    it("creates new agent message if last message is from different agent", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "Hello",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-2", "sess-B", "Bye");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][0].content, "Hello");
      assert.strictEqual(state.perSession["session-1"][1].content, "Bye");
      assert.strictEqual(state.perSession["session-1"][1].agentId, "agent-2");
    });

    it("creates new agent message if last message is not agent role", () => {
      const msg = makeMessage({
        role: "user",
        agentId: "agent-1",
        content: "User said",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "Reply");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][1].role, "agent");
      assert.strictEqual(state.perSession["session-1"][1].content, "Reply");
    });

    it("sets streaming flag to true", () => {
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "chunk");
      assert.strictEqual(
        useMessageStore.getState().streaming["session-1"],
        true
      );
    });

    it("accumulates content correctly across multiple chunks", () => {
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "Hel");
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "lo");
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " W");
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "orld");
      const state = useMessageStore.getState();
      assert.strictEqual(
        state.perSession["session-1"][0].content,
        "Hello World"
      );
    });
  });

  // ── clearSession ──────────────────────────────────────────────────

  describe("clearSession", () => {
    it("removes session from perSession", () => {
      useMessageStore.getState().setMessages("session-1", [makeMessage()]);
      useMessageStore.getState().clearSession("session-1");
      const state = useMessageStore.getState();
      assert.strictEqual("session-1" in state.perSession, false);
    });

    it("is a no-op for non-existent key", () => {
      useMessageStore.getState().setMessages("session-1", [makeMessage()]);
      const stateBefore = useMessageStore.getState();
      useMessageStore.getState().clearSession("nonexistent");
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
      assert.deepStrictEqual(
        stateAfter.perSession["session-1"],
        stateBefore.perSession["session-1"]
      );
    });
  });

  // ── addQueuedPrompt ───────────────────────────────────────────────

  describe("addQueuedPrompt", () => {
    it("appends to promptQueue", () => {
      const entry1 = {
        id: "q1",
        agentId: "agent-1",
        sessionId: "sess-A",
        text: "prompt1",
        enqueuedAt: "2024-01-01",
        status: "pending" as const,
      };
      const entry2 = {
        id: "q2",
        agentId: "agent-1",
        sessionId: "sess-A",
        text: "prompt2",
        enqueuedAt: "2024-01-01",
        status: "pending" as const,
      };
      useMessageStore.getState().addQueuedPrompt("session-1", entry1);
      useMessageStore.getState().addQueuedPrompt("session-1", entry2);
      const state = useMessageStore.getState();
      assert.strictEqual(state.promptQueue["session-1"].length, 2);
      assert.strictEqual(state.promptQueue["session-1"][0], entry1);
      assert.strictEqual(state.promptQueue["session-1"][1], entry2);
    });

    it("creates new queue if none exists", () => {
      const entry = {
        id: "q1",
        agentId: "agent-1",
        sessionId: "sess-A",
        text: "prompt",
        enqueuedAt: "2024-01-01",
        status: "pending" as const,
      };
      useMessageStore.getState().addQueuedPrompt("new-key", entry);
      const state = useMessageStore.getState();
      assert.deepStrictEqual(state.promptQueue["new-key"], [entry]);
    });
  });

  // ── updateLastAgentMessage ────────────────────────────────────────

  describe("updateLastAgentMessage", () => {
    it("stops stopReason onto the last agent message", () => {
      const msgs = [
        makeMessage({ role: "user", content: "q" }),
        makeMessage({ role: "agent", content: "thinking..." }),
        makeMessage({ role: "agent", content: "final answer" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        stopReason: "end_turn",
      });
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 3);
      // Last agent message now has stopReason
      assert.strictEqual(
        state.perSession["session-1"][2].stopReason,
        "end_turn"
      );
      // Other messages unchanged
      assert.strictEqual(
        state.perSession["session-1"][1].stopReason,
        undefined
      );
    });

    it("skips __stepBoundary when no unboundary agent exists", () => {
      // When the only agent message has __stepBoundary, updateLastAgentMessage
      // skips it (since it's an intermediate step, not the final response).
      const msgs = [
        makeMessage({ role: "user", content: "q" }),
        makeMessage({ role: "agent", content: "intermediate", __stepBoundary: true }),
        makeMessage({ role: "tool", content: "tool result" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        stopReason: "cancelled",
      });
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 3);
      // The agent with __stepBoundary is skipped, so no message gets stopReason
      assert.strictEqual(
        state.perSession["session-1"][1].stopReason,
        undefined
      );
    });

    it("updates the last tool message when no agent message exists", () => {
      const msgs = [
        makeMessage({ role: "user", content: "q" }),
        makeMessage({ role: "tool", content: "tool result" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        stopReason: "cancelled",
      });
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(
        state.perSession["session-1"][1].stopReason,
        "cancelled"
      );
    });

    it("is a no-op when no messages exist", () => {
      useMessageStore.getState().updateLastAgentMessage("empty-key", {
        stopReason: "end_turn",
      });
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["empty-key"], undefined);
    });

    it("is a no-op when messages exist but none are agent/tool", () => {
      const msgs = [makeMessage({ role: "user", content: "q" })];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        stopReason: "end_turn",
      });
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"][0].stopReason, undefined);
    });

    it("skips agent messages with stopReason (previous turn final response)", () => {
      // Simulate: Turn 1 final agent message has stopReason:"end_turn".
      // When Turn 2 starts (writeSeq stamping), updateLastAgentMessage
      // must NOT overwrite the previous turn's writeSeq.
      const msgs = [
        makeMessage({ role: "user", content: "q1" }),
        makeMessage({ role: "agent", content: "a1", writeSeq: 0, stopReason: "end_turn", __stepBoundary: false }),
        makeMessage({ role: "user", content: "q2" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        writeSeq: 5,
      });
      const state = useMessageStore.getState();
      // The Turn 1 agent message (with stopReason) must NOT be modified
      assert.strictEqual(state.perSession["session-1"][1].writeSeq, 0);
      // No agent message without stopReason exists — falls back to tool message (none exist) → no-op
    });

    it("preserves existing message properties when updating", () => {
      const msg = makeMessage({
        role: "agent",
        content: "hello",
        agentId: "claude",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        stopReason: "max_tokens",
      });
      const state = useMessageStore.getState();
      const updated = state.perSession["session-1"][0];
      assert.strictEqual(updated.content, "hello");
      assert.strictEqual(updated.agentId, "claude");
      assert.strictEqual(updated.role, "agent");
      assert.strictEqual(updated.stopReason, "max_tokens");
    });
  });

  // ── updateMessage ─────────────────────────────────────────────────

  describe("updateMessage", () => {
    it("replaces message at the given index", () => {
      const msgs = [
        makeMessage({ content: "first" }),
        makeMessage({ content: "second" }),
        makeMessage({ content: "third" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      const replacement = makeMessage({ content: "updated second" });
      useMessageStore.getState().updateMessage("session-1", 1, replacement);
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 3);
      assert.strictEqual(state.perSession["session-1"][0].content, "first");
      assert.strictEqual(state.perSession["session-1"][1].content, "updated second");
      assert.strictEqual(state.perSession["session-1"][2].content, "third");
    });

    it("is a no-op when index is out of bounds (negative)", () => {
      const msgs = [makeMessage({ content: "only" })];
      useMessageStore.getState().setMessages("session-1", msgs);
      const stateBefore = useMessageStore.getState();
      useMessageStore.getState().updateMessage("session-1", -1, makeMessage({ content: "x" }));
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
    });

    it("is a no-op when index is out of bounds (too large)", () => {
      const msgs = [makeMessage({ content: "only" })];
      useMessageStore.getState().setMessages("session-1", msgs);
      const stateBefore = useMessageStore.getState();
      useMessageStore.getState().updateMessage("session-1", 5, makeMessage({ content: "x" }));
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
    });

    it("is a no-op when session key does not exist", () => {
      const stateBefore = useMessageStore.getState();
      useMessageStore.getState().updateMessage("nonexistent", 0, makeMessage({ content: "x" }));
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
    });

    it("preserves immutability — returns new array reference", () => {
      const msgs = [
        makeMessage({ content: "a" }),
        makeMessage({ content: "b" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      const oldArray = useMessageStore.getState().perSession["session-1"];
      useMessageStore.getState().updateMessage("session-1", 0, makeMessage({ content: "A" }));
      const newArray = useMessageStore.getState().perSession["session-1"];
      assert.notStrictEqual(newArray, oldArray);
    });

    it("does not affect other sessions", () => {
      useMessageStore.getState().setMessages("session-1", [makeMessage({ content: "a" })]);
      useMessageStore.getState().setMessages("session-2", [makeMessage({ content: "b" })]);
      useMessageStore.getState().updateMessage("session-1", 0, makeMessage({ content: "A" }));
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"][0].content, "A");
      assert.strictEqual(state.perSession["session-2"][0].content, "b");
    });
  });

  // ── closeCurrentAgentMessage ─────────────────────────────────────

  describe("closeCurrentAgentMessage", () => {
    it("marks the last in-progress agent message as step boundary", () => {
      const msgs = [
        makeMessage({ role: "agent", content: "first text", id: "m1" }),
        makeMessage({ role: "tool", content: "", id: "m2" }),
        makeMessage({ role: "agent", content: "second text", id: "m3" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().closeCurrentAgentMessage("session-1");
      const state = useMessageStore.getState();
      // m3 is the last in-progress agent → gets __stepBoundary
      assert.strictEqual(state.perSession["session-1"][2].__stepBoundary, true);
      // m1 is untouched (it is behind a tool message, not the last)
      assert.strictEqual(state.perSession["session-1"][0].__stepBoundary, undefined);
    });

    it("does nothing when no in-progress agent message exists", () => {
      const msgs = [
        makeMessage({ role: "agent", content: "done", stopReason: "end_turn" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().closeCurrentAgentMessage("session-1");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"][0].__stepBoundary, undefined);
    });

    it("is a no-op for empty session", () => {
      useMessageStore.getState().closeCurrentAgentMessage("empty-key");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["empty-key"], undefined);
    });
  });

  // ── __stepBoundary prevents chunk merging ─────────────────────────

  describe("__stepBoundary blocks merge", () => {
    it("appendStreamChunk creates new message after boundary", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first segment",
        __stepBoundary: true,
      });
      useMessageStore.getState().setMessages("session-1", [msg]);
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " new segment");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][0].content, "first segment");
      assert.strictEqual(state.perSession["session-1"][1].content, " new segment");
    });

    it("appendStreamChunks creates new messages after boundary", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first segment",
        __stepBoundary: true,
      });
      useMessageStore.getState().setMessages("session-1", [msg]);
      useMessageStore
        .getState()
        .appendStreamChunks("session-1", "agent-1", "sess-A", ["chunk1", "chunk2"]);
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 3);
    });

    it("boundary is created by tool_call completion then blocks next text", () => {
      // Simulate: agent text → tool_call → tool completes → new agent text
      const agentMsg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "analyzing...",
        id: "agent-1",
      });
      const toolMsg = makeMessage({
        role: "tool",
        id: "tool-1",
      });
      useMessageStore.getState().setMessages("session-1", [agentMsg, toolMsg]);

      // Tool completes → closeCurrentAgentMessage marks agent-1
      useMessageStore.getState().closeCurrentAgentMessage("session-1");

      // Next text chunk should create a NEW agent message
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " result");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 3);
      assert.strictEqual(state.perSession["session-1"][0].__stepBoundary, true);
      assert.strictEqual(state.perSession["session-1"][0].content, "analyzing...");
      assert.strictEqual(state.perSession["session-1"][2].content, " result");
    });

    it("stopReason clears __stepBoundary on the final message", () => {
      // Set up: intermediate step (with boundary) + final agent message
      const msgs = [
        makeMessage({
          role: "agent",
          agentId: "agent-1",
          content: "intermediate",
          __stepBoundary: true,
          id: "intermediate",
        }),
        makeMessage({
          role: "agent",
          agentId: "agent-1",
          content: "final",
          id: "final",
        }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);

      // turnEnded stamps stopReason on the LAST non-boundary agent message
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        stopReason: "end_turn",
        __stepBoundary: false,
      });

      const state = useMessageStore.getState();
      // The final message (id=final) gets stopReason + boundary cleared
      assert.strictEqual(state.perSession["session-1"][1].stopReason, "end_turn");
      assert.strictEqual(state.perSession["session-1"][1].__stepBoundary, false);
      // The intermediate message keeps its __stepBoundary
      assert.strictEqual(state.perSession["session-1"][0].__stepBoundary, true);
      assert.strictEqual(state.perSession["session-1"][0].stopReason, undefined);
    });

    it("getLastAgentMessage skips stepBoundary messages", () => {
      const msgs = [
        makeMessage({ role: "agent", content: "first", __stepBoundary: true }),
        makeMessage({ role: "tool", content: "" }),
        makeMessage({ role: "agent", content: "current", id: "current" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      const last = useMessageStore.getState().getLastAgentMessage("session-1");
      assert.ok(last);
      assert.strictEqual(last!.id, "current");
    });

    it("getLastAgentMessage skips stopReason messages (previous turn)", () => {
      const msgs = [
        makeMessage({ role: "agent", content: "turn1-final", stopReason: "end_turn", id: "t1" }),
        makeMessage({ role: "user", content: "q2" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      const last = useMessageStore.getState().getLastAgentMessage("session-1");
      // Should return null — the only agent message belongs to a completed turn
      assert.strictEqual(last, null);
    });
  });

  // ── messageId-based merge ─────────────────────────────────────────

  describe("messageId-based merge", () => {
    it("appendStreamChunk merges into existing message with same messageId across __stepBoundary", () => {
      // Simulate: agent text (id=m1) → tool_call → more text with same id=m1
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first part",
        id: "m1",
        __stepBoundary: true,
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      // Same messageId → should merge even though __stepBoundary is set
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " second part", "m1");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(
        state.perSession["session-1"][0].content,
        "first part second part"
      );
    });

    it("appendStreamChunk creates new message when messageId differs", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first",
        id: "m1",
        __stepBoundary: true,
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      // Different messageId → new message
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "second", "m2");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][0].content, "first");
      assert.strictEqual(state.perSession["session-1"][1].content, "second");
      assert.strictEqual(state.perSession["session-1"][1].id, "m2");
    });

    it("appendStreamChunks merges all chunks into same messageId target", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "Hello",
        id: "m1",
        __stepBoundary: true,
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      useMessageStore
        .getState()
        .appendStreamChunks("session-1", "agent-1", "sess-A", [" W", "orld"], "m1");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(state.perSession["session-1"][0].content, "Hello World");
    });

    it("messageId merge skips tool messages in between", () => {
      // agent(m1) → tool → agent(m1 again, same logical message)
      const msgs = [
        makeMessage({ role: "agent", content: "analyzing", id: "m1" }),
        makeMessage({ role: "tool", content: "result", id: "t1" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);

      // closeCurrentAgentMessage marks m1 as boundary
      useMessageStore.getState().closeCurrentAgentMessage("session-1");

      // Same messageId m1 → merge into the first agent message
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " complete", "m1");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][0].content, "analyzing complete");
      assert.strictEqual(state.perSession["session-1"][1].content, "result");
    });

    it("messageId=null falls back to normal merge logic", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first",
        id: "m1",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      // No messageId → normal merge into last agent
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " second", null);

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(state.perSession["session-1"][0].content, "first second");
    });

    it("new message uses messageId as id when creating from scratch", () => {
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "Hello", "new-id");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(state.perSession["session-1"][0].id, "new-id");
      assert.strictEqual(state.perSession["session-1"][0].content, "Hello");
    });
  });

  // ── Cross-session isolation ───────────────────────────────────────

  describe("cross-session isolation", () => {
    it("setMessages does not affect other sessions", () => {
      useMessageStore
        .getState()
        .setMessages("session-1", [makeMessage({ content: "a" })]);
      useMessageStore
        .getState()
        .setMessages("session-2", [makeMessage({ content: "b" })]);
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"][0].content, "a");
      assert.strictEqual(state.perSession["session-2"][0].content, "b");
    });

    it("appendMessage does not affect other sessions", () => {
      useMessageStore
        .getState()
        .appendMessage("session-1", makeMessage({ content: "x" }));
      useMessageStore
        .getState()
        .appendMessage("session-2", makeMessage({ content: "y" }));
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(state.perSession["session-2"].length, 1);
    });

    it("setStreaming is independent per session", () => {
      useMessageStore.getState().setStreaming("session-1", true);
      const state = useMessageStore.getState();
      assert.strictEqual(state.streaming["session-1"], true);
      assert.strictEqual(state.streaming["session-2"], undefined);
    });

    it("appendStreamChunk is isolated per session", () => {
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", "chunk1");
      useMessageStore
        .getState()
        .appendStreamChunk("session-2", "agent-2", "sess-B", "chunk2");
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"][0].content, "chunk1");
      assert.strictEqual(state.perSession["session-2"][0].content, "chunk2");
    });

    it("promptQueue is isolated per session", () => {
      const entry1 = {
        id: "q1",
        agentId: "a1",
        sessionId: "s1",
        text: "t1",
        enqueuedAt: "2024-01-01",
        status: "pending" as const,
      };
      const entry2 = {
        id: "q2",
        agentId: "a2",
        sessionId: "s2",
        text: "t2",
        enqueuedAt: "2024-01-01",
        status: "pending" as const,
      };
      useMessageStore.getState().addQueuedPrompt("session-1", entry1);
      useMessageStore.getState().addQueuedPrompt("session-2", entry2);
      const state = useMessageStore.getState();
      assert.deepStrictEqual(state.promptQueue["session-1"], [entry1]);
      assert.deepStrictEqual(state.promptQueue["session-2"], [entry2]);
    });

    it("clearSession does not affect other sessions", () => {
      useMessageStore.getState().setMessages("session-1", [makeMessage()]);
      useMessageStore.getState().setMessages("session-2", [makeMessage()]);
      useMessageStore.getState().clearSession("session-1");
      const state = useMessageStore.getState();
      assert.strictEqual("session-1" in state.perSession, false);
      assert.strictEqual(state.perSession["session-2"].length, 1);
    });
  });
});
