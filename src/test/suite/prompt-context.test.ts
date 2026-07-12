import * as assert from "assert";
import { describe, it } from "mocha";
import { attachmentsToContentBlocks } from "../../adapter/context/prompt-context";
import type { ContextAttachmentDTO } from "../../domain/models/chat";

describe("attachmentsToContentBlocks — turn attachments", () => {
  it("maps a turn attachment to a synthetic turn:// resource block", () => {
    const blocks = attachmentsToContentBlocks([
      {
        id: "t1",
        type: "turn",
        path: "",
        label: "S · analyze",
        tokenCount: 5,
        content: "the final output",
      },
    ]);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual((blocks[0] as { type: string }).type, "resource");
    const resource = (blocks[0] as { resource: { uri: string; text: string } })
      .resource;
    assert.strictEqual(resource.uri, "turn://session-output");
    assert.strictEqual(resource.text, "the final output");
  });

  it("skips path-less non-turn attachments but keeps turn output", () => {
    const blocks = attachmentsToContentBlocks([
      {
        id: "x",
        type: "file",
        path: "",
        label: "l",
        tokenCount: 0,
        content: "",
      },
      {
        id: "t",
        type: "turn",
        path: "",
        label: "turn",
        tokenCount: 1,
        content: "hi",
      },
    ]);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(
      (blocks[0] as { resource: { uri: string } }).resource.uri,
      "turn://session-output"
    );
  });
});
