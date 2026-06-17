import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure logic from UnreadBadge ──────────────────────────────────────────────

function formatUnreadCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function shouldShowBadge(count: number, hidden: boolean): boolean {
  return count > 0 && !hidden;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("UnreadBadge logic", () => {
  describe("formatUnreadCount", () => {
    it("returns null for 0", () => {
      assert.strictEqual(formatUnreadCount(0), null);
    });

    it("returns null for negative", () => {
      assert.strictEqual(formatUnreadCount(-1), null);
    });

    it("returns string for 1-99", () => {
      assert.strictEqual(formatUnreadCount(1), "1");
      assert.strictEqual(formatUnreadCount(50), "50");
      assert.strictEqual(formatUnreadCount(99), "99");
    });

    it("returns '99+' for 100+", () => {
      assert.strictEqual(formatUnreadCount(100), "99+");
      assert.strictEqual(formatUnreadCount(999), "99+");
    });
  });

  describe("shouldShowBadge", () => {
    it("returns false when count is 0", () => {
      assert.strictEqual(shouldShowBadge(0, false), false);
    });

    it("returns false when hidden is true", () => {
      assert.strictEqual(shouldShowBadge(5, true), false);
    });

    it("returns true when count > 0 and not hidden", () => {
      assert.strictEqual(shouldShowBadge(1, false), true);
      assert.strictEqual(shouldShowBadge(50, false), true);
    });

    it("returns false when count is negative", () => {
      assert.strictEqual(shouldShowBadge(-1, false), false);
    });
  });
});
