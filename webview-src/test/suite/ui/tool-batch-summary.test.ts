import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure functions from toolBatchSummary ────────────────────────────────────

interface KindSummaryItem {
  kind: string;
  icon: string;
  abbr: string;
  count: number;
  known: boolean;
}

const KNOWN_KINDS = new Set([
  "read",
  "write",
  "edit",
  "delete",
  "bash",
  "shell",
  "search",
  "grep",
  "list",
  "fetch",
  "web_search",
  "web_fetch",
  "apply_patch",
  "todo",
  "task",
  "mcp",
  "tool_call",
]);

const KIND_ABBR: Record<string, string> = {
  read: "R",
  write: "W",
  edit: "E",
  delete: "D",
  bash: "B",
  shell: "B",
  search: "S",
  grep: "G",
  list: "L",
  fetch: "F",
  web_search: "S",
  web_fetch: "F",
  apply_patch: "P",
  todo: "T",
  task: "K",
  mcp: "M",
  tool_call: "T",
};

function kindAbbr(kind: string | undefined): string {
  const k = (kind ?? "").toLowerCase().trim();
  if (!k) return "T";
  return KIND_ABBR[k] ?? k.charAt(0).toUpperCase();
}

function summarizeKinds(kindCounts: Record<string, number>): KindSummaryItem[] {
  const entries = Object.entries(kindCounts).map(([kind, count]) => {
    const k = kind.toLowerCase().trim();
    const known = KNOWN_KINDS.has(k);
    const abbr = kindAbbr(k);
    return { kind, icon: "", abbr, count, known };
  });

  const known = entries
    .filter((e) => e.known)
    .sort((a, b) => b.count - a.count);
  const fallback = entries
    .filter((e) => !e.known)
    .sort((a, b) => b.count - a.count);

  return [...known, ...fallback];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("kindAbbr", () => {
  it("returns known abbreviation for read", () => {
    assert.strictEqual(kindAbbr("read"), "R");
  });

  it("returns known abbreviation for write", () => {
    assert.strictEqual(kindAbbr("write"), "W");
  });

  it("returns known abbreviation for edit", () => {
    assert.strictEqual(kindAbbr("edit"), "E");
  });

  it("returns known abbreviation for bash", () => {
    assert.strictEqual(kindAbbr("bash"), "B");
  });

  it("returns known abbreviation for search", () => {
    assert.strictEqual(kindAbbr("search"), "S");
  });

  it("returns known abbreviation for grep", () => {
    assert.strictEqual(kindAbbr("grep"), "G");
  });

  it("returns known abbreviation for apply_patch", () => {
    assert.strictEqual(kindAbbr("apply_patch"), "P");
  });

  it("returns known abbreviation for mcp", () => {
    assert.strictEqual(kindAbbr("mcp"), "M");
  });

  it("returns first char uppercase for unknown kind", () => {
    assert.strictEqual(kindAbbr("custom_tool"), "C");
    assert.strictEqual(kindAbbr("xyz"), "X");
  });

  it("returns 'T' for empty string", () => {
    assert.strictEqual(kindAbbr(""), "T");
  });

  it("returns 'T' for undefined", () => {
    assert.strictEqual(kindAbbr(undefined), "T");
  });

  it("handles case insensitivity for known kinds", () => {
    assert.strictEqual(kindAbbr("READ"), "R");
    assert.strictEqual(kindAbbr("Bash"), "B");
  });

  it("handles whitespace trimming", () => {
    assert.strictEqual(kindAbbr("  read  "), "R");
  });
});

describe("summarizeKinds", () => {
  it("returns empty array for empty input", () => {
    const result = summarizeKinds({});
    assert.deepStrictEqual(result, []);
  });

  it("sorts known kinds by descending count", () => {
    const result = summarizeKinds({ read: 5, write: 10, edit: 3 });
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].kind, "write");
    assert.strictEqual(result[0].count, 10);
    assert.strictEqual(result[1].kind, "read");
    assert.strictEqual(result[1].count, 5);
    assert.strictEqual(result[2].kind, "edit");
    assert.strictEqual(result[2].count, 3);
  });

  it("places known kinds before unknown kinds", () => {
    const result = summarizeKinds({ custom_tool: 100, read: 1 });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].kind, "read");
    assert.strictEqual(result[0].known, true);
    assert.strictEqual(result[1].kind, "custom_tool");
    assert.strictEqual(result[1].known, false);
  });

  it("sorts unknown kinds by descending count", () => {
    const result = summarizeKinds({ zebra: 5, alpha: 10 });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].kind, "alpha");
    assert.strictEqual(result[0].count, 10);
    assert.strictEqual(result[1].kind, "zebra");
    assert.strictEqual(result[1].count, 5);
  });

  it("includes all required fields in summary items", () => {
    const result = summarizeKinds({ read: 3 });
    assert.strictEqual(result.length, 1);
    const item = result[0];
    assert.strictEqual(item.kind, "read");
    assert.strictEqual(item.abbr, "R");
    assert.strictEqual(item.count, 3);
    assert.strictEqual(item.known, true);
  });

  it("handles single unknown kind", () => {
    const result = summarizeKinds({ mytool: 7 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].kind, "mytool");
    assert.strictEqual(result[0].count, 7);
    assert.strictEqual(result[0].known, false);
    assert.strictEqual(result[0].abbr, "M");
  });

  it("handles mix of known and unknown with same counts", () => {
    const result = summarizeKinds({ read: 5, unknown_a: 5, write: 5 });
    const knownItems = result.filter((r) => r.known);
    const unknownItems = result.filter((r) => !r.known);
    assert.strictEqual(knownItems.length, 2);
    assert.strictEqual(unknownItems.length, 1);
    const knownIndices = knownItems.map((r) => result.indexOf(r));
    const unknownIndices = unknownItems.map((r) => result.indexOf(r));
    assert.ok(Math.max(...knownIndices) < Math.min(...unknownIndices));
  });
});
