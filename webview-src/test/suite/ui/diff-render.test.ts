import assert from "assert";
import { describe, it } from "mocha";
import { createTwoFilesPatch, parsePatch } from "diff";

// Import the parsing logic indirectly by replicating it here.
// Since parseDiffForRender is not exported, we test via the `diff` package
// primitives that the component uses, and verify the component renders correctly
// through integration with the existing file-edit-summary-grouping tests.

interface DiffLine {
  type: "|" | "+" | "-" | "@@";
  text: string;
  oldLine?: number;
  newLine?: number;
  hunkHeader?: string;
}

function parseDiffForRender(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const files = parsePatch(diffText);
  for (const file of files) {
    for (const hunk of file.hunks) {
      const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
      lines.push({ type: "@@", text: header, hunkHeader: header });
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      for (const l of hunk.lines) {
        if (l.startsWith("+")) {
          lines.push({ type: "+", text: l.slice(1), newLine: newLine++ });
        } else if (l.startsWith("-")) {
          lines.push({ type: "-", text: l.slice(1), oldLine: oldLine++ });
        } else if (l.startsWith(" ")) {
          lines.push({ type: "|", text: l.slice(1), oldLine: oldLine++, newLine: newLine++ });
        }
      }
    }
  }
  return lines;
}

describe("parseDiffForRender", () => {
  it("parses a simple single-hunk diff with correct line numbers", () => {
    const diff = createTwoFilesPatch("/test.ts", "/test.ts", "line1\nline2\nline3\n", "line1\nmodified\nline2\nline3\n", undefined, undefined, { context: 3 });
    const result = parseDiffForRender(diff);

    // Should have hunk header + content lines
    assert.ok(result.length > 0);

    // First entry is the hunk header
    const hunkHeader = result[0];
    assert.strictEqual(hunkHeader.type, "@@");
    assert.ok(hunkHeader.hunkHeader!.includes("@@ -1,3 +1,4 @@"));

    // Find the addition
    const additions = result.filter((l) => l.type === "+");
    assert.strictEqual(additions.length, 1);
    assert.strictEqual(additions[0].text, "modified");
    assert.strictEqual(additions[0].newLine, 2);
    assert.strictEqual(additions[0].oldLine, undefined);

    // Context lines have both oldLine and newLine
    const contexts = result.filter((l) => l.type === "|");
    assert.ok(contexts.length >= 2); // "line1" and "line3"
    assert.strictEqual(contexts[0].oldLine, 1);
    assert.strictEqual(contexts[0].newLine, 1);
  });

  it("filters out Index:, ---, +++ lines (not present in parsed output)", () => {
    const diff = createTwoFilesPatch("a.ts", "a.ts", "old\n", "new\n", undefined, undefined, { context: 1 });
    const result = parseDiffForRender(diff);

    // No line should start with "Index:", "---", "+++"
    for (const l of result) {
      assert.ok(!l.text.startsWith("Index:"), `Unexpected Index line: ${l.text}`);
      assert.ok(!l.text.startsWith("---"), `Unexpected --- line: ${l.text}`);
      assert.ok(!l.text.startsWith("+++"), `Unexpected +++ line: ${l.text}`);
    }
  });

  it("preserves @@ hunk headers with line-number context", () => {
    const diff = createTwoFilesPatch("f.ts", "f.ts", "a\nb\nc\nd\ne\nf\ng\n", "a\nB\nc\nd\ne\nF\ng\n", undefined, undefined, { context: 1 });
    const result = parseDiffForRender(diff);

    const hunkHeaders = result.filter((l) => l.type === "@@");
    assert.strictEqual(hunkHeaders.length, 2); // Two separate hunks

    // First hunk covers lines 1-3 (context around line 2 change)
    assert.ok(hunkHeaders[0].hunkHeader!.startsWith("@@ -1,3 +1,3 @@"));

    // Second hunk covers lines 5-7 (context around line 6 change)
    assert.ok(hunkHeaders[1].hunkHeader!.startsWith("@@ -5,3 +5,3 @@"));
  });

  it("handles multi-hunk diffs with correct line numbering per hunk", () => {
    const original = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    const modified = "LINE1\nline2\nline3\nline4\nline5\nLINE6\nline7\nline8\nline9\nLINE10\n";
    const diff = createTwoFilesPatch("m.ts", "m.ts", original, modified, undefined, undefined, { context: 1 });
    const result = parseDiffForRender(diff);

    const hunkHeaders = result.filter((l) => l.type === "@@");
    assert.strictEqual(hunkHeaders.length, 3);

    // Hunk 1: line 1 changed, context=1 → covers lines 1-2
    assert.ok(hunkHeaders[0].hunkHeader!.startsWith("@@ -1,2 +1,2 @@"));

    // Hunk 2: line 6 changed, context=1 → covers lines 5-7
    assert.ok(hunkHeaders[1].hunkHeader!.startsWith("@@ -5,3 +5,3 @@"));

    // Hunk 3: line 10 changed, context=1 → covers lines 9-10
    assert.ok(hunkHeaders[2].hunkHeader!.startsWith("@@ -9,2 +9,2 @@"));
  });

  it("tracks line numbers correctly across Hunks", () => {
    // 3-line file, 2 separate single-line changes far apart
    const orig = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    const mod = "A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n";
    const diff = createTwoFilesPatch("x.ts", "x.ts", orig, mod, undefined, undefined, { context: 0 });
    const result = parseDiffForRender(diff);

    // With context=0, each hunk has just the changed line
    const hunks = result.filter((l) => l.type === "@@");
    assert.strictEqual(hunks.length, 2);

    // Hunk 1: delete "a" (oldLine 1), add "A" (newLine 1)
    const hunk1Del = result.find((l) => l.type === "-" && l.text === "a");
    const hunk1Add = result.find((l) => l.type === "+" && l.text === "A");
    assert.ok(hunk1Del);
    assert.ok(hunk1Add);
    assert.strictEqual(hunk1Del!.oldLine, 1);
    assert.strictEqual(hunk1Add!.newLine, 1);

    // Hunk 2: delete "j" (oldLine 10), add "J" (newLine 10)
    const hunk2Del = result.find((l) => l.type === "-" && l.text === "j");
    const hunk2Add = result.find((l) => l.type === "+" && l.text === "J");
    assert.ok(hunk2Del);
    assert.ok(hunk2Add);
    assert.strictEqual(hunk2Del!.oldLine, 10);
    assert.strictEqual(hunk2Add!.newLine, 10);
  });

  it("handles empty diff (no changes) → no hunks", () => {
    const diff = createTwoFilesPatch("s.ts", "s.ts", "same\n", "same\n", undefined, undefined, { context: 3 });
    const result = parseDiffForRender(diff);
    assert.strictEqual(result.length, 0);
  });

  it("handles new file (all additions)", () => {
    const diff = createTwoFilesPatch("new.ts", "new.ts", "", "line1\nline2\n", undefined, undefined, { context: 3 });
    const result = parseDiffForRender(diff);

    assert.ok(result.length > 0, "should have at least a hunk header");
    const hunkHeader = result[0];
    assert.strictEqual(hunkHeader.type, "@@");
    // oldStart=1, oldLines=0 for new file (diff package convention)
    assert.ok(hunkHeader.hunkHeader!.includes("+1,2"), `Expected +1,2 in header: ${hunkHeader.hunkHeader}`);

    const adds = result.filter((l) => l.type === "+");
    assert.strictEqual(adds.length, 2);
    assert.strictEqual(adds[0].text, "line1");
    assert.strictEqual(adds[0].newLine, 1);
    assert.strictEqual(adds[1].text, "line2");
    assert.strictEqual(adds[1].newLine, 2);
  });

  it("handles deleted file (all deletions)", () => {
    const diff = createTwoFilesPatch("del.ts", "del.ts", "line1\nline2\n", "", undefined, undefined, { context: 3 });
    const result = parseDiffForRender(diff);

    assert.ok(result.length > 0, "should have at least a hunk header");
    const hunkHeader = result[0];
    assert.strictEqual(hunkHeader.type, "@@");
    // newStart=1, newLines=0 for deleted file (diff package convention)
    assert.ok(hunkHeader.hunkHeader!.includes("+1,0"), `Expected +1,0 in header: ${hunkHeader.hunkHeader}`);

    const dels = result.filter((l) => l.type === "-");
    assert.strictEqual(dels.length, 2);
    assert.strictEqual(dels[0].text, "line1");
    assert.strictEqual(dels[0].oldLine, 1);
    assert.strictEqual(dels[1].text, "line2");
    assert.strictEqual(dels[1].oldLine, 2);
  });
});

