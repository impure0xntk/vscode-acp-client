import * as assert from "assert";
import { describe, it } from "mocha";

// ============================================================================
// Path abbreviation tests — cover abbreviatePath edge-cases and fish-shell style
// ============================================================================

const { abbreviatePath } = require("../../shared/util/path");

describe("abbreviatePath — Basic Behavior", () => {
  it("returns empty string for null/undefined", () => {
    assert.strictEqual(abbreviatePath(null as unknown as string), "");
    assert.strictEqual(abbreviatePath(undefined as unknown as string), "");
  });

  it("returns empty string for empty input", () => {
    assert.strictEqual(abbreviatePath(""), "");
  });

  it("keeps path under maxLength as-is", () => {
    assert.strictEqual(abbreviatePath("/short/path"), "/short/path");
  });

  it("returns root path", () => {
    assert.strictEqual(abbreviatePath("/"), "/");
  });
});

describe("abbreviatePath — Abbreviation Strategy", () => {
  it("abbreviates long paths by keeping last segment full", () => {
    const longPath = "/home/user/github/workspace/deep/nested/sub/project";
    const result = abbreviatePath(longPath, 30);
    assert.ok(
      result.length <= 30,
      `Expected <= 30, got ${result.length}: ${result}`,
    );
    assert.ok(
      result.endsWith("project"),
      `Should end with last segment: ${result}`,
    );
  });

  it("uses first character for intermediate segments", () => {
    const longPath = "/home/user/github/workspace/project";
    const result = abbreviatePath(longPath, 30);
    assert.ok(
      result.includes("h") && result.includes("u") && result.includes("g"),
      `Should abbreviate intermediates: ${result}`,
    );
  });

  it("uses ellipsis fallback for very long paths", () => {
    const veryLong = "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p";
    const result = abbreviatePath(veryLong, 20);
    assert.ok(result.length <= 20, `Should fit in maxLength: ${result.length}`);
    assert.ok(result.includes("…"), `Should use ellipsis: ${result}`);
  });

  it("handles single segment", () => {
    assert.strictEqual(abbreviatePath("project"), "project");
  });

  it("handles two segments", () => {
    assert.strictEqual(abbreviatePath("/home/user", 100), "/home/user");
  });
});

describe("abbreviatePath — Edge Cases", () => {
  it("respects custom maxLength for large values", () => {
    const p = "/usr/local/bin/node";
    assert.strictEqual(abbreviatePath(p, 100), p);
  });

  it("abbreviates when path exceeds maxLength", () => {
    const p = "/usr/local/bin/node"; // 19 chars
    const result = abbreviatePath(p, 15);
    assert.ok(
      result.length <= 15,
      `Should abbreviate to fit: ${result.length}`,
    );
    assert.ok(result.endsWith("node"), `Should keep last segment: ${result}`);
  });

  it("handles paths without leading slash", () => {
    assert.strictEqual(abbreviatePath("src/index.ts"), "src/index.ts");
  });

  it("handles path that is exactly at maxLength", () => {
    const p = "/abc/def"; // 8 chars
    assert.strictEqual(abbreviatePath(p, 8), p);
  });

  it("handles path that exceeds maxLength by 1", () => {
    const p = "/abc/defg"; // 9 chars
    const result = abbreviatePath(p, 8);
    assert.ok(
      result.length <= 8,
      `Should abbreviate when over by 1: ${result.length}`,
    );
  });

  it("handles deeply nested paths with 3+ segments", () => {
    const p = "/x/y/verylongdirname";
    const result = abbreviatePath(p, 10);
    assert.ok(typeof result === "string");
    assert.ok(result.length <= 10);
  });

  it("2-segment path that fits is returned as-is", () => {
    const p = "/x/ab"; // 5 chars
    assert.strictEqual(abbreviatePath(p, 10), "/x/ab");
  });

  it("handles Windows-style paths", () => {
    const p = "C:\\Users\\user\\workspace";
    const result = abbreviatePath(p, 100);
    assert.strictEqual(result, p);
  });

  it("handles path ending with slash", () => {
    // trailing slash produces an extra empty segment after split
    const result = abbreviatePath("/a/b/");
    assert.strictEqual(result, "/a/b/");
  });

  it("does not crash in browser / webview (no process.env)", () => {
    // Regression: previously used process.env.HOME which throws
    // ReferenceError in webview.  Confirm the function works with
    // zero arguments beyond the path itself.
    assert.strictEqual(abbreviatePath(""), "");
    assert.ok(abbreviatePath("/a/b/c").length > 0);
  });
});
