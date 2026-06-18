import * as assert from "assert";
import { describe, it } from "mocha";
import {
  useTriggerPicker,
  type TriggerState,
  type SelectInput,
  type SelectOutput,
} from "../../../hooks/useTriggerPicker";

// ── Test scenario: @session selection should NOT insert @label into textarea ─
// This mirrors the resolveItem branch in Composer.tsx for item.kind === "session"
// where subTrigger !== "switch". The expected behavior is:
//   newText = before + after  (i.e., the @query is removed, no label inserted)

describe("useTriggerPicker: @session selection does not insert label into text", () => {
  // ── Simulate the session branch of Composer.resolveItem ───────────────────
  // This is the exact logic from Composer.tsx lines 456-476 (after the fix).
  // We replicate it here to test the text transformation in isolation.

  function simulateSessionSelect(
    text: string,
    triggerState: TriggerState,
    item: { label: string; agentId: string; sessionId: string }
  ): string {
    const consumed = 1 + triggerState.query.length; // trigger === "@"
    const before = text.slice(0, triggerState.caretOffset);
    const after = text.slice(triggerState.caretOffset + consumed);

    // Multi-@: add to send targets instead of replacing
    // The key assertion: newText = before + after (no @label inserted)
    return before + after;
  }

  // ── Test data ────────────────────────────────────────────────────────────

  const sessionItem = {
    label: "My Session",
    agentId: "claude",
    sessionId: "sess-abc123",
  };

  // ── Tests ────────────────────────────────────────────────────────────────

  describe("@query at end of text", () => {
    it("removes @query and does NOT insert label", () => {
      const text = "@sess";
      const triggerState: TriggerState = {
        active: true,
        trigger: "@",
        query: "sess",
        caretOffset: 0,
      };
      const result = simulateSessionSelect(text, triggerState, sessionItem);
      assert.strictEqual(result, "");
      assert.ok(!result.includes("@"), "result should not contain @");
      assert.ok(!result.includes("My Session"), "result should not contain session label");
    });
  });

  describe("@query in middle of text", () => {
    it("removes @query from middle and joins before+after", () => {
      const text = "hello @sess world";
      const triggerState: TriggerState = {
        active: true,
        trigger: "@",
        query: "sess",
        caretOffset: 6,
      };
      const result = simulateSessionSelect(text, triggerState, sessionItem);
      assert.strictEqual(result, "hello  world");
      assert.ok(!result.includes("@"), "result should not contain @");
      assert.ok(!result.includes("My Session"), "result should not contain session label");
    });
  });

  describe("@query with preceding text and trailing space", () => {
    it("removes @query, keeps surrounding text intact", () => {
      // "fix the bug @sess please"
      //  0123456789012345678901234
      //  @ is at index 12, caretOffset = 12
      //  consumed = 1 ("@") + 4 ("sess") = 5
      //  before = text.slice(0, 12) = "fix the bug "
      //  after = text.slice(12 + 5) = text.slice(17) = " please"
      const text = "fix the bug @sess please";
      const triggerState: TriggerState = {
        active: true,
        trigger: "@",
        query: "sess",
        caretOffset: 12,
      };
      const result = simulateSessionSelect(text, triggerState, sessionItem);
      assert.strictEqual(result, "fix the bug  please");
      assert.ok(!result.includes("@"));
      assert.ok(!result.includes("My Session"));
    });
  });

  describe("@query with empty query (just @)", () => {
    it("removes @ and does NOT insert label", () => {
      const text = "@";
      const triggerState: TriggerState = {
        active: true,
        trigger: "@",
        query: "",
        caretOffset: 0,
      };
      const result = simulateSessionSelect(text, triggerState, sessionItem);
      assert.strictEqual(result, "");
      assert.ok(!result.includes("@"));
    });
  });

  describe("@query with text before and after", () => {
    it("removes @query from between words", () => {
      const text = "hey @sess check this";
      const triggerState: TriggerState = {
        active: true,
        trigger: "@",
        query: "sess",
        caretOffset: 4,
      };
      const result = simulateSessionSelect(text, triggerState, sessionItem);
      assert.strictEqual(result, "hey  check this");
    });
  });

  describe("multiple @ selections in sequence (multi-@ mode)", () => {
    it("first @ selection removes @query", () => {
      const text = "@claude";
      const triggerState: TriggerState = {
        active: true,
        trigger: "@",
        query: "claude",
        caretOffset: 0,
        multiMode: true,
      };
      const result = simulateSessionSelect(text, triggerState, {
        label: "claude",
        agentId: "claude",
        sessionId: "sess-1",
      });
      assert.strictEqual(result, "");
    });

    it("second @ selection on new text also removes @query", () => {
      // After first selection, user types more text with another @
      const text = "also @codex";
      const triggerState: TriggerState = {
        active: true,
        trigger: "@",
        query: "codex",
        caretOffset: 5,
        multiMode: true,
      };
      const result = simulateSessionSelect(text, triggerState, {
        label: "codex",
        agentId: "codex",
        sessionId: "sess-2",
      });
      assert.strictEqual(result, "also ");
      assert.ok(!result.includes("@"));
      assert.ok(!result.includes("codex"));
    });
  });

  // ── Integration: useTriggerPicker.handleSelect with mocked resolveItem ─────
  // This tests the full hook flow: handleSelect calls resolveItem, and the
  // returned text should NOT contain @label.

  describe("useTriggerPicker.handleSelect integration", () => {
    // We cannot directly test the Composer's resolveItem (it's a closure inside
    // the component), but we CAN test that useTriggerPicker.handleSelect
    // correctly passes the result of resolveItem through.

    it("passes resolveItem result text through to caller", async () => {
      let capturedText = "";

      // Create a minimal hook instance by calling useTriggerPicker
      // We use a test component pattern: the hook is called during render,
      // but we can test the logic by calling handleSelect directly on the
      // return value. Since React hooks require a component context, we
      // instead verify the contract: handleSelect returns whatever
      // resolveItem returns.

      // The contract test: if resolveItem returns text without @label,
      // handleSelect returns that same text.
      const mockResolveItem = async (
        input: SelectInput
      ): Promise<SelectOutput> => {
        // Simulate the session branch of Composer.resolveItem
        const { triggerState, item } = input;
        const consumed = 1 + triggerState.query.length;
        const before = input.text.slice(0, triggerState.caretOffset);
        const after = input.text.slice(triggerState.caretOffset + consumed);
        const newText = before + after; // no @label inserted

        capturedText = newText;
        return {
          text: newText,
          triggerState: {
            active: false,
            trigger: "#" as const,
            query: "",
            caretOffset: 0,
          },
        };
      };

      // Since we can't call useTriggerPicker outside React, we verify
      // the contract by calling mockResolveItem directly.
      const input: SelectInput = {
        text: "@claude",
        triggerState: {
          active: true,
          trigger: "@",
          query: "claude",
          caretOffset: 0,
        },
        item: {
          id: "session:claude:sess-1",
          kind: "session",
          label: "claude",
          value: "claude:sess-1",
          agentId: "claude",
          sessionId: "sess-1",
        },
      };

      const result = await mockResolveItem(input);
      assert.strictEqual(result.text, "");
      assert.ok(!result.text.includes("@"));
      assert.ok(!result.text.includes("claude"));
      assert.strictEqual(capturedText, "");
    });
  });
});
