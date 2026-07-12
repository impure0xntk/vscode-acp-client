import * as assert from "assert";
import { describe, it } from "mocha";
import { getTurnOutput, collectTurns } from "../../lib/sessionTurns";
import type { ChatMessage } from "../../types";
import { useSessionStore } from "../../store/sessionStore";

function msg(
  p: Partial<ChatMessage> & { role: ChatMessage["role"] }
): ChatMessage {
  return {
    id: `m-${Math.random().toString(36).slice(2, 6)}`,
    content: "",
    timestamp: Date.now(),
    ...p,
  } as ChatMessage;
}

describe("sessionTurns.getTurnOutput", () => {
  it("returns null for a non-user message index", () => {
    const messages = [msg({ role: "agent", content: "hi" })];
    assert.strictEqual(getTurnOutput(messages, 0), null);
  });

  it("returns the last real agent text before the next user message", () => {
    const messages = [
      msg({ role: "user", content: "q1" }),
      msg({ role: "agent", content: "first" }),
      msg({ role: "agent", content: "second" }),
      msg({ role: "user", content: "q2" }),
    ];
    assert.strictEqual(getTurnOutput(messages, 0), "second");
  });

  it("prefers the message carrying stopReason as the turn end", () => {
    const messages = [
      msg({ role: "user", content: "q1" }),
      msg({ role: "agent", content: "fallback" }),
      msg({ role: "agent", content: "final", stopReason: "end_turn" }),
    ];
    assert.strictEqual(getTurnOutput(messages, 0), "final");
  });

  it("skips thinking-only messages and keeps looking for text", () => {
    const messages = [
      msg({ role: "user", content: "q1" }),
      msg({
        role: "agent",
        content: "",
        thinking: { type: "thinking", content: "hmm" },
      }),
      msg({ role: "agent", content: "answer" }),
    ];
    assert.strictEqual(getTurnOutput(messages, 0), "answer");
  });

  it("returns null when the turn produced no agent output", () => {
    const messages = [msg({ role: "user", content: "q" })];
    assert.strictEqual(getTurnOutput(messages, 0), null);
  });
});

describe("sessionTurns.collectTurns", () => {
  it("collects one turn per user message with its final output", () => {
    useSessionStore.getState().setTabTitle("agentA:session1", "My Session");
    const perSession = {
      "agentA:session1": [
        msg({ role: "user", content: "analyze this" }),
        msg({ role: "agent", content: "result", stopReason: "end_turn" }),
      ],
    };
    const turns = collectTurns(perSession);
    assert.strictEqual(turns.length, 1);
    assert.strictEqual(turns[0].agentId, "agentA");
    assert.strictEqual(turns[0].sessionId, "session1");
    assert.strictEqual(turns[0].turnIndex, 0);
    assert.strictEqual(turns[0].output, "result");
    assert.strictEqual(turns[0].sessionTitle, "My Session");
  });

  it("falls back to a truncated session id when no tab title exists", () => {
    const perSession = {
      "agentZ:sessZ": [
        msg({ role: "user", content: "q" }),
        msg({ role: "agent", content: "out" }),
      ],
    };
    const turns = collectTurns(perSession);
    assert.strictEqual(turns.length, 1);
    assert.strictEqual(turns[0].sessionTitle, "sessZ");
  });

  it("skips turns that produced no agent output", () => {
    const perSession = {
      "a:s": [msg({ role: "user", content: "q" })],
    };
    assert.strictEqual(collectTurns(perSession).length, 0);
  });

  it("sorts turns most-recent first", () => {
    const perSession = {
      "a:s": [
        msg({ role: "user", content: "old", timestamp: 100 }),
        msg({ role: "agent", content: "old-out", timestamp: 101 }),
        msg({ role: "user", content: "new", timestamp: 200 }),
        msg({ role: "agent", content: "new-out", timestamp: 201 }),
      ],
    };
    const turns = collectTurns(perSession);
    assert.strictEqual(turns.length, 2);
    assert.strictEqual(turns[0].output, "new-out");
    assert.strictEqual(turns[1].output, "old-out");
  });
});
