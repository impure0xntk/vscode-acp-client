import * as assert from "assert";
import { describe, it } from "mocha";
import { estimateTokens } from "../../adapter/context/assembler";

// ============================================================================
// Context Assembler Tests
// ============================================================================

describe("estimateTokens — Basic", () => {
  it("returns 1 for short text", () => {
    assert.strictEqual(estimateTokens("hi"), 1);
  });

  it("returns ceil(length / 4)", () => {
    assert.strictEqual(estimateTokens("abcd"), 1);   // 4/4 = 1
    assert.strictEqual(estimateTokens("abcde"), 2);  // 5/4 = 1.25 -> 2
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
