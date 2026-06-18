import * as assert from "assert";
import { describe, it } from "mocha";
import { elapsedColor } from "../../shared/elapsedColor";
import { ELAPSED_WARNING_MS, ELAPSED_CRITICAL_MS } from "../../shared/constants";

describe("elapsedColor", () => {
  it("returns 'normal' for 0ms", () => {
    assert.strictEqual(elapsedColor(0), "normal");
  });

  it("returns 'normal' for elapsed < warning threshold", () => {
    assert.strictEqual(elapsedColor(ELAPSED_WARNING_MS - 1), "normal");
  });

  it("returns 'warning' at warning threshold", () => {
    assert.strictEqual(elapsedColor(ELAPSED_WARNING_MS), "warning");
  });

  it("returns 'warning' between warning and critical", () => {
    const mid = Math.floor((ELAPSED_WARNING_MS + ELAPSED_CRITICAL_MS) / 2);
    assert.strictEqual(elapsedColor(mid), "warning");
  });

  it("returns 'warning' just below critical threshold", () => {
    assert.strictEqual(elapsedColor(ELAPSED_CRITICAL_MS - 1), "warning");
  });

  it("returns 'critical' at critical threshold", () => {
    assert.strictEqual(elapsedColor(ELAPSED_CRITICAL_MS), "critical");
  });

  it("returns 'critical' above critical threshold", () => {
    assert.strictEqual(elapsedColor(ELAPSED_CRITICAL_MS * 2), "critical");
  });
});
