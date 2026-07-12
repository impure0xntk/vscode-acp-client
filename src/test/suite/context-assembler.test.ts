import * as assert from "assert";
import { describe, it } from "mocha";
import {
  estimateTokens,
  resolveFile,
  resolveProblem,
} from "../../adapter/context/assembler";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { DiagnosticProblem } from "../../platform/editor";

function makeFs(): { fs: FileSystemAPI; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    fs: {
      readFile: async (p: string) => {
        reads.push(p);
        return `content of ${p}`;
      },
      workspaceRoot: "/ws",
      workspaceRoots: ["/ws"],
      stat: async () => ({ type: "file" as const, size: 0, mtime: 0, ctime: 0 }),
      writeFile: async () => {},
      deleteFile: async () => {},
      readDir: async () => [],
      exists: async () => true,
      createDir: async () => {},
      copyFile: async () => {},
      renameFile: async () => {},
      watch: () => ({ dispose: () => {} }),
    } as unknown as FileSystemAPI,
  };
}

// ============================================================================
// Context Assembler Tests
// ============================================================================

describe("estimateTokens — Basic", () => {
  it("returns 1 for short text", () => {
    assert.strictEqual(estimateTokens("hi"), 1);
  });

  it("returns ceil(length / 4)", () => {
    assert.strictEqual(estimateTokens("abcd"), 1); // 4/4 = 1
    assert.strictEqual(estimateTokens("abcde"), 2); // 5/4 = 1.25 -> 2
    assert.strictEqual(estimateTokens("abcdefgh"), 2); // 8/4 = 2
  });

  it("returns 1 for empty string", () => {
    assert.strictEqual(estimateTokens(""), 0);
  });

  it("handles large text", () => {
    const text = "a".repeat(4000);
    assert.strictEqual(estimateTokens(text), 1000);
  });
});

// ============================================================================
// resolveFile — path handling
// ============================================================================
// Contract relied on by the `acp.attachFile` command: it passes the absolute
// fsPath selected from the VS Code picker straight through, so resolveFile must
// open that exact path and must NOT re-join it against cwd. Regression guard
// for the ENOENT bug where a workspace-relative path was joined against a
// different session cwd.

describe("resolveFile — path handling", () => {
  it("reads an absolute path directly, ignoring cwd", async () => {
    const { fs, reads } = makeFs();
    const abs = "/some/other/dir/file.ts";
    const attachment = await resolveFile(fs, abs, "/ws/different/cwd");
    assert.deepStrictEqual(reads, [abs]);
    assert.strictEqual(attachment.path, abs);
    assert.strictEqual(attachment.label, "file.ts");
  });

  it("joins a relative path against cwd when no absolute path given", async () => {
    const { fs, reads } = makeFs();
    const attachment = await resolveFile(fs, "src/index.ts", "/ws/proj");
    assert.deepStrictEqual(reads, ["/ws/proj/src/index.ts"]);
    assert.strictEqual(attachment.path, "src/index.ts");
  });

  it("falls back to workspaceRoot for a relative path when cwd omitted", async () => {
    const { fs, reads } = makeFs();
    await resolveFile(fs, "a.txt");
    assert.deepStrictEqual(reads, ["/ws/a.txt"]);
  });
});

// ============================================================================
// resolveProblem — single diagnostic → `problem` attachment
// ============================================================================
// Contract relied on by the `acp.attachProblem` command (Problems panel
// right-click → "Attach Problem to Chat"): the diagnostic is attached as a
// `problem`-type Composer attachment, distinct from a `selection`, carrying
// its message, file:line:col, source + code, and the `message` summary used
// by the chip label.

describe("resolveProblem — single diagnostic", () => {
  const problem: DiagnosticProblem = {
    filePath: "/ws/src/app.ts",
    startLine: 42,
    startColumn: 10,
    endLine: 42,
    endColumn: 24,
    severity: "error",
    message: "Property 'x' does not exist on type 'App'.",
    source: "tsc",
    code: "2339",
  };

  it("returns a `problem`-type attachment with file:line label", async () => {
    const { fs } = makeFs();
    const attachment = await resolveProblem(fs, problem);
    assert.ok(attachment);
    assert.strictEqual(attachment!.type, "problem");
    assert.strictEqual(attachment!.path, "/ws/src/app.ts");
    assert.strictEqual(attachment!.label, "app.ts:42");
    assert.deepStrictEqual(attachment!.lineRange, [42, 42]);
    assert.strictEqual(attachment!.message, problem.message);
  });

  it("embeds the message and file:line:col reference in content", async () => {
    const { fs } = makeFs();
    const attachment = await resolveProblem(fs, problem);
    assert.ok(attachment);
    assert.match(attachment!.content, /app\.ts:42:10/);
    assert.match(attachment!.content, /\[ERROR\] tsc \(2339\)/);
    assert.match(attachment!.content, /Property 'x' does not exist/);
  });
});
