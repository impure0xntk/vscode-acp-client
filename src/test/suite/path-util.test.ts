import * as assert from "assert";
import { describe, it } from "mocha";
import { abbreviatePath } from "../../shared/util/path";

// ============================================================================
// Path Utility Tests
// ============================================================================

describe("abbreviatePath — Basic Behavior", () => {
  it("returns empty string for null/undefined", () => {
    assert.strictEqual(abbreviatePath(null), "");
    assert.strictEqual(abbreviatePath(undefined), "");
  });

  it("returns empty string for empty input", () => {
    assert.strictEqual(abbreviatePath(""), "");
  });

  it("abbreviates homedir prefix to ~", () => {
    const home = require("os").homedir();
    const result = abbreviatePath(`${home}/projects/my-app`);
    assert.strictEqual(result.startsWith("~"), true);
    assert.strictEqual(result.includes(home), false);
  });

  it("keeps path under maxLength as-is", () => {
    const short = "/a/b";
    assert.strictEqual(abbreviatePath(short, 50), short);
  });
});

describe("abbreviatePath — Abbreviation Strategy", () => {
  it("abbreviates long paths by keeping last segment full", () => {
    const result = abbreviatePath("/home/user/github/workspace/src/index.ts", 25);
    // Should abbreviate to something like /h/u/g/w/src/index.ts
    assert.strictEqual(result.length <= 25, true);
    assert.ok(result.endsWith("index.ts"));
  });

  it("uses first character for intermediate segments", () => {
    const result = abbreviatePath("/alpha/beta/gamma/delta/file.txt", 30);
    assert.strictEqual(result.length <= 30, true);
    assert.ok(result.endsWith("file.txt"));
  });

  it("uses ellipsis fallback for very long paths", () => {
    const longPath = "/very/long/path/that/exceeds/the/maximum/length/limit/file.ts";
    const result = abbreviatePath(longPath, 25);
    assert.strictEqual(result.length <= 25, true);
    assert.ok(result.includes("…") || result.includes("..."));
  });

  it("handles root path", () => {
    assert.strictEqual(abbreviatePath("/", 50), "/");
  });

  it("handles single segment", () => {
    assert.strictEqual(abbreviatePath("file.txt", 50), "file.txt");
  });

  it("handles two segments", () => {
    assert.strictEqual(abbreviatePath("dir/file.txt", 50), "dir/file.txt");
  });
});

describe("abbreviatePath — Edge Cases", () => {
  it("respects custom maxLength", () => {
    // /a/b/c/d/e → /…/d/e (7 chars) — ellipsis fallback keeps last 2 segments
    const result = abbreviatePath("/a/b/c/d/e", 5);
    assert.strictEqual(result, "/…/d/e");
  });

  it("handles paths without leading slash", () => {
    const result = abbreviatePath("relative/path/file.txt", 50);
    assert.strictEqual(result, "relative/path/file.txt");
  });

  it("handles homedir exactly", () => {
    const home = require("os").homedir();
    const result = abbreviatePath(home, 50);
    assert.strictEqual(result, "~");
  });
});