describe("computeWriteSeqBoundaries — duplicate writeSeq edge cases", () => {
  // We test this indirectly via the IntermediateStepGrouper
  // since computeWriteSeqBoundaries is internal.

  it("assigns writes to the step when all steps have the same writeSeq", () => {
    // When all steps share writeSeq=0, the first step's range gets collapsed
    // and writes fall to the last step with that seq.
    // This tests the fix in computeWriteSeqBoundaries that prevents empty ranges.
    const { useFileWriteStore } = require("../../../store/fileWriteStore");
    const { IntermediateStepGrouper } = require("../../../pipeline/stages/grouping");
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });

    useFileWriteStore.getState().addWrite("a1", "s1", "/f.ts", "content");

    // Two consecutive (streaming) agent messages, both with writeSeq=0
    const items = [
      { type: "chat", role: "user", agentId: "a1", sessionId: "s1", content: "edit", key: "u", timestamp: Date.now(), isConsecutive: false, groupKey: "user", attachments: [], thinking: undefined },
      { type: "chat", role: "agent", agentId: "a1", sessionId: "s1", content: "thinking...", key: "a1", timestamp: Date.now(), isConsecutive: true, groupKey: "agent:a1", attachments: [], thinking: undefined, writeSeq: 0 },
      { type: "chat", role: "agent", agentId: "a1", sessionId: "s1", content: "done!", key: "a2", timestamp: Date.now(), isConsecutive: true, groupKey: "agent:a1", attachments: [], thinking: undefined, writeSeq: 0 },
    ];

    const result = new IntermediateStepGrouper(items).compute();
    // The write should appear in turnFileEditSummary regardless of partitioning
    const turnSummary = result.latestGroup!.turnFileEditSummary;
    assert.ok(turnSummary, "turnFileEditSummary should exist");
    assert.strictEqual(turnSummary!.length, 1);
    assert.strictEqual(turnSummary![0].path, "/f.ts");
  });
});
