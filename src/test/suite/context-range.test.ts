import * as assert from "assert";
import { describe, it } from "mocha";
import { resolveRange, type SerializedRange } from "../../adapter/context/assembler";
import type { EditorAPI } from "../../platform/editor";
import type { PlatformUri } from "../../platform/types";

function makeUri(fsPath: string): PlatformUri {
  const uri: PlatformUri = {
    scheme: "file",
    fsPath,
    path: fsPath,
    with: () => uri,
    toString: () => `file://${fsPath}`,
  };
  return uri;
}

function makeEditor(content: string): EditorAPI {
  return {
    getDocumentContent: async () => content,
  } as unknown as EditorAPI;
}

describe("resolveRange — Quick Fix / diagnostic range attachment", () => {
  const content = [
    "function add(a, b) {",
    "  return a + b",
    "}",
    "",
    "const x = add(1, 'two');", // line 5 (1-based) — a type error
    "console.log(x);",
  ].join("\n");

  it("attaches a single mid-line problem range (1-based label)", async () => {
    const range: SerializedRange = {
      startLine: 4,
      startCharacter: 0,
      endLine: 4,
      endCharacter: 24,
    };
    const attachment = await resolveRange(
      makeEditor(content),
      makeUri("/src/app.ts"),
      range
    );
    assert.ok(attachment);
    assert.strictEqual(attachment!.type, "selection");
    assert.strictEqual(attachment!.path, "/src/app.ts");
    assert.strictEqual(attachment!.label, "app.ts:5-5");
    assert.deepStrictEqual(attachment!.lineRange, [5, 5]);
    assert.strictEqual(attachment!.content, "const x = add(1, 'two');");
  });

  it("attaches a multi-line range ending at column 0 (end-exclusive)", async () => {
    // Lines 1-3 (1-based) as a diagnostic ending at the start of line 4.
    const range: SerializedRange = {
      startLine: 0,
      startCharacter: 0,
      endLine: 3,
      endCharacter: 0,
    };
    const attachment = await resolveRange(
      makeEditor(content),
      makeUri("/src/app.ts"),
      range
    );
    assert.ok(attachment);
    assert.strictEqual(attachment!.label, "app.ts:1-3");
    assert.deepStrictEqual(attachment!.lineRange, [1, 3]);
    assert.strictEqual(
      attachment!.content,
      "function add(a, b) {\n  return a + b\n}"
    );
  });

  it("attaches a multi-line range ending mid-line (inclusive end line)", async () => {
    const range: SerializedRange = {
      startLine: 0,
      startCharacter: 0,
      endLine: 4,
      endCharacter: 10,
    };
    const attachment = await resolveRange(
      makeEditor(content),
      makeUri("/src/app.ts"),
      range
    );
    assert.ok(attachment);
    assert.strictEqual(attachment!.label, "app.ts:1-5");
    assert.deepStrictEqual(attachment!.lineRange, [1, 5]);
  });

  it("returns null for a zero-width (cursor) range", async () => {
    const range: SerializedRange = {
      startLine: 4,
      startCharacter: 5,
      endLine: 4,
      endCharacter: 5,
    };
    const attachment = await resolveRange(
      makeEditor(content),
      makeUri("/src/app.ts"),
      range
    );
    assert.strictEqual(attachment, null);
  });

  it("returns null when the document content cannot be read", async () => {
    const failingEditor = {
      getDocumentContent: async () => {
        throw new Error("document not open");
      },
    } as unknown as EditorAPI;
    const range: SerializedRange = {
      startLine: 0,
      startCharacter: 0,
      endLine: 1,
      endCharacter: 0,
    };
    const attachment = await resolveRange(
      failingEditor,
      makeUri("/src/missing.ts"),
      range
    );
    assert.strictEqual(attachment, null);
  });
});
