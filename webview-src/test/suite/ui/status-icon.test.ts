import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure data from StatusIcon ────────────────────────────────────────────────

type StatusIconType =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "working"
  | "pending"
  | "waiting"
  | "waiting_for_input"
  | "disconnected"
  | "failed"
  | "in_progress"
  | "warning";

const classMap: Record<StatusIconType, string> = {
  idle: "idle",
  running: "running",
  working: "running",
  in_progress: "running",
  pending: "running",
  waiting: "waiting",
  waiting_for_input: "waiting_for_input",
  completed: "completed",
  failed: "error",
  error: "error",
  cancelled: "cancelled",
  warning: "warning",
  disconnected: "cancelled",
};

type ElapsedColor = "normal" | "warning" | "critical";

function elapsedColor(elapsedMs: number): ElapsedColor {
  if (elapsedMs >= 30_000) return "critical";
  if (elapsedMs >= 10_000) return "warning";
  return "normal";
}

function resolveStatusClass(status: StatusIconType): string {
  return classMap[status] ?? "idle";
}

function resolveColorSuffix(
  mapped: string,
  elapsedMs?: number,
  colorGroup?: string
): string {
  if (colorGroup === "waiting") {
    return " status-icon-waiting";
  }
  if (mapped === "running" && elapsedMs !== undefined) {
    const tier = elapsedColor(elapsedMs);
    if (tier === "warning") return " status-icon-running-warning";
    if (tier === "critical") return " status-icon-running-critical";
  }
  return "";
}

function resolveIconSize(size: "sm" | "md"): number {
  return size === "sm" ? 14 : 18;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("StatusIcon logic", () => {
  describe("classMap", () => {
    it("maps idle to 'idle'", () => {
      assert.strictEqual(resolveStatusClass("idle"), "idle");
    });

    it("maps running to 'running'", () => {
      assert.strictEqual(resolveStatusClass("running"), "running");
    });

    it("maps working to 'running'", () => {
      assert.strictEqual(resolveStatusClass("working"), "running");
    });

    it("maps in_progress to 'running'", () => {
      assert.strictEqual(resolveStatusClass("in_progress"), "running");
    });

    it("maps pending to 'running'", () => {
      assert.strictEqual(resolveStatusClass("pending"), "running");
    });

    it("maps waiting to 'waiting'", () => {
      assert.strictEqual(resolveStatusClass("waiting"), "waiting");
    });

    it("maps waiting_for_input to 'waiting_for_input'", () => {
      assert.strictEqual(
        resolveStatusClass("waiting_for_input"),
        "waiting_for_input"
      );
    });

    it("maps completed to 'completed'", () => {
      assert.strictEqual(resolveStatusClass("completed"), "completed");
    });

    it("maps failed to 'error'", () => {
      assert.strictEqual(resolveStatusClass("failed"), "error");
    });

    it("maps error to 'error'", () => {
      assert.strictEqual(resolveStatusClass("error"), "error");
    });

    it("maps cancelled to 'cancelled'", () => {
      assert.strictEqual(resolveStatusClass("cancelled"), "cancelled");
    });

    it("maps disconnected to 'cancelled'", () => {
      assert.strictEqual(resolveStatusClass("disconnected"), "cancelled");
    });

    it("maps warning to 'warning'", () => {
      assert.strictEqual(resolveStatusClass("warning"), "warning");
    });

    it("falls back to 'idle' for unknown status", () => {
      assert.strictEqual(
        resolveStatusClass("unknown" as StatusIconType),
        "idle"
      );
    });
  });

  describe("elapsedColor", () => {
    it("returns 'normal' for < 10s", () => {
      assert.strictEqual(elapsedColor(0), "normal");
      assert.strictEqual(elapsedColor(9_999), "normal");
    });

    it("returns 'warning' for 10s-29.9s", () => {
      assert.strictEqual(elapsedColor(10_000), "warning");
      assert.strictEqual(elapsedColor(29_999), "warning");
    });

    it("returns 'critical' for >= 30s", () => {
      assert.strictEqual(elapsedColor(30_000), "critical");
      assert.strictEqual(elapsedColor(60_000), "critical");
    });
  });

  describe("resolveColorSuffix", () => {
    it("returns waiting class when colorGroup is 'waiting'", () => {
      assert.strictEqual(
        resolveColorSuffix("running", undefined, "waiting"),
        " status-icon-waiting"
      );
    });

    it("returns warning class for running with elapsed >= 10s", () => {
      assert.strictEqual(
        resolveColorSuffix("running", 15_000),
        " status-icon-running-warning"
      );
    });

    it("returns critical class for running with elapsed >= 30s", () => {
      assert.strictEqual(
        resolveColorSuffix("running", 30_000),
        " status-icon-running-critical"
      );
    });

    it("returns empty for running with elapsed < 10s", () => {
      assert.strictEqual(resolveColorSuffix("running", 5000), "");
    });

    it("returns empty for non-running status", () => {
      assert.strictEqual(resolveColorSuffix("completed", 30_000), "");
    });

    it("returns empty when no colorGroup and no elapsed", () => {
      assert.strictEqual(resolveColorSuffix("idle"), "");
    });
  });

  describe("resolveIconSize", () => {
    it("returns 14 for sm", () => {
      assert.strictEqual(resolveIconSize("sm"), 14);
    });

    it("returns 18 for md", () => {
      assert.strictEqual(resolveIconSize("md"), 18);
    });
  });
});
