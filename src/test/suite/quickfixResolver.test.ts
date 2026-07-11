import * as assert from "assert";
import { describe, it } from "mocha";
import {
  resolveFixAttachment,
  type FixSelectionArgs,
} from "../../infrastructure/vscode/commands/quickfixResolver";
import type { ContextAttachmentDTO } from "../../domain/models/chat";

function rangeAttachment(id: string, label: string): ContextAttachmentDTO {
  return {
    id,
    type: "selection",
    path: "/src/app.ts",
    label,
    lineRange: [1, 1],
    tokenCount: 10,
    content: "code",
  };
}

describe("resolveFixAttachment — Quick Fix range wiring", () => {
  it("uses the range args when present", async () => {
    const args: FixSelectionArgs = {
      uri: "file:///src/app.ts",
      range: { startLine: 4, startCharacter: 0, endLine: 4, endCharacter: 24 },
    };
    let rangeCalled = false;
    const result = await resolveFixAttachment(
      args,
      async () => {
        rangeCalled = true;
        return rangeAttachment("att-1", "app.ts:5-5");
      },
      async () => rangeAttachment("sel-1", "app.ts:1-1")
    );
    assert.strictEqual(rangeCalled, true);
    assert.strictEqual(result?.id, "att-1");
  });

  it("falls back to the active selection when no range args are given", async () => {
    const result = await resolveFixAttachment(
      undefined,
      async () => {
        throw new Error("resolveRangeAt should not be called without args");
      },
      async () => rangeAttachment("sel-1", "app.ts:1-1")
    );
    assert.strictEqual(result?.id, "sel-1");
  });

  it("falls back to the active selection when resolveRangeAt returns null", async () => {
    const args: FixSelectionArgs = {
      uri: "file:///src/missing.ts",
      range: { startLine: 0, startCharacter: 0, endLine: 1, endCharacter: 0 },
    };
    const result = await resolveFixAttachment(
      args,
      async () => null,
      async () => rangeAttachment("sel-1", "app.ts:1-1")
    );
    assert.strictEqual(result?.id, "sel-1");
  });

  it("returns null when there is no range and no selection", async () => {
    const result = await resolveFixAttachment(
      undefined,
      async () => null,
      async () => null
    );
    assert.strictEqual(result, null);
  });
});
