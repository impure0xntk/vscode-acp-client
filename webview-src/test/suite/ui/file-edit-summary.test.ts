import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import {
  computeLineDiff,
  extractFileEditSummaryFromStore,
} from "../../../pipeline/stages/grouping";

/** Helper — count lines the old way so existing merge-behaviour tests still pass. */
function countWrittenLines(content: string): number {
  if (!content) return 0;
  const newlines = (content.match(/\n/g) ?? []).length;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

describe("grouping — file edit summary", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {} });
  });

  // ── computeLineDiff ──────────────────────────────────────────────

  describe("computeLineDiff", () => {
    it("returns 0/0 for identical content", () => {
      assert.deepStrictEqual(computeLineDiff("a\nb\nc", "a\nb\nc"), {
        added: 0,
        deleted: 0,
      });
    });

    it("returns 0/0 for both empty", () => {
      assert.deepStrictEqual(computeLineDiff("", ""), { added: 0, deleted: 0 });
    });

    it("counts additions when original is empty", () => {
      assert.deepStrictEqual(computeLineDiff(null, "line1\nline2"), {
        added: 2,
        deleted: 0,
      });
    });

    it("counts deletions when new is empty", () => {
      assert.deepStrictEqual(computeLineDiff("line1\nline2", null), {
        added: 0,
        deleted: 2,
      });
    });

    it("counts mixed additions and deletions", () => {
      // original: a b c  →  new: a x c  →  b deleted, x added
      const r = computeLineDiff("a\nb\nc", "a\nx\nc");
      assert.strictEqual(r.added, 1);
      assert.strictEqual(r.deleted, 1);
    });

    it("handles trailing newline correctly", () => {
      // "a\nb\nc\n" splits to ["a","b","c",""] ;  "a\nb\nc" splits to ["a","b","c"]
      // LCS = ["a","b","c"] → added=0, deleted=1 (the trailing "")
      const r = computeLineDiff("a\nb\nc\n", "a\nb\nc");
      assert.strictEqual(r.added, 0);
      assert.strictEqual(r.deleted, 1);
    });
  });

  // ── extractFileEditSummaryFromStore ───────────────────────────────

  describe("extractFileEditSummaryFromStore", () => {
    it("returns undefined when no writes exist", () => {
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.strictEqual(result, undefined);
    });

    it("returns single entry for one write", () => {
      useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "hello");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].path, "/foo.ts");
      assert.strictEqual(result[0].lineCount, 1);
      assert.strictEqual(result[0].kind, "fs/write_text_file");
    });

    it("merges multiple writes to the same path (latest content used for diff)", () => {
      // Original content is null (file did not exist before first write).
      // Only the latest write is diff'd against original: "line3" → 1 added line.
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/foo.ts", "line1\nline2");
      store.addWrite("a1", "s1", "/foo.ts", "line3");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].path, "/foo.ts");
      // New behavior: latest written vs original (null) = 1 line added
      assert.strictEqual(result[0].lineCount, 1);
      assert.strictEqual(result[0].deletedLines, 0);
    });

    it("merges multiple writes with known original content", () => {
      // Original content provided → diff from that to latest "line3"
      // original: "old1\nold2" → new: "line3" → 2 deleted, 1 added
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/foo.ts", "line1\nline2", "old1\nold2");
      store.addWrite("a1", "s1", "/foo.ts", "line3");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].path, "/foo.ts");
      assert.strictEqual(result[0].lineCount, 1);
      assert.strictEqual(result[0].deletedLines, 2);
    });

    it("returns separate entries for different paths", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "aaa");
      store.addWrite("a1", "s1", "/b.ts", "bbb\nbbb");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 2);
      // Order follows insertion order (Map preserves insertion)
      assert.strictEqual(result[0].path, "/a.ts");
      assert.strictEqual(result[0].lineCount, 1);
      assert.strictEqual(result[1].path, "/b.ts");
      assert.strictEqual(result[1].lineCount, 2);
    });

    it("handles mixed: some paths same, some different (diff-based)", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "line1"); // original=null → "line1" = 1 added
      store.addWrite("a1", "s1", "/b.ts", "line1\nline2\nline3"); // original=null → 3 added
      store.addWrite("a1", "s1", "/a.ts", "line2\nline3"); // overrides latest for /a.ts
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 2);
      const aEntry = result.find((e) => e.path === "/a.ts")!;
      const bEntry = result.find((e) => e.path === "/b.ts")!;
      // /a.ts: original=null, latest="line2\nline3" → 2 added, 0 deleted
      assert.strictEqual(aEntry.lineCount, 2);
      assert.strictEqual(aEntry.deletedLines, 0);
      // /b.ts: original=null, latest="line1\nline2\nline3" → 3 added
      assert.strictEqual(bEntry.lineCount, 3);
      assert.strictEqual(bEntry.deletedLines, 0);
    });

    it("ignores writes from other sessions", () => {
      useFileWriteStore.getState().addWrite("a1", "s2", "/other.ts", "x");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.strictEqual(result, undefined);
    });

    it("computes line count correctly for trailing newline content", () => {
      useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "a\nb\nc\n");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result[0].lineCount, 3);
    });

    it("returns empty content with 0 lines", () => {
      useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].lineCount, 0);
    });
  });
});
