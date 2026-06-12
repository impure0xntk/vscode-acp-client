import * as assert from "assert";
import { describe, it } from "mocha";
import { estimateTokens } from "../../adapter/context/assembler";

// ============================================================================
// Context Attachment — estimateTokens edge cases
// ============================================================================

describe("estimateTokens — Edge Cases", () => {
  it("returns 0 for empty string", () => {
    assert.strictEqual(estimateTokens(""), 0);
  });

  it("returns 1 for 1 character", () => {
    assert.strictEqual(estimateTokens("a"), 1);
  });

  it("returns 1 for 4 characters", () => {
    assert.strictEqual(estimateTokens("abcd"), 1);
  });

  it("returns 2 for 5 characters", () => {
    assert.strictEqual(estimateTokens("abcde"), 2);
  });

  it("returns 2 for 8 characters", () => {
    assert.strictEqual(estimateTokens("abcdefgh"), 2);
  });

  it("handles unicode characters (multi-byte)", () => {
    // Each unicode char may be >1 byte, but estimateTokens uses .length (code units)
    const text = "日本語テスト";  // 6 chars
    assert.strictEqual(estimateTokens(text), 2);  // ceil(6/4) = 2
  });

  it("handles newlines and whitespace", () => {
    const text = "line1\nline2\nline3";  // 17 chars
    assert.strictEqual(estimateTokens(text), 5);  // ceil(17/4) = 5
  });

  it("handles very large text", () => {
    const text = "x".repeat(10000);
    assert.strictEqual(estimateTokens(text), 2500);
  });

  it("handles text with exactly 4n characters", () => {
    assert.strictEqual(estimateTokens("a".repeat(4)), 1);
    assert.strictEqual(estimateTokens("a".repeat(8)), 2);
    assert.strictEqual(estimateTokens("a".repeat(400)), 100);
  });

  it("handles text with 4n+1 characters", () => {
    assert.strictEqual(estimateTokens("a".repeat(5)), 2);
    assert.strictEqual(estimateTokens("a".repeat(9)), 3);
    assert.strictEqual(estimateTokens("a".repeat(401)), 101);
  });
});

// ============================================================================
// ContextAttachment type validation
// ============================================================================

describe("ContextAttachment — Type Validation", () => {
  it("creates a valid file attachment", () => {
    const attachment = {
      id: "ctx-1",
      type: "file" as const,
      path: "/src/index.ts",
      label: "index.ts",
      tokenCount: 100,
      content: "file content",
      lineRange: undefined as [number, number] | undefined,
    };
    assert.strictEqual(attachment.type, "file");
    assert.strictEqual(attachment.tokenCount, 100);
    assert.strictEqual(attachment.lineRange, undefined);
  });

  it("creates a valid selection attachment", () => {
    const attachment = {
      id: "ctx-2",
      type: "selection" as const,
      path: "/src/index.ts",
      label: "index.ts:10-20",
      lineRange: [10, 20] as [number, number],
      tokenCount: 50,
      content: "selected text",
    };
    assert.deepStrictEqual(attachment.lineRange, [10, 20]);
  });

  it("creates a valid symbol attachment", () => {
    const attachment = {
      id: "ctx-3",
      type: "symbol" as const,
      path: "/src/utils.ts",
      label: "formatDate (function)",
      lineRange: [15, 25] as [number, number],
      tokenCount: 30,
      content: "function formatDate() {}",
    };
    assert.strictEqual(attachment.type, "symbol");
  });

  it("creates a valid diff attachment", () => {
    const attachment = {
      id: "ctx-4",
      type: "diff" as const,
      path: "(working tree)",
      label: "Working tree diff",
      tokenCount: 200,
      content: "diff --git a/file.ts b/file.ts\n...",
    };
    assert.strictEqual(attachment.type, "diff");
  });

  it("validates all attachment types", () => {
    const types = ["file", "selection", "symbol", "diff"] as const;
    for (const type of types) {
      const attachment = {
        id: `ctx-${type}`,
        type,
        path: "/test",
        label: type,
        tokenCount: 10,
        content: "test",
      };
      assert.strictEqual(attachment.type, type);
    }
  });
});
