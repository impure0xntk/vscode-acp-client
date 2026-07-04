import { strict as assert } from "assert";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  contentBlocksToAttachments,
  buildPromptContent,
} from "../../adapter/acp/content";

describe("contentBlocksToAttachments", () => {
  it("returns empty for text-only blocks", () => {
    const blocks: ContentBlock[] = [{ type: "text", text: "Hello, world!" }];
    const result = contentBlocksToAttachments(blocks);
    assert.deepStrictEqual(result, []);
  });

  it("extracts resource_link blocks as attachments", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource_link",
        uri: "file:///home/user/src/app.ts",
        name: "app.ts",
        mimeType: "text/plain",
        size: 100,
      },
    ];
    const result = contentBlocksToAttachments(blocks);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, "file");
    assert.ok(result[0].path.includes("app.ts"));
    assert.strictEqual(result[0].label, "app.ts");
  });

  it("extracts text resources from embedded resource blocks", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///home/user/src/config.json",
          text: '{"key":"value"}',
        },
      },
    ];
    const result = contentBlocksToAttachments(blocks);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, "file");
    assert.ok(result[0].path.includes("config.json"));
    assert.strictEqual(result[0].content, '{"key":"value"}');
  });

  it("returns empty for image blocks without uri (blob)", () => {
    const blocks: ContentBlock[] = [
      {
        type: "image",
        mimeType: "image/png",
        data: "base64encoded",
      },
    ];
    const result = contentBlocksToAttachments(blocks);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].label.includes("image"));
  });

  it("returns empty for empty array", () => {
    const result = contentBlocksToAttachments([]);
    assert.deepStrictEqual(result, []);
  });

  it("handles multiple mixed blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "prompt" },
      {
        type: "resource_link",
        uri: "file:///home/user/a.ts",
        name: "a.ts",
        mimeType: "text/plain",
        size: 50,
      },
      {
        type: "resource_link",
        uri: "file:///home/user/b.ts",
        name: "b.ts",
        mimeType: "text/plain",
        size: 80,
      },
    ];
    const result = contentBlocksToAttachments(blocks);
    // text block is skipped, only two resource_links
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].label, "a.ts");
    assert.strictEqual(result[1].label, "b.ts");
  });

  it("handles resource block with blob (binary) resource", () => {
    const blocks: ContentBlock[] = [
      {
        type: "resource",
        resource: {
          uri: "file:///tmp/binary.dat",
          blob: "base64blob",
        } as any,
      },
    ];
    const result = contentBlocksToAttachments(blocks);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].path.includes("binary.dat"));
  });
});

describe("buildPromptContent", () => {
  it("returns text-only ContentBlock when no attachments", () => {
    const blocks = buildPromptContent("Hello");
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, "text");
    assert.strictEqual((blocks[0] as any).text, "Hello");
  });

  it("adds resource_link blocks for file attachments", () => {
    const blocks = buildPromptContent("Help me with this file", [
      {
        id: "ctx-1",
        type: "file",
        path: "/home/user/src/main.ts",
        label: "main.ts",
        tokenCount: 50,
        content: "console.log('hello');",
      },
    ]);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, "resource_link");
    assert.ok((blocks[0] as any).uri.includes("main.ts"));
    assert.strictEqual(blocks[1].type, "text");
  });

  it("wraps selection attachments as text blocks with metadata", () => {
    const blocks = buildPromptContent("Review this selection", [
      {
        id: "ctx-2",
        type: "selection",
        path: "/home/user/src/app.ts",
        label: "app.ts:10-20",
        lineRange: [10, 20],
        tokenCount: 30,
        content: "export function foo() {}",
      },
    ]);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, "text");
    const text = (blocks[0] as any).text as string;
    assert.ok(text.includes("app.ts"));
    assert.ok(text.includes("lines 10-20"));
  });

  it("wraps diff attachments as text blocks", () => {
    const blocks = buildPromptContent("Check this diff", [
      {
        id: "ctx-3",
        type: "diff",
        path: "(working tree)",
        label: "Working tree diff",
        tokenCount: 20,
        content: "+added line\n-removed line",
      },
    ]);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, "text");
    assert.ok((blocks[0] as any).text.includes("Diff"));
  });

  it("wraps symbol attachments as text blocks", () => {
    const blocks = buildPromptContent("Explain this symbol", [
      {
        id: "ctx-4",
        type: "symbol",
        path: "/home/user/src/lib.ts",
        label: "computeHash",
        tokenCount: 15,
        content: "export function computeHash(s: string): string",
      },
    ]);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, "text");
    assert.ok((blocks[0] as any).text.includes("computeHash"));
  });

  it("handles multiple attachments of different types", () => {
    const blocks = buildPromptContent("Analyze all", [
      {
        id: "ctx-5",
        type: "file",
        path: "/src/a.ts",
        label: "a.ts",
        tokenCount: 10,
        content: "a",
      },
      {
        id: "ctx-6",
        type: "selection",
        path: "/src/b.ts",
        label: "b.ts:1-5",
        lineRange: [1, 5],
        tokenCount: 10,
        content: "b",
      },
      {
        id: "ctx-7",
        type: "diff",
        path: "(working tree)",
        label: "diff",
        tokenCount: 10,
        content: "d",
      },
    ]);
    // 3 attachment blocks + 1 text block = 4
    assert.strictEqual(blocks.length, 4);
    assert.strictEqual(blocks[3].type, "text");
  });
});
