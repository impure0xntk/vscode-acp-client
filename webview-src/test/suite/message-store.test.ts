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

    it("skips agent messages without stopReason when looking for final", () => {
      // When the only agent message has no stopReason but is followed by tool,
      // updateLastAgentMessage finds it and stamps stopReason.
      const msgs = [
        makeMessage({ role: "user", content: "q" }),
        makeMessage({ role: "agent", content: "intermediate" }),
        makeMessage({ role: "tool", content: "tool result" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);
      useMessageStore.getState().updateLastAgentMessage("session-1", {
        stopReason: "cancelled",
      });
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 3);
      // The last agent message gets stopReason
      assert.strictEqual(
        state.perSession["session-1"][1].stopReason,
        "cancelled"
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
      assert.strictEqual(
        state.perSession["session-1"][0].stopReason,
        undefined
      );
    });

    it("skips agent messages with stopReason (previous turn final response)", () => {
      // Simulate: Turn 1 final agent message has stopReason:"end_turn".
      // When Turn 2 starts (writeSeq stamping), updateLastAgentMessage
      // must NOT overwrite the previous turn's writeSeq.
      const msgs = [
        makeMessage({ role: "user", content: "q1" }),
        makeMessage({
          role: "agent",
          content: "a1",
          writeSeq: 0,
          stopReason: "end_turn",
        }),
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
      assert.strictEqual(
        state.perSession["session-1"][1].content,
        "updated second"
      );
      assert.strictEqual(state.perSession["session-1"][2].content, "third");
    });

    it("is a no-op when index is out of bounds (negative)", () => {
      const msgs = [makeMessage({ content: "only" })];
      useMessageStore.getState().setMessages("session-1", msgs);
      const stateBefore = useMessageStore.getState();
      useMessageStore
        .getState()
        .updateMessage("session-1", -1, makeMessage({ content: "x" }));
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
    });

    it("is a no-op when index is out of bounds (too large)", () => {
      const msgs = [makeMessage({ content: "only" })];
      useMessageStore.getState().setMessages("session-1", msgs);
      const stateBefore = useMessageStore.getState();
      useMessageStore
        .getState()
        .updateMessage("session-1", 5, makeMessage({ content: "x" }));
      const stateAfter = useMessageStore.getState();
      assert.strictEqual(stateAfter, stateBefore);
    });

    it("is a no-op when session key does not exist", () => {
      const stateBefore = useMessageStore.getState();
      useMessageStore
        .getState()
        .updateMessage("nonexistent", 0, makeMessage({ content: "x" }));
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
      useMessageStore
        .getState()
        .updateMessage("session-1", 0, makeMessage({ content: "A" }));
      const newArray = useMessageStore.getState().perSession["session-1"];
      assert.notStrictEqual(newArray, oldArray);
    });

    it("does not affect other sessions", () => {
      useMessageStore
        .getState()
        .setMessages("session-1", [makeMessage({ content: "a" })]);
      useMessageStore
        .getState()
        .setMessages("session-2", [makeMessage({ content: "b" })]);
      useMessageStore
        .getState()
        .updateMessage("session-1", 0, makeMessage({ content: "A" }));
      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"][0].content, "A");
      assert.strictEqual(state.perSession["session-2"][0].content, "b");
    });
  });

  // ── messageId-based merge ─────────────────────────────────────────

  describe("messageId-based merge", () => {
    it("appendStreamChunk merges into existing message with same messageId", () => {
      // Simulate: agent text (id=m1) → tool_call → more text with same id=m1
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first part",
        id: "m1",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      // Same messageId → should merge
      useMessageStore
        .getState()
        .appendStreamChunk(
          "session-1",
          "agent-1",
          "sess-A",
          " second part",
          "m1"
        );

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(
        state.perSession["session-1"][0].content,
        "first part second part"
      );
    });

    it("appendStreamChunk merges when messageId differs but no tool in between", () => {
      // Different messageId (m1 vs m2) with same agent and no tool in between
      // should create a NEW message (different messageId = different logical message/step).
      // Step boundaries are determined by ACP messageId, not by tool messages.
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first",
        id: "m1",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      // Different messageId → new message (new step)
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " second", "m2");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(state.perSession["session-1"][0].content, "first");
      assert.strictEqual(state.perSession["session-1"][1].content, " second");
      assert.strictEqual(state.perSession["session-1"][1].id, "m2");
    });

    it("appendStreamChunk creates new message when messageId differs and last is different agent", () => {
      const msg = makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "first",
        id: "m1",
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      // Different agent → new message
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-2", "sess-A", "second", "m2");

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
      });
      useMessageStore.getState().setMessages("session-1", [msg]);

      useMessageStore
        .getState()
        .appendStreamChunks(
          "session-1",
          "agent-1",
          "sess-A",
          [" W", "orld"],
          "m1"
        );

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 1);
      assert.strictEqual(
        state.perSession["session-1"][0].content,
        "Hello World"
      );
    });

    it("messageId merge skips tool messages in between", () => {
      // agent(m1) → tool → agent(m1 again, same logical message)
      const msgs = [
        makeMessage({ role: "agent", content: "analyzing", id: "m1" }),
        makeMessage({ role: "tool", content: "result", id: "t1" }),
      ];
      useMessageStore.getState().setMessages("session-1", msgs);

      // Same messageId m1 → merge into the first agent message
      useMessageStore
        .getState()
        .appendStreamChunk("session-1", "agent-1", "sess-A", " complete", "m1");

      const state = useMessageStore.getState();
      assert.strictEqual(state.perSession["session-1"].length, 2);
      assert.strictEqual(
        state.perSession["session-1"][0].content,
        "analyzing complete"
      );
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
      assert.strictEqual(
        state.perSession["session-1"][0].content,
        "first second"
      );
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

    it("keeps thought and response as separate messages when they share a messageId", () => {
      // Regression: when an ACP agent emits an agent_thought_chunk and a
      // subsequent agent_message_chunk with the SAME messageId (a single
      // assistant turn with extended thinking), the response text must NOT
      // be merged into the thinking message.  Merging would produce one
      // message carrying both `thinking` and `content`, which Message.tsx
      // renders mixed (thinking block + response body in one container).
      const key = "session-shared";
      const store = useMessageStore.getState();

      // Thought chunk → dedicated thinking message (id == messageId)
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "reasoning about the problem",
        "m1",
        "agent_thought_chunk"
      );

      // Response chunk with the SAME messageId → its own response message.
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "here is the answer",
        "m1",
        "agent_message_chunk"
      );

      const msgs = useMessageStore.getState().perSession[key];
      assert.strictEqual(msgs.length, 2, "two distinct messages");

      const think = msgs.find((m) => m.thinking != null);
      const resp = msgs.find((m) => m.thinking == null && m.role === "agent");
      assert.ok(think, "thinking message exists");
      assert.ok(resp, "response message exists");

      assert.strictEqual(
        think!.thinking!.content,
        "reasoning about the problem",
        "thinking content intact"
      );
      assert.strictEqual(
        think!.content,
        "",
        "thinking message has no response content"
      );
      assert.strictEqual(
        resp!.content,
        "here is the answer",
        "response content isolated from thinking"
      );
      assert.strictEqual(resp!.thinking, undefined, "response has no thinking");
      // Distinct logical messages must keep distinct ids.
      assert.notStrictEqual(think!.id, resp!.id, "distinct ids");
    });
  });

  // ── Regression: reused messageId across turns (end_turn final step) ──
  // Some ACP agents reuse the same messageId across distinct turns.  When a
  // prior turn already ended (stopReason set) and the next turn reuses that
  // messageId, its chunks must NOT be merged into the prior turn's message —
  // otherwise the final step ends up showing the previous step's message
  // mixed into the final response.

  describe("regression: reused messageId across turns", () => {
    function makeAgent(overrides: Partial<ChatMessage> = {}): ChatMessage {
      return makeMessage({
        role: "agent",
        agentId: "agent-1",
        content: "step content",
        id: "m1",
        ...overrides,
      });
    }

    it("does not merge the final turn's chunks into a completed prior turn (same messageId)", () => {
      const key = "session-reuse";
      const store = useMessageStore.getState();

      // Turn N: agent message id=m1 streams, then ends with tool_use.
      store.setMessages(key, [
        makeMessage({ role: "user", content: "q" }),
        makeAgent({ content: "step1 text" }),
      ]);
      // session/turnEnded stamps stopReason on the last agent message.
      store.updateLastAgentMessage(key, { stopReason: "tool_use" });

      // The tool call from turn N is delivered as its own message.
      store.appendMessage(
        key,
        makeMessage({
          role: "tool",
          content: "tool result",
          id: "t1",
          toolCalls: [
            { id: "tc1", title: "Bash", status: "completed", kind: "bash" },
          ],
        })
      );

      // Turn N+1 (final): agent reuses messageId "m1" — must NOT merge into
      // the completed step1 message.
      store.appendStreamChunk(key, "agent-1", "sess-A", " final answer", "m1");

      const msgs = useMessageStore.getState().perSession[key];
      // user, step1(agent), tool, finalAnswer(agent) → 4 distinct messages
      assert.strictEqual(msgs.length, 4, "must remain 4 distinct messages");

      const step1 = msgs[1];
      const finalMsg = msgs[3];
      assert.strictEqual(step1.role, "agent");
      assert.strictEqual(step1.content, "step1 text", "prior step untouched");
      assert.strictEqual(
        step1.stopReason,
        "tool_use",
        "prior step keeps its stopReason"
      );
      assert.strictEqual(finalMsg.role, "agent");
      assert.strictEqual(
        finalMsg.content,
        " final answer",
        "final turn content isolated"
      );
      assert.notStrictEqual(
        step1.id,
        finalMsg.id,
        "distinct ids for distinct turns"
      );
    });

    it("stamps end_turn onto the new final message, not the prior step", () => {
      const key = "session-reuse-2";
      const store = useMessageStore.getState();

      store.setMessages(key, [
        makeMessage({ role: "user", content: "q" }),
        makeAgent({ content: "step1 text" }),
      ]);
      store.updateLastAgentMessage(key, { stopReason: "tool_use" });
      store.appendMessage(
        key,
        makeMessage({
          role: "tool",
          content: "tool result",
          id: "t1",
          toolCalls: [
            { id: "tc1", title: "Bash", status: "completed", kind: "bash" },
          ],
        })
      );
      store.appendStreamChunk(key, "agent-1", "sess-A", " final answer", "m1");

      // session/turnEnded for the final turn.
      store.updateLastAgentMessage(key, { stopReason: "end_turn" });

      const msgs = useMessageStore.getState().perSession[key];
      // end_turn must land on the final agent message, never the prior step.
      assert.strictEqual(msgs[1].stopReason, "tool_use");
      assert.strictEqual(msgs[3].stopReason, "end_turn");
      assert.strictEqual(
        msgs[3].content,
        " final answer",
        "final response not contaminated by prior step"
      );
    });

    it("still merges same messageId within a single in-progress turn", () => {
      // A single logical message whose chunks arrive across a tool boundary
      // (no stopReason stamped yet) must still merge — this is the legitimate
      // same-messageId continuation the guard must preserve.
      const key = "session-reuse-3";
      const store = useMessageStore.getState();
      store.setMessages(key, [
        makeAgent({ content: "first part", stopReason: undefined }),
      ]);
      // No stopReason yet → still in-progress → merge allowed.
      store.appendStreamChunk(key, "agent-1", "sess-A", " second part", "m1");
      const msgs = useMessageStore.getState().perSession[key];
      assert.strictEqual(msgs.length, 1, "single in-progress message");
      assert.strictEqual(msgs[0].content, "first part second part");
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

  // ── Thinking stream finalization (think → thought) ───────────────

  describe("thinking stream finalization", () => {
    it("finalizes a streaming think when a different think starts", () => {
      const key = "session-1";
      const store = useMessageStore.getState();
      // Think #1
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "reasoning a",
        "think-1",
        "agent_thought_chunk"
      );
      // Think #2 (different messageId) → think #1 becomes a completed "Thought"
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "reasoning b",
        "think-2",
        "agent_thought_chunk"
      );

      const msgs = useMessageStore.getState().perSession[key];
      const thinks = msgs.filter((m) => m.thinking != null);
      assert.strictEqual(thinks.length, 2, "two separate thinking messages");
      // Think #1 finalized (isStreaming=false); think #2 still streaming
      assert.strictEqual(
        thinks[0].thinking!.isStreaming,
        false,
        "think #1 is a completed thought"
      );
      assert.strictEqual(
        thinks[1].thinking!.isStreaming,
        true,
        "think #2 still streaming"
      );
    });

    it("keeps merging chunks of the same think (same messageId)", () => {
      const key = "session-1";
      const store = useMessageStore.getState();
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "part1 ",
        "think-1",
        "agent_thought_chunk"
      );
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "part2",
        "think-1",
        "agent_thought_chunk"
      );
      const msgs = useMessageStore.getState().perSession[key];
      const thinks = msgs.filter((m) => m.thinking != null);
      assert.strictEqual(thinks.length, 1, "single thinking message");
      assert.strictEqual(thinks[0].thinking!.content, "part1 part2");
      assert.strictEqual(thinks[0].thinking!.isStreaming, true);
    });

    it("finalizes a streaming think when a non-thinking response follows a tool call", () => {
      const key = "session-1";
      const store = useMessageStore.getState();
      store.appendMessage(key, makeMessage({ role: "user", content: "q" }));
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "thinking hard",
        "think-1",
        "agent_thought_chunk"
      );
      // Tool call separates the think from the response
      store.appendMessage(
        key,
        makeMessage({
          role: "tool",
          content: "ran",
          id: "t1",
          toolCalls: [
            { id: "tc1", title: "Bash", status: "completed", kind: "bash" },
          ],
        })
      );
      // Response text (different messageId, non-thinking chunk)
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "final answer",
        "resp-1"
      );

      const msgs = useMessageStore.getState().perSession[key];
      const thinks = msgs.filter((m) => m.thinking != null);
      assert.strictEqual(thinks.length, 1);
      assert.strictEqual(
        thinks[0].thinking!.isStreaming,
        false,
        "think finalized before the response"
      );
      // Response is created as its own (non-thinking) agent message
      const resp = msgs.find(
        (m) =>
          m.role === "agent" &&
          m.thinking == null &&
          m.content === "final answer"
      );
      assert.ok(resp, "response created as its own message");
    });

    it("separates think chunks across a tool call into distinct thinks", () => {
      const key = "session-1";
      const store = useMessageStore.getState();
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "before tool",
        "think-1",
        "agent_thought_chunk"
      );
      store.appendMessage(
        key,
        makeMessage({
          role: "tool",
          content: "ran",
          id: "t1",
          toolCalls: [
            { id: "tc1", title: "Bash", status: "completed", kind: "bash" },
          ],
        })
      );
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "after tool",
        "think-2",
        "agent_thought_chunk"
      );

      const msgs = useMessageStore.getState().perSession[key];
      const thinks = msgs.filter((m) => m.thinking != null);
      assert.strictEqual(thinks.length, 2);
      // Think #1 (before the tool) must be finalized as a "Thought"
      assert.strictEqual(thinks[0].thinking!.isStreaming, false);
      assert.strictEqual(thinks[1].thinking!.isStreaming, true);
    });

    it("does not re-finalize an already-completed think from a previous turn", () => {
      const key = "session-1";
      const store = useMessageStore.getState();
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "past think",
        "think-old",
        "agent_thought_chunk"
      );
      // Turn ends → finalizeThinking marks it done
      store.finalizeThinking(key);
      // Next turn starts with a new think (distinct messageId)
      store.appendStreamChunk(
        key,
        "agent-1",
        "sess-A",
        "new think",
        "think-new",
        "agent_thought_chunk"
      );

      const msgs = useMessageStore.getState().perSession[key];
      const thinks = msgs.filter((m) => m.thinking != null);
      assert.strictEqual(thinks.length, 2);
      // The past think stays finalized; the new think is streaming
      assert.strictEqual(thinks[0].thinking!.isStreaming, false);
      assert.strictEqual(thinks[1].thinking!.isStreaming, true);
    });
  });
});
