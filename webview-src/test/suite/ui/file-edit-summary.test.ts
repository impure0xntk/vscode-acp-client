import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import {
  countWrittenLines,
  extractFileEditSummaryFromStore,
} from "../../../pipeline/stages/grouping";

describe("grouping — file edit summary", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {} });
  });

  // ── countWrittenLines ─────────────────────────────────────────────

  describe("countWrittenLines", () => {
    it("returns 0 for empty string", () => {
      assert.strictEqual(countWrittenLines(""), 0);
    });

    it("counts single line without trailing newline", () => {
      assert.strictEqual(countWrittenLines("hello"), 1);
    });

    it("counts single line with trailing newline", () => {
      assert.strictEqual(countWrittenLines("hello\n"), 1);
    });

    it("counts multiple lines without trailing newline", () => {
      assert.strictEqual(countWrittenLines("a\nb\nc"), 3);
    });

    it("counts multiple lines with trailing newline", () => {
      assert.strictEqual(countWrittenLines("a\nb\nc\n"), 3);
    });

    it("counts two lines", () => {
      assert.strictEqual(countWrittenLines("line1\nline2"), 2);
    });

    it("counts only-newlines content", () => {
      assert.strictEqual(countWrittenLines("\n\n\n"), 3);
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

    it("merges multiple writes to the same path", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/foo.ts", "line1\nline2");
      store.addWrite("a1", "s1", "/foo.ts", "line3");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].path, "/foo.ts");
      assert.strictEqual(result[0].lineCount, 3); // 2 + 1
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

    it("handles mixed: some paths same, some different", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "line1");
      store.addWrite("a1", "s1", "/b.ts", "line1\nline2\nline3");
      store.addWrite("a1", "s1", "/a.ts", "line2\nline3");
      const result = extractFileEditSummaryFromStore("a1", "s1");
      assert.ok(result);
      assert.strictEqual(result.length, 2);
      // /a.ts appears first in insertion order
      const aEntry = result.find((e) => e.path === "/a.ts")!;
      const bEntry = result.find((e) => e.path === "/b.ts")!;
      assert.strictEqual(aEntry.lineCount, 3); // 1 + 2
      assert.strictEqual(bEntry.lineCount, 3);
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
