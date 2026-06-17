import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure function from ContextCompressionNotice ──────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface SessionCompressionInfo {
  contextWindowMax: number;
  usedTokens: number;
  usedBefore?: number;
}

function computeCompressionDisplay(info: SessionCompressionInfo): {
  percentage: number;
  beforePercentage: number | null;
  saved: number;
  hasBefore: boolean;
} {
  const { contextWindowMax, usedTokens, usedBefore } = info;

  const percentage =
    contextWindowMax > 0
      ? Math.round((usedTokens / contextWindowMax) * 100)
      : 0;
  const beforePercentage =
    usedBefore && contextWindowMax > 0
      ? Math.round((usedBefore / contextWindowMax) * 100)
      : null;
  const saved = usedBefore ? usedBefore - usedTokens : 0;

  return {
    percentage,
    beforePercentage,
    saved,
    hasBefore: beforePercentage !== null,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("computeCompressionDisplay", () => {
  it("calculates percentage correctly", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 1000,
      usedTokens: 500,
    });
    assert.strictEqual(result.percentage, 50);
  });

  it("returns 0 percentage when contextWindowMax is 0", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 0,
      usedTokens: 500,
    });
    assert.strictEqual(result.percentage, 0);
  });

  it("returns null beforePercentage when usedBefore is not set", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 1000,
      usedTokens: 500,
    });
    assert.strictEqual(result.beforePercentage, null);
    assert.strictEqual(result.hasBefore, false);
  });

  it("calculates beforePercentage when usedBefore is set", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 1000,
      usedTokens: 400,
      usedBefore: 800,
    });
    assert.strictEqual(result.beforePercentage, 80);
    assert.strictEqual(result.percentage, 40);
    assert.strictEqual(result.hasBefore, true);
  });

  it("calculates saved tokens", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 1000,
      usedTokens: 300,
      usedBefore: 800,
    });
    assert.strictEqual(result.saved, 500);
  });

  it("returns 0 saved when usedBefore is not set", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 1000,
      usedTokens: 500,
    });
    assert.strictEqual(result.saved, 0);
  });

  it("handles full context window", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 1000,
      usedTokens: 1000,
      usedBefore: 1000,
    });
    assert.strictEqual(result.percentage, 100);
    assert.strictEqual(result.beforePercentage, 100);
    assert.strictEqual(result.saved, 0);
  });

  it("handles zero used tokens", () => {
    const result = computeCompressionDisplay({
      contextWindowMax: 1000,
      usedTokens: 0,
      usedBefore: 500,
    });
    assert.strictEqual(result.percentage, 0);
    assert.strictEqual(result.beforePercentage, 50);
    assert.strictEqual(result.saved, 500);
  });
});

// ── formatTokens (ContextCompressionNotice) ─────────────────────────────────

describe("formatTokens (compression notice)", () => {
  it("returns plain number for < 1000", () => {
    assert.strictEqual(formatTokens(0), "0");
    assert.strictEqual(formatTokens(999), "999");
  });

  it("formats thousands with 'k'", () => {
    assert.strictEqual(formatTokens(1000), "1.0k");
    assert.strictEqual(formatTokens(1500), "1.5k");
  });

  it("formats millions with 'M'", () => {
    assert.strictEqual(formatTokens(1_000_000), "1.0M");
    assert.strictEqual(formatTokens(2_500_000), "2.5M");
  });
});
