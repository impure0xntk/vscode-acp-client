import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure data from SessionOverviewToolbar ────────────────────────────────────

type SessionOverviewFilter =
  | "all"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

const FILTER_LABELS: Record<SessionOverviewFilter, string> = {
  all: "All",
  running: "Running",
  completed: "Completed",
  error: "Error",
  cancelled: "Cancelled",
};

function resolveFilterLabel(
  filter: SessionOverviewFilter,
  isActive: boolean
): string {
  return isActive ? FILTER_LABELS[filter] : "Filter";
}

function toggleFilter(
  current: SessionOverviewFilter,
  selected: SessionOverviewFilter
): SessionOverviewFilter {
  return current === selected ? "all" : selected;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SessionOverviewToolbar display logic", () => {
  describe("FILTER_LABELS", () => {
    it("has label for each filter value", () => {
      const filters: SessionOverviewFilter[] = [
        "all",
        "running",
        "completed",
        "error",
        "cancelled",
      ];
      for (const f of filters) {
        assert.ok(FILTER_LABELS[f], `label for ${f} should exist`);
      }
    });

    it("all label is 'All'", () => {
      assert.strictEqual(FILTER_LABELS.all, "All");
    });

    it("running label is 'Running'", () => {
      assert.strictEqual(FILTER_LABELS.running, "Running");
    });
  });

  describe("resolveFilterLabel", () => {
    it("returns 'Filter' when not active", () => {
      assert.strictEqual(resolveFilterLabel("all", false), "Filter");
    });

    it("returns specific label when active", () => {
      assert.strictEqual(resolveFilterLabel("running", true), "Running");
      assert.strictEqual(resolveFilterLabel("completed", true), "Completed");
      assert.strictEqual(resolveFilterLabel("error", true), "Error");
      assert.strictEqual(resolveFilterLabel("cancelled", true), "Cancelled");
    });
  });

  describe("toggleFilter", () => {
    it("sets filter when different from current", () => {
      assert.strictEqual(toggleFilter("all", "running"), "running");
      assert.strictEqual(toggleFilter("running", "completed"), "completed");
    });

    it("resets to 'all' when same filter selected", () => {
      assert.strictEqual(toggleFilter("running", "running"), "all");
      assert.strictEqual(toggleFilter("error", "error"), "all");
    });

    it("toggles back and forth", () => {
      const f1 = toggleFilter("all", "running");
      assert.strictEqual(f1, "running");
      const f2 = toggleFilter(f1, "running");
      assert.strictEqual(f2, "all");
    });
  });
});
