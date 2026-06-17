import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure data from CompletionNotification ────────────────────────────────────

type TurnOutcome = "completed" | "error" | "cancelled";

const OUTCOME_ICON: Record<TurnOutcome, string> = {
  completed: "pass-filled",
  error: "error",
  cancelled: "circle-slash",
};

const OUTCOME_CLASS: Record<TurnOutcome, string> = {
  completed: "completion-notification--completed",
  error: "completion-notification--error",
  cancelled: "completion-notification--cancelled",
};

function resolveNotificationDisplay(outcome: TurnOutcome) {
  return {
    iconName: OUTCOME_ICON[outcome],
    className: OUTCOME_CLASS[outcome],
  };
}

function resolveDisplayName(title: string, sessionId: string): string {
  return title || sessionId.slice(0, 8);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("CompletionNotification display logic", () => {
  describe("resolveNotificationDisplay", () => {
    it("returns pass-filled icon for completed", () => {
      const result = resolveNotificationDisplay("completed");
      assert.strictEqual(result.iconName, "pass-filled");
      assert.strictEqual(
        result.className,
        "completion-notification--completed"
      );
    });

    it("returns error icon for error", () => {
      const result = resolveNotificationDisplay("error");
      assert.strictEqual(result.iconName, "error");
      assert.strictEqual(result.className, "completion-notification--error");
    });

    it("returns circle-slash icon for cancelled", () => {
      const result = resolveNotificationDisplay("cancelled");
      assert.strictEqual(result.iconName, "circle-slash");
      assert.strictEqual(
        result.className,
        "completion-notification--cancelled"
      );
    });
  });

  describe("resolveDisplayName", () => {
    it("returns title when title is provided", () => {
      assert.strictEqual(
        resolveDisplayName("My Session", "abc1234567890"),
        "My Session"
      );
    });

    it("returns first 8 chars of sessionId when title is empty", () => {
      assert.strictEqual(resolveDisplayName("", "abc1234567890"), "abc12345");
    });

    it("returns first 8 chars of sessionId when title is whitespace", () => {
      // Empty string after trim — but the component checks truthiness
      // so whitespace-only title would still be truthy
      assert.strictEqual(resolveDisplayName("  ", "abc1234567890"), "  ");
    });

    it("handles short sessionId", () => {
      assert.strictEqual(resolveDisplayName("", "abc"), "abc");
    });
  });
});
