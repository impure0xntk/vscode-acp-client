import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure data from ModePicker ────────────────────────────────────────────────

type MeshMode = "fanout" | "supervisor" | "pipeline" | "status" | "task";

interface MeshModeCommand {
  mode: MeshMode;
  label: string;
  description: string;
  icon: string;
}

const MESH_MODES: MeshModeCommand[] = [
  {
    mode: "fanout",
    label: "Fanout",
    description: "Send to multiple agents",
    icon: "repo-forked",
  },
  {
    mode: "supervisor",
    label: "Supervisor",
    description: "Lead-worker pattern",
    icon: "brain",
  },
  {
    mode: "pipeline",
    label: "Pipeline",
    description: "Sequential chain",
    icon: "arrow-right-left",
  },
  {
    mode: "status",
    label: "Status",
    description: "Show mesh status",
    icon: "list-tree",
  },
  {
    mode: "task",
    label: "Task Board",
    description: "Show task board",
    icon: "output",
  },
];

function filterMeshModes(query: string): MeshModeCommand[] {
  if (!query) return MESH_MODES;
  return MESH_MODES.filter(
    (m) =>
      m.label.toLowerCase().includes(query.toLowerCase()) ||
      m.description.toLowerCase().includes(query.toLowerCase())
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ModePicker", () => {
  describe("MESH_MODES data", () => {
    it("contains 5 mesh modes", () => {
      assert.strictEqual(MESH_MODES.length, 5);
    });

    it("all modes have required fields", () => {
      for (const m of MESH_MODES) {
        assert.ok(m.mode, "mode should be set");
        assert.ok(m.label, "label should be set");
        assert.ok(m.description, "description should be set");
        assert.ok(m.icon, "icon should be set");
      }
    });

    it("all modes are unique", () => {
      const modes = MESH_MODES.map((m) => m.mode);
      assert.strictEqual(new Set(modes).size, modes.length);
    });

    it("all labels are unique", () => {
      const labels = MESH_MODES.map((m) => m.label);
      assert.strictEqual(new Set(labels).size, labels.length);
    });
  });

  describe("filterMeshModes", () => {
    it("returns all modes when query is empty", () => {
      const result = filterMeshModes("");
      assert.strictEqual(result.length, 5);
    });

    it("filters by label (case insensitive)", () => {
      const result = filterMeshModes("fan");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].mode, "fanout");
    });

    it("filters by description", () => {
      const result = filterMeshModes("sequential");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].mode, "pipeline");
    });

    it("returns multiple matches when query is broad", () => {
      const result = filterMeshModes("show");
      // "Show mesh status" and "Show task board"
      assert.strictEqual(result.length, 2);
    });

    it("returns empty array when no match", () => {
      const result = filterMeshModes("nonexistent");
      assert.strictEqual(result.length, 0);
    });

    it("handles uppercase query", () => {
      const result = filterMeshModes("FANOUT");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].mode, "fanout");
    });

    it("handles partial word match in description", () => {
      const result = filterMeshModes("lead");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].mode, "supervisor");
    });
  });
});
