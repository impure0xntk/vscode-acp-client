import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure logic from UserJumpNav ──────────────────────────────────────────────

interface UserMessage {
  id: string;
  role: string;
}

function filterUserMessages(messages: UserMessage[]): UserMessage[] {
  return messages.filter((m) => m.role === "user");
}

function clampIndex(index: number, total: number): number {
  return Math.min(Math.max(0, index), Math.max(0, total - 1));
}

function wrapIndex(index: number, total: number): number {
  return (index + total) % total;
}

function computeJumpState(
  messages: UserMessage[],
  currentIdx: number
): {
  userMessages: UserMessage[];
  total: number;
  displayIdx: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevIdx: number;
  nextIdx: number;
} {
  const userMessages = filterUserMessages(messages);
  const total = userMessages.length;
  const clamped = clampIndex(currentIdx, total);
  const prevIdx = wrapIndex(clamped - 1, total);
  const nextIdx = wrapIndex(clamped + 1, total);

  return {
    userMessages,
    total,
    displayIdx: clamped + 1,
    hasPrev: total > 0,
    hasNext: total > 0,
    prevIdx,
    nextIdx,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("UserJumpNav logic", () => {
  describe("filterUserMessages", () => {
    it("returns only user messages", () => {
      const msgs: UserMessage[] = [
        { id: "1", role: "user" },
        { id: "2", role: "agent" },
        { id: "3", role: "user" },
      ];
      const result = filterUserMessages(msgs);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, "1");
      assert.strictEqual(result[1].id, "3");
    });

    it("returns empty array when no user messages", () => {
      const msgs: UserMessage[] = [
        { id: "1", role: "agent" },
        { id: "2", role: "system" },
      ];
      const result = filterUserMessages(msgs);
      assert.strictEqual(result.length, 0);
    });

    it("returns all messages when all are user", () => {
      const msgs: UserMessage[] = [
        { id: "1", role: "user" },
        { id: "2", role: "user" },
      ];
      const result = filterUserMessages(msgs);
      assert.strictEqual(result.length, 2);
    });

    it("handles empty input", () => {
      const result = filterUserMessages([]);
      assert.strictEqual(result.length, 0);
    });
  });

  describe("clampIndex", () => {
    it("returns 0 for total = 0", () => {
      assert.strictEqual(clampIndex(5, 0), 0);
    });

    it("clamps to 0 when index < 0", () => {
      assert.strictEqual(clampIndex(-1, 5), 0);
    });

    it("clamps to max when index >= total", () => {
      assert.strictEqual(clampIndex(10, 5), 4);
    });

    it("returns index when within range", () => {
      assert.strictEqual(clampIndex(2, 5), 2);
    });
  });

  describe("wrapIndex", () => {
    it("wraps negative to end", () => {
      assert.strictEqual(wrapIndex(-1, 5), 4);
    });

    it("wraps overflow to start", () => {
      assert.strictEqual(wrapIndex(5, 5), 0);
    });

    it("returns same index when in range", () => {
      assert.strictEqual(wrapIndex(2, 5), 2);
    });

    it("handles wrap-around from 0 to end", () => {
      assert.strictEqual(wrapIndex(0 - 1, 3), 2);
    });
  });

  describe("computeJumpState", () => {
    it("returns correct state for single user message", () => {
      const msgs: UserMessage[] = [{ id: "u1", role: "user" }];
      const state = computeJumpState(msgs, 0);
      assert.strictEqual(state.total, 1);
      assert.strictEqual(state.displayIdx, 1);
      assert.strictEqual(state.hasPrev, true);
      assert.strictEqual(state.hasNext, true);
    });

    it("returns correct state for multiple user messages", () => {
      const msgs: UserMessage[] = [
        { id: "u1", role: "user" },
        { id: "a1", role: "agent" },
        { id: "u2", role: "user" },
        { id: "a2", role: "agent" },
        { id: "u3", role: "user" },
      ];
      const state = computeJumpState(msgs, 0);
      assert.strictEqual(state.total, 3);
      assert.strictEqual(state.displayIdx, 1);
      // prev from 0 wraps to 2 (index 2 = u3)
      assert.strictEqual(state.userMessages[state.prevIdx].id, "u3");
      // next from 0 is 1 (index 1 = u2)
      assert.strictEqual(state.userMessages[state.nextIdx].id, "u2");
    });

    it("handles currentIdx out of range", () => {
      const msgs: UserMessage[] = [
        { id: "u1", role: "user" },
        { id: "u2", role: "user" },
      ];
      const state = computeJumpState(msgs, 10);
      assert.strictEqual(state.displayIdx, 2); // clamped to index 1, display = 2
    });

    it("handles no user messages", () => {
      const msgs: UserMessage[] = [
        { id: "a1", role: "agent" },
        { id: "a2", role: "agent" },
      ];
      const state = computeJumpState(msgs, 0);
      assert.strictEqual(state.total, 0);
      assert.strictEqual(state.hasPrev, false);
      assert.strictEqual(state.hasNext, false);
    });

    it("navigates forward correctly", () => {
      const msgs: UserMessage[] = [
        { id: "u1", role: "user" },
        { id: "u2", role: "user" },
        { id: "u3", role: "user" },
      ];
      const state = computeJumpState(msgs, 0);
      assert.strictEqual(state.nextIdx, 1);
      assert.strictEqual(state.userMessages[state.nextIdx].id, "u2");
    });

    it("navigates backward with wrap-around", () => {
      const msgs: UserMessage[] = [
        { id: "u1", role: "user" },
        { id: "u2", role: "user" },
        { id: "u3", role: "user" },
      ];
      const state = computeJumpState(msgs, 0);
      assert.strictEqual(state.prevIdx, 2);
      assert.strictEqual(state.userMessages[state.prevIdx].id, "u3");
    });
  });
});
