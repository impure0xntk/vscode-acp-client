import * as assert from "assert";
import { describe, it } from "mocha";
import {
  fmt,
  fmtDuration,
  fmtTimestamp,
  fmtCaps,
  visualBar,
  contextColor,
  statuslineChips,
} from "../../components/sessions/toolbar/formatting";
import type { StatuslineInfo } from "../../components/sessions/toolbar/formatting";
import type { ContextColor } from "../../components/primitives/Chip";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("formatting", () => {
  // ── fmt ────────────────────────────────────────────────────────────────

  describe("fmt", () => {
    it("returns plain string for numbers < 1000", () => {
      assert.strictEqual(fmt(0), "0");
      assert.strictEqual(fmt(1), "1");
      assert.strictEqual(fmt(999), "999");
    });

    it("formats thousands with 'k' suffix", () => {
      assert.strictEqual(fmt(1000), "1.0k");
      assert.strictEqual(fmt(1500), "1.5k");
      assert.strictEqual(fmt(999_999), "1000.0k");
    });

    it("formats millions with 'm' suffix", () => {
      assert.strictEqual(fmt(1_000_000), "1.0m");
      assert.strictEqual(fmt(1_500_000), "1.5m");
      assert.strictEqual(fmt(2_000_000), "2.0m");
      assert.strictEqual(fmt(10_000_000), "10.0m");
    });
  });

  // ── fmtDuration ───────────────────────────────────────────────────────

  describe("fmtDuration", () => {
    it("formats seconds only when < 60s", () => {
      assert.strictEqual(fmtDuration(0), "0s");
      assert.strictEqual(fmtDuration(5000), "5s");
      assert.strictEqual(fmtDuration(59_000), "59s");
    });

    it("formats minutes and seconds when >= 60s", () => {
      assert.strictEqual(fmtDuration(60_000), "1m 0s");
      assert.strictEqual(fmtDuration(90_000), "1m 30s");
      assert.strictEqual(fmtDuration(3_540_000), "59m 0s");
    });

    it("formats hours and minutes when >= 1h", () => {
      assert.strictEqual(fmtDuration(3_600_000), "1h 0m");
      assert.strictEqual(fmtDuration(3_660_000), "1h 1m");
      assert.strictEqual(fmtDuration(7_260_000), "2h 1m");
    });
  });

  // ── fmtTimestamp ──────────────────────────────────────────────────────

  describe("fmtTimestamp", () => {
    it("returns '—' for null input", () => {
      assert.strictEqual(fmtTimestamp(null), "—");
    });

    it("returns '—' for invalid date string", () => {
      assert.strictEqual(fmtTimestamp("not-a-date"), "—");
    });

    it("formats valid ISO timestamp as HH:MM:SS", () => {
      const d = new Date("2026-01-15T10:30:45Z");
      const pad = (n: number) => String(n).padStart(2, "0");
      const expected = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const result = fmtTimestamp("2026-01-15T10:30:45Z");
      assert.strictEqual(result, expected);
    });

    it("pads single-digit hours/minutes/seconds", () => {
      const d = new Date("2026-01-15T01:02:03Z");
      const pad = (n: number) => String(n).padStart(2, "0");
      const expected = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const result = fmtTimestamp("2026-01-15T01:02:03Z");
      assert.strictEqual(result, expected);
    });
  });

  // ── fmtCaps ───────────────────────────────────────────────────────────

  describe("fmtCaps", () => {
    it("joins all items when <= 3", () => {
      assert.strictEqual(fmtCaps(["a", "b"]), "a, b");
      assert.strictEqual(fmtCaps(["a", "b", "c"]), "a, b, c");
    });

    it("truncates with '+N more' when > 3", () => {
      assert.strictEqual(fmtCaps(["a", "b", "c", "d"]), "a, b, c, +1 more");
      assert.strictEqual(
        fmtCaps(["a", "b", "c", "d", "e"]),
        "a, b, c, +2 more"
      );
    });

    it("handles empty array", () => {
      assert.strictEqual(fmtCaps([]), "");
    });
  });

  // ── visualBar ─────────────────────────────────────────────────────────

  describe("visualBar", () => {
    it("returns '0' for ratio 0", () => {
      assert.strictEqual(visualBar(0), "0");
    });

    it("returns '100' for ratio 1", () => {
      assert.strictEqual(visualBar(1), "100");
    });

    it("returns '50' for ratio 0.5", () => {
      assert.strictEqual(visualBar(0.5), "50");
    });

    it("clamps ratio to [0, 1]", () => {
      assert.strictEqual(visualBar(-0.5), "0");
      assert.strictEqual(visualBar(1.5), "100");
    });

    it("rounds to nearest integer", () => {
      assert.strictEqual(visualBar(0.25), "25");
      assert.strictEqual(visualBar(0.33), "33");
      assert.strictEqual(visualBar(0.99), "99");
    });
  });

  // ── contextColor ──────────────────────────────────────────────────────

  describe("contextColor", () => {
    it("returns 'normal' for ratio < 0.7", () => {
      assert.strictEqual(contextColor(0), "normal");
      assert.strictEqual(contextColor(0.5), "normal");
      assert.strictEqual(contextColor(0.69), "normal");
    });

    it("returns 'warning' for ratio >= 0.7 and < 0.85", () => {
      assert.strictEqual(contextColor(0.7), "warning");
      assert.strictEqual(contextColor(0.8), "warning");
      assert.strictEqual(contextColor(0.84), "warning");
    });

    it("returns 'critical' for ratio >= 0.85", () => {
      assert.strictEqual(contextColor(0.85), "critical");
      assert.strictEqual(contextColor(0.99), "critical");
      assert.strictEqual(contextColor(1), "critical");
    });
  });

  // ── statuslineChips ───────────────────────────────────────────────────

  describe("statuslineChips", () => {
    it("returns empty array for empty statusline", () => {
      const result = statuslineChips({});
      assert.deepStrictEqual(result, []);
    });

    it("includes hostname chip when set", () => {
      const result = statuslineChips({ hostname: "myhost" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "hostname");
      assert.strictEqual(result[0].value, "myhost");
    });

    it("includes repoName chip when set", () => {
      const result = statuslineChips({ repoName: "myrepo" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "repo");
      assert.strictEqual(result[0].value, "myrepo");
    });

    it("includes branch chip when set", () => {
      const result = statuslineChips({ branch: "main" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "branch");
      assert.strictEqual(result[0].value, "main");
    });

    it("includes tag chip when set", () => {
      const result = statuslineChips({ tag: "v1.0.0" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "tag");
      assert.strictEqual(result[0].value, "v1.0.0");
    });

    it("includes cwd chip when provided", () => {
      const result = statuslineChips({}, "/workspace/proj");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "cwd");
      assert.strictEqual(result[0].value, "/workspace/proj");
    });

    it("includes all chips when all fields are set", () => {
      const result = statuslineChips(
        {
          hostname: "host",
          repoName: "repo",
          branch: "main",
          tag: "v1",
        },
        "/cwd"
      );
      assert.strictEqual(result.length, 5);
      const keys = result.map((c) => c.key);
      assert.ok(keys.includes("hostname"));
      assert.ok(keys.includes("repo"));
      assert.ok(keys.includes("branch"));
      assert.ok(keys.includes("tag"));
      assert.ok(keys.includes("cwd"));
    });

    it("all chips have category 'workspace'", () => {
      const result = statuslineChips({
        hostname: "h",
        repoName: "r",
        branch: "b",
        tag: "t",
      });
      for (const chip of result) {
        assert.strictEqual(chip.category, "workspace");
      }
    });
  });
});
