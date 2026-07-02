import * as assert from "assert";
import { describe, it } from "mocha";
import {
  selectMessageCount,
  selectToolCallCount,
  selectToolCallsCompleted,
} from "../../store/selectors";
import type { MessageState } from "../../store/messageStore";
import type { ChatMessage } from "../../types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "agent",
    content: "test content",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeState(perSession: Record<string, ChatMessage[]>): MessageState {
  return {
    perSession,
    streaming: {},
    promptQueue: {},
    lastSessionUpdateType: {},
    setMessages: () => {},
    appendMessage: () => {},
    setStreaming: () => {},
    appendStreamChunk: () => {},
    appendStreamChunks: () => {},
    updateLastAgentMessage: () => {},
    getLastAgentMessage: () => null,
    updateMessage: () => {},
    clearSession: () => {},
    addQueuedPrompt: () => {},
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("selectors", () => {
  // ── selectMessageCount ────────────────────────────────────────────────

  describe("selectMessageCount", () => {
    it("returns 0 for a non-existent session", () => {
      const state = makeState({});
      assert.strictEqual(selectMessageCount(state, "claude", "sess-1"), 0);
    });

    it("returns the correct count for an existing session", () => {
      const msgs = [
        makeMessage({ role: "user" }),
        makeMessage({ role: "agent" }),
        makeMessage({ role: "agent" }),
      ];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(selectMessageCount(state, "claude", "sess-1"), 3);
    });

    it("returns 0 for an empty message array", () => {
      const state = makeState({ "claude:sess-1": [] });
      assert.strictEqual(selectMessageCount(state, "claude", "sess-1"), 0);
    });

    it("counts messages independently per session", () => {
      const state = makeState({
        "claude:sess-1": [makeMessage(), makeMessage()],
        "gpt4:sess-2": [makeMessage()],
      });
      assert.strictEqual(selectMessageCount(state, "claude", "sess-1"), 2);
      assert.strictEqual(selectMessageCount(state, "gpt4", "sess-2"), 1);
    });
  });

  // ── selectToolCallCount ───────────────────────────────────────────────

  describe("selectToolCallCount", () => {
    it("returns 0 for a non-existent session", () => {
      const state = makeState({});
      assert.strictEqual(selectToolCallCount(state, "claude", "sess-1"), 0);
    });

    it("returns 0 when messages have no toolCalls", () => {
      const msgs = [makeMessage(), makeMessage()];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(selectToolCallCount(state, "claude", "sess-1"), 0);
    });

    it("counts tool calls across all messages", () => {
      const msgs = [
        makeMessage({
          toolCalls: [
            { id: "tc-1", title: "Read", status: "completed", kind: "read" },
            { id: "tc-2", title: "Write", status: "completed", kind: "edit" },
          ],
        }),
        makeMessage({
          toolCalls: [
            {
              id: "tc-3",
              title: "Run",
              status: "in_progress",
              kind: "execute",
            },
          ],
        }),
      ];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(selectToolCallCount(state, "claude", "sess-1"), 3);
    });

    it("handles messages with undefined toolCalls", () => {
      const msgs = [
        makeMessage({ toolCalls: undefined }),
        makeMessage({
          toolCalls: [
            { id: "tc-1", title: "Read", status: "completed", kind: "read" },
          ],
        }),
      ];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(selectToolCallCount(state, "claude", "sess-1"), 1);
    });
  });

  // ── selectToolCallsCompleted ──────────────────────────────────────────

  describe("selectToolCallsCompleted", () => {
    it("returns 0 for a non-existent session", () => {
      const state = makeState({});
      assert.strictEqual(
        selectToolCallsCompleted(state, "claude", "sess-1"),
        0
      );
    });

    it("returns 0 when no tool calls are completed", () => {
      const msgs = [
        makeMessage({
          toolCalls: [
            { id: "tc-1", title: "Read", status: "in_progress", kind: "read" },
            { id: "tc-2", title: "Write", status: "failed", kind: "edit" },
          ],
        }),
      ];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(
        selectToolCallsCompleted(state, "claude", "sess-1"),
        0
      );
    });

    it("counts only completed tool calls", () => {
      const msgs = [
        makeMessage({
          toolCalls: [
            { id: "tc-1", title: "Read", status: "completed", kind: "read" },
            { id: "tc-2", title: "Write", status: "in_progress", kind: "edit" },
            { id: "tc-3", title: "Run", status: "completed", kind: "execute" },
            { id: "tc-4", title: "Search", status: "failed", kind: "search" },
          ],
        }),
      ];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(
        selectToolCallsCompleted(state, "claude", "sess-1"),
        2
      );
    });

    it("counts completed tool calls across multiple messages", () => {
      const msgs = [
        makeMessage({
          toolCalls: [
            { id: "tc-1", title: "A", status: "completed", kind: "read" },
          ],
        }),
        makeMessage({
          toolCalls: [
            { id: "tc-2", title: "B", status: "completed", kind: "edit" },
            { id: "tc-3", title: "C", status: "in_progress", kind: "execute" },
          ],
        }),
      ];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(
        selectToolCallsCompleted(state, "claude", "sess-1"),
        2
      );
    });

    it("handles messages with undefined toolCalls", () => {
      const msgs = [
        makeMessage({ toolCalls: undefined }),
        makeMessage({
          toolCalls: [
            { id: "tc-1", title: "A", status: "completed", kind: "read" },
          ],
        }),
      ];
      const state = makeState({ "claude:sess-1": msgs });
      assert.strictEqual(
        selectToolCallsCompleted(state, "claude", "sess-1"),
        1
      );
    });
  });
});
