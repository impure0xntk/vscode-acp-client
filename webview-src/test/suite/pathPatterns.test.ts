import * as assert from "assert";
import { describe, it } from "mocha";
import { extractCandidatePaths } from "../../lib/pathPatterns";

// ── extractCandidatePaths ───────────────────────────────────────────────────

describe("extractCandidatePaths", () => {
  // ── Absolute paths ──────────────────────────────────────────────────────

  it("extracts absolute Unix paths", () => {
    const result = extractCandidatePaths("see /src/index.ts for details");
    assert.deepStrictEqual(result, ["/src/index.ts"]);
  });

  it("extracts nested absolute paths", () => {
    const result = extractCandidatePaths(
      "check /home/user/project/src/main.ts"
    );
    assert.deepStrictEqual(result, ["/home/user/project/src/main.ts"]);
  });

  it("extracts multiple paths from text", () => {
    const result = extractCandidatePaths("edit /a.ts and /b.ts");
    assert.deepStrictEqual(result, ["/a.ts", "/b.ts"]);
  });

  it("extracts absolute paths without extension", () => {
    const result = extractCandidatePaths("check /src/index or /Makefile");
    assert.deepStrictEqual(result, ["/src/index", "/Makefile"]);
  });

  // ── Relative paths ──────────────────────────────────────────────────────

  it("extracts relative paths with ./ prefix", () => {
    const result = extractCandidatePaths("see ./src/index.ts");
    assert.deepStrictEqual(result, ["./src/index.ts"]);
  });

  it("extracts relative paths with ../ prefix", () => {
    const result = extractCandidatePaths("import from ../lib/utils.ts");
    assert.deepStrictEqual(result, ["../lib/utils.ts"]);
  });

  it("extracts relative paths with directory/file pattern", () => {
    const result = extractCandidatePaths("check src/index.ts here");
    assert.deepStrictEqual(result, ["src/index.ts"]);
  });

  it("extracts paths with ~ prefix", () => {
    const result = extractCandidatePaths("see ~/projects/app.ts");
    assert.deepStrictEqual(result, ["~/projects/app.ts"]);
  });

  // ── Dotfiles ────────────────────────────────────────────────────────────

  it("extracts dotfiles like .gitignore", () => {
    const result = extractCandidatePaths("edit .gitignore and .env.local");
    assert.deepStrictEqual(result, [".gitignore", ".env.local"]);
  });

  it("extracts dotfiles without extension", () => {
    const result = extractCandidatePaths("see .prettierrc here");
    assert.deepStrictEqual(result, [".prettierrc"]);
  });

  it("extracts dot-directories in paths", () => {
    const result = extractCandidatePaths("check .github/workflows/ci.yml");
    assert.deepStrictEqual(result, [".github/workflows/ci.yml"]);
  });

  it("does not extract . or .. alone", () => {
    const result = extractCandidatePaths("see . and .. here");
    assert.deepStrictEqual(result, []);
  });

  // ── Extensionless files ─────────────────────────────────────────────────

  it("extracts known extensionless filenames", () => {
    const result = extractCandidatePaths(
      "edit Makefile Dockerfile LICENSE README"
    );
    assert.deepStrictEqual(result, [
      "Makefile",
      "Dockerfile",
      "LICENSE",
      "README",
    ]);
  });

  it("extracts other extensionless filenames", () => {
    const result = extractCandidatePaths(
      "run rake via Rakefile or bundle Gemfile"
    );
    assert.deepStrictEqual(result, ["Rakefile", "Gemfile"]);
  });

  // ── Windows paths ───────────────────────────────────────────────────────

  it("extracts Windows-style paths", () => {
    const result = extractCandidatePaths("see C:\\Users\\user\\file.ts");
    assert.deepStrictEqual(result, ["C:\\Users\\user\\file.ts"]);
  });

  it("extracts Windows paths with multiple directories", () => {
    const result = extractCandidatePaths("check D:\\project\\src\\main.ts");
    assert.deepStrictEqual(result, ["D:\\project\\src\\main.ts"]);
  });

  // ── Scoped packages ─────────────────────────────────────────────────────

  it("extracts scoped package paths", () => {
    const result = extractCandidatePaths("see @scope/lib/index.ts");
    assert.deepStrictEqual(result, ["@scope/lib/index.ts"]);
  });

  it("extracts @/ alias paths", () => {
    const result = extractCandidatePaths("import from @/components/Button.tsx");
    assert.deepStrictEqual(result, ["@/components/Button.tsx"]);
  });

  // ── Inline code context ─────────────────────────────────────────────────

  it("extracts paths from inline code-like tokens", () => {
    const result = extractCandidatePaths("`src/index.ts`");
    assert.deepStrictEqual(result, ["src/index.ts"]);
  });

  it("extracts multiple paths from comma-separated inline code", () => {
    const result = extractCandidatePaths("`src/a.ts, src/b.ts`");
    assert.deepStrictEqual(result, ["src/a.ts", "src/b.ts"]);
  });

  it("extracts dotfiles from inline code", () => {
    const result = extractCandidatePaths("`.gitignore`");
    assert.deepStrictEqual(result, [".gitignore"]);
  });

  // ── Filtering ───────────────────────────────────────────────────────────

  it("filters out URLs", () => {
    const result = extractCandidatePaths(
      "see https://example.com/path and /src/index.ts"
    );
    assert.deepStrictEqual(result, ["/src/index.ts"]);
  });

  it("filters out http URLs", () => {
    const result = extractCandidatePaths("http://example.com/foo.ts /a.ts");
    assert.deepStrictEqual(result, ["/a.ts"]);
  });

  it("filters out protocol-relative URLs (//example.com/...)", () => {
    const result = extractCandidatePaths("//example.com/foo.ts /a.ts");
    assert.deepStrictEqual(result, ["/a.ts"]);
  });

  it("filters out overly long tokens (>260 chars)", () => {
    const longPath = "/" + "a".repeat(260);
    const result = extractCandidatePaths(`check ${longPath}`);
    assert.deepStrictEqual(result, []);
  });

  it("deduplicates repeated paths", () => {
    const result = extractCandidatePaths("/a.ts /a.ts /a.ts");
    assert.deepStrictEqual(result, ["/a.ts"]);
  });

  it("returns empty array for plain text without paths", () => {
    const result = extractCandidatePaths(
      "hello world, this is a normal sentence"
    );
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array for empty string", () => {
    const result = extractCandidatePaths("");
    assert.deepStrictEqual(result, []);
  });

  it("does not extract plain words", () => {
    const result = extractCandidatePaths("foo bar abc xyz");
    assert.deepStrictEqual(result, []);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("handles paths with hyphens and underscores", () => {
    const result = extractCandidatePaths("see /my-project/some_file.ts");
    assert.deepStrictEqual(result, ["/my-project/some_file.ts"]);
  });

  it("handles paths with dollar signs", () => {
    const result = extractCandidatePaths("check $HOME/project/file.ts");
    assert.deepStrictEqual(result, ["$HOME/project/file.ts"]);
  });

  it("handles paths with various extensions", () => {
    const result = extractCandidatePaths("/a.ts /b.jsx /c.py /d.rs /e.go");
    assert.deepStrictEqual(result, [
      "/a.ts",
      "/b.jsx",
      "/c.py",
      "/d.rs",
      "/e.go",
    ]);
  });

  it("handles mixed content with paths and non-paths", () => {
    const result = extractCandidatePaths(
      "edit src/main.ts then run npm test and check lib/utils.ts"
    );
    assert.deepStrictEqual(result, ["src/main.ts", "lib/utils.ts"]);
  });

  it("handles paths separated by various delimiters", () => {
    const result = extractCandidatePaths("/a.ts:/b.ts;/c.ts|/d.ts");
    assert.deepStrictEqual(result, ["/a.ts", "/b.ts", "/c.ts", "/d.ts"]);
  });

  it("handles paths in parentheses and brackets", () => {
    const result = extractCandidatePaths("(/a.ts) [/b.ts] {/c.ts}");
    assert.deepStrictEqual(result, ["/a.ts", "/b.ts", "/c.ts"]);
  });

  it("handles realistic agent output with mixed paths", () => {
    const result = extractCandidatePaths(
      "I've updated src/index.ts, .github/workflows/ci.yml, and Makefile. See also @/lib/utils.ts"
    );
    assert.deepStrictEqual(result, [
      "src/index.ts",
      ".github/workflows/ci.yml",
      "Makefile",
      "@/lib/utils.ts",
    ]);
  });

  it("extracts Windows paths from inline code", () => {
    const result = extractCandidatePaths("`C:\\Users\\user\\file.ts`");
    assert.deepStrictEqual(result, ["C:\\Users\\user\\file.ts"]);
  });

  it("extracts Windows paths with multiple directories", () => {
    const result = extractCandidatePaths("`D:\\project\\src\\main.ts`");
    assert.deepStrictEqual(result, ["D:\\project\\src\\main.ts"]);
  });
});
