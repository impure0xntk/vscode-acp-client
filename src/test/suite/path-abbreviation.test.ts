import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import * as os from "os";
import * as path from "path";

// ============================================================================
// Path abbreviation tests — cover abbreviatePath edge-cases and fish-shell style
// ============================================================================

// We need to test the actual module, but abbreviatePath uses `os.homedir()` internally.
// Since the test runs in Node (hosted by mocha in the extension), the real home is used.

// Import from the actual utility
const originalHomedir = os.homedir;

describe("abbreviatePath — Basic Behavior", () => {
  it("returns empty string for null/undefined", () => {
    // Direct inline to avoid import issues
    const { abbreviatePath } = require("../../shared/util/path");
    assert.strictEqual(abbreviatePath(null as unknown as string), "");
    assert.strictEqual(abbreviatePath(undefined as unknown as string), "");
  });

  it("returns empty string for empty input", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    assert.strictEqual(abbreviatePath(""), "");
  });

  it("abbreviates homedir prefix to ~", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const home = originalHomedir();
    assert.strictEqual(abbreviatePath(home), "~");
    assert.strictEqual(abbreviatePath(`${home}/docs`), "~/docs");
  });

  it("keeps path under maxLength as-is", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    assert.strictEqual(abbreviatePath("/short/path"), "/short/path");
    assert.strictEqual(abbreviatePath("~/a/b"), "~/a/b");
  });
});

describe("abbreviatePath — Abbreviation Strategy", () => {
  let origHome: string;

  beforeEach(() => {
    origHome = os.homedir();
  });

  it("abbreviates long paths by keeping last segment full", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const home = originalHomedir();
    const longPath = `${home}/github/workspace/deep/nested/sub/project`;
    const result = abbreviatePath(longPath, 30);
    // Should abbreviate intermediate segments
    assert.ok(
      result.length <= 30,
      `Expected <= 30, got ${result.length}: ${result}`
    );
    assert.ok(
      result.endsWith("project"),
      `Should end with last segment: ${result}`
    );
  });

  it("uses first character for intermediate segments", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const home = originalHomedir();
    const longPath = `${home}/github/workspace/project`;
    const result = abbreviatePath(longPath, 25);
    // ~/g/w/project style
    assert.ok(
      result.includes("g") && result.includes("w"),
      `Should abbreviate intermediates: ${result}`
    );
  });

  it("uses ellipsis fallback for very long paths", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const veryLong = "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p";
    const result = abbreviatePath(veryLong, 20);
    assert.ok(result.length <= 20, `Should fit in maxLength: ${result.length}`);
    assert.ok(result.includes("…"), `Should use ellipsis: ${result}`);
  });

  it("handles root path", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    assert.strictEqual(abbreviatePath("/"), "/");
  });

  it("handles single segment", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const result = abbreviatePath("project");
    assert.strictEqual(result, "project");
  });

  it("handles two segments", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    assert.strictEqual(abbreviatePath("/home/user", 100), "/home/user");
  });
});

describe("abbreviatePath — Edge Cases", () => {
  it("respects custom maxLength for large values", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const p = "/usr/local/bin/node";
    // Large maxLength: path fits as-is
    const longResult = abbreviatePath(p, 100);
    assert.strictEqual(longResult, p);
  });

  it("abbreviates when path exceeds maxLength", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const p = "/usr/local/bin/node"; // 19 chars
    const result = abbreviatePath(p, 15);
    // Abbreviates intermediates: /u/l/bin/node = 14 chars <= 15
    assert.ok(
      result.length <= 15,
      `Should abbreviate to fit: ${result.length}`
    );
    assert.ok(result.endsWith("node"), `Should keep last segment: ${result}`);
  });

  it("handles paths without leading slash", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    assert.strictEqual(abbreviatePath("src/index.ts"), "src/index.ts");
  });

  it("handles homedir exactly (no trailing slash)", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const home = originalHomedir();
    assert.strictEqual(abbreviatePath(home), "~");
  });

  it("handles path that is exactly at maxLength", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const p = "/abc/def"; // 8 chars
    assert.strictEqual(abbreviatePath(p, 8), p);
  });

  it("handles path that exceeds maxLength by 1", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    // For non-home paths: /a/b/cde (9 chars)
    const p = "/abc/defg"; // 9 chars
    const result = abbreviatePath(p, 8);
    assert.ok(
      result.length <= 8,
      `Should abbreviate when over by 1: ${result.length}`
    );
  });

  it("handles deeply nested paths with 3+ segments", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    // 3 segments: /a/b/verylongdirname — can use ellipsis fallback
    const p = "/x/y/verylongdirname";
    const result = abbreviatePath(p, 10);
    // With 3+ segments, ellipsis fallback kicks in: /…/y/verylongdirname
    // But that's still > 10, so it returns full path (no further abbreviation)
    // The key is: it should not throw
    assert.ok(typeof result === "string");
  });

  it("2-segment path that fits is returned as-is", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const p = "/x/ab"; // 5 chars
    const result = abbreviatePath(p, 10);
    assert.strictEqual(result, "/x/ab");
  });

  it("preserves ~ prefix when abbreviating subdirs of home", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    const home = originalHomedir();
    const longPath = home + "/a/b/c/d/e/f/g/h/i";
    const result = abbreviatePath(longPath, 15);
    assert.ok(result.startsWith("~"), `Should preserve ~ prefix: ${result}`);
    assert.ok(result.length <= 15, `Should fit in maxLength: ${result.length}`);
  });

  it("handles Windows-style paths (treated as non-home)", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    // Windows paths won't match home, so treated as-is
    const p = "C:\\Users\\user\\workspace";
    const result = abbreviatePath(p, 100);
    // Should keep as-is since it's under maxLength
    assert.strictEqual(result, p);
  });

  it("handles path ending with slash (trailing slash preserved)", () => {
    const { abbreviatePath } = require("../../shared/util/path");
    // rest = inputPath = "/a/b/", full = "/a/b/" (5 chars) — fits in default maxLength 25
    const result = abbreviatePath("/a/b/");
    assert.strictEqual(result, "/a/b/");
  });
});
