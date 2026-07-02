import * as assert from "assert";
import { mapToolKind, buildToolTitle } from "../../adapter/acp/tool-utils";

describe("mapToolKind", () => {
  it("maps known read tool names to 'read'", () => {
    assert.strictEqual(mapToolKind("Read"), "read");
    assert.strictEqual(mapToolKind("read_files"), "read");
    assert.strictEqual(mapToolKind("read"), "read");
  });

  it("maps known edit tool names to 'edit'", () => {
    assert.strictEqual(mapToolKind("Edit"), "edit");
    assert.strictEqual(mapToolKind("Write"), "edit");
    assert.strictEqual(mapToolKind("write"), "edit");
    assert.strictEqual(mapToolKind("patch"), "edit");
  });

  it("maps known execute tool names to 'execute'", () => {
    assert.strictEqual(mapToolKind("Bash"), "execute");
    assert.strictEqual(mapToolKind("bash"), "execute");
    assert.strictEqual(mapToolKind("shell"), "execute");
  });

  it("maps known search tool names to 'search'", () => {
    assert.strictEqual(mapToolKind("Grep"), "search");
    assert.strictEqual(mapToolKind("grep"), "search");
    assert.strictEqual(mapToolKind("glob"), "search");
    assert.strictEqual(mapToolKind("repo_clone"), "search");
  });

  it("maps known fetch tool names to 'fetch'", () => {
    assert.strictEqual(mapToolKind("WebFetch"), "fetch");
    assert.strictEqual(mapToolKind("webfetch"), "fetch");
  });

  it("maps known think tool names to 'think'", () => {
    assert.strictEqual(mapToolKind("Agent"), "think");
    assert.strictEqual(mapToolKind("spawn_agent"), "think");
  });

  it("returns 'other' for unknown tool names", () => {
    assert.strictEqual(mapToolKind("UnknownTool"), "other");
    assert.strictEqual(mapToolKind("custom_operation"), "other");
  });

  it("handles empty string", () => {
    assert.strictEqual(mapToolKind(""), "other");
  });
});

describe("buildToolTitle", () => {
  it("returns toolName when input is null", () => {
    assert.strictEqual(buildToolTitle("bash", null), "bash");
  });

  it("returns toolName when input is undefined", () => {
    assert.strictEqual(buildToolTitle("read", undefined), "read");
  });

  it("returns toolName when input is not an object", () => {
    assert.strictEqual(buildToolTitle("bash", "string"), "bash");
    assert.strictEqual(buildToolTitle("bash", 42), "bash");
  });

  it("shows filePath for file operations", () => {
    assert.strictEqual(
      buildToolTitle("read", { filePath: "/path/to/file.ts" }),
      "read: /path/to/file.ts"
    );
    assert.strictEqual(
      buildToolTitle("edit", { filepath: "/src/index.ts" }),
      "edit: /src/index.ts"
    );
    assert.strictEqual(
      buildToolTitle("grep", { path: "/project" }),
      "grep: /project"
    );
  });

  it("shows command text for execute operations", () => {
    assert.strictEqual(
      buildToolTitle("bash", { command: "ls -la" }),
      "bash: ls -la"
    );
  });

  it("truncates long commands to 60 characters", () => {
    const longCmd = "a".repeat(100);
    const result = buildToolTitle("bash", { command: longCmd });
    assert.strictEqual(result.startsWith("bash: "), true);
    assert.strictEqual(result.endsWith("…"), true);
    assert.strictEqual(result.length, 67); // "bash: " (6) + 60 chars + "…" (1)
  });

  it("shows pattern for search operations", () => {
    assert.strictEqual(
      buildToolTitle("grep", { pattern: "TODO" }),
      "grep: TODO"
    );
    assert.strictEqual(
      buildToolTitle("search_codebase", { query: "error handling" }),
      "search_codebase: error handling"
    );
  });

  it("returns toolName when no extractable info is found", () => {
    assert.strictEqual(
      buildToolTitle("some_tool", { foo: "bar" }),
      "some_tool"
    );
  });
});
