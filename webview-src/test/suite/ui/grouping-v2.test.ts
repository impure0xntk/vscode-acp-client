/**
 * Tests for the v2 O(W log W + S) algorithm for per-step file edit
 * partitioning ({@link attachStepFileEditSummariesV2}).
 *
 * These tests validate the pure functions exported from grouping.ts
 * (lowerBound, buildSummaryFromWrites, computeLineDiff, clearDiffCache)
 * and the v2 partitioning entry point.
 */
import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import {
  lowerBound,
  buildSummaryFromWrites,
  computeLineDiff,
  clearDiffCache,
  attachStepFileEditSummariesV2,
} from "../../../pipeline/stages/grouping";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import type {
  IntermediateStep,
  ChatDisplayItem,
} from "../../../pipeline/types";
import type { FileWriteRecord } from "../../../store/fileWriteStore";

// ── helpers ────────────────────────────────────────────────────────────────

let keyCounter = 0;
function nextKey(p: string): string {
  return `${p}-${++keyCounter}`;
}

function agentChat(
  content: string,
  overrides: Partial<ChatDisplayItem> = {}
): ChatDisplayItem {
  return {
    type: "chat",
    role: "agent",
    agentId: "a1",
    sessionId: "s1",
    content,
    key: nextKey("agent"),
    timestamp: Date.now(),
    isFirstOfTurn: false,
    attachments: [],
    thinking: undefined,
    ...overrides,
  };
}

function makeStep(
  agentMessage: ChatDisplayItem | null,
  toolCalls: ChatDisplayItem[] = [],
  isPreAgent = false
): IntermediateStep {
  return { agentMessage, toolCalls, isPreAgent } as IntermediateStep;
}

// ── lowerBound ─────────────────────────────────────────────────────────────

describe("lowerBound", () => {
  it("returns 0 for empty array", () => {
    const arr: FileWriteRecord[] = [];
    assert.strictEqual(lowerBound(arr, 5), 0);
  });

  it("returns 0 when target is smaller than all elements", () => {
    const arr: FileWriteRecord[] = [
      {
        path: "/a",
        content: "x",
        originalContent: null,
        seq: 10,
        contentHash: "",
      },
      {
        path: "/b",
        content: "y",
        originalContent: null,
        seq: 20,
        contentHash: "",
      },
    ];
    assert.strictEqual(lowerBound(arr, 5), 0);
  });

  it("returns length when target is greater than all elements", () => {
    const arr: FileWriteRecord[] = [
      {
        path: "/a",
        content: "x",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/b",
        content: "y",
        originalContent: null,
        seq: 2,
        contentHash: "",
      },
    ];
    assert.strictEqual(lowerBound(arr, 99), 2);
  });

  it("returns exact insertion index for mixed values", () => {
    const arr: FileWriteRecord[] = [
      {
        path: "/a",
        content: "x",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/b",
        content: "y",
        originalContent: null,
        seq: 3,
        contentHash: "",
      },
      {
        path: "/c",
        content: "z",
        originalContent: null,
        seq: 5,
        contentHash: "",
      },
      {
        path: "/d",
        content: "w",
        originalContent: null,
        seq: 7,
        contentHash: "",
      },
    ];
    // seqs: [1, 3, 5, 7]
    assert.strictEqual(lowerBound(arr, 0), 0); // before first
    assert.strictEqual(lowerBound(arr, 1), 0); // exact match → first index where seq >= 1
    assert.strictEqual(lowerBound(arr, 2), 1); // between 1 and 3
    assert.strictEqual(lowerBound(arr, 3), 1); // exact match
    assert.strictEqual(lowerBound(arr, 4), 2); // between 3 and 5
    assert.strictEqual(lowerBound(arr, 5), 2); // exact match
    assert.strictEqual(lowerBound(arr, 6), 3); // between 5 and 7
    assert.strictEqual(lowerBound(arr, 7), 3); // exact match
    assert.strictEqual(lowerBound(arr, 8), 4); // after last
  });

  it("respects the start parameter", () => {
    const arr: FileWriteRecord[] = [
      {
        path: "/a",
        content: "x",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/b",
        content: "y",
        originalContent: null,
        seq: 3,
        contentHash: "",
      },
      {
        path: "/c",
        content: "z",
        originalContent: null,
        seq: 5,
        contentHash: "",
      },
      {
        path: "/d",
        content: "w",
        originalContent: null,
        seq: 7,
        contentHash: "",
      },
    ];
    // start=2 → skip seqs 1 and 3
    assert.strictEqual(lowerBound(arr, 1, 2), 2);
    assert.strictEqual(lowerBound(arr, 4, 2), 2);
    assert.strictEqual(lowerBound(arr, 6, 2), 3);
    assert.strictEqual(lowerBound(arr, 9, 2), 4);
  });

  it("handles duplicates correctly", () => {
    const arr: FileWriteRecord[] = [
      {
        path: "/a",
        content: "x",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/b",
        content: "y",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/c",
        content: "z",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/d",
        content: "w",
        originalContent: null,
        seq: 2,
        contentHash: "",
      },
    ];
    // All seq=1 entries match → lower bound returns first
    assert.strictEqual(lowerBound(arr, 1), 0);
    // target=2 → first index where seq >= 2 is index 3
    assert.strictEqual(lowerBound(arr, 2), 3);
  });

  it("is O(log n) — large array performance regression guard", () => {
    const arr: FileWriteRecord[] = [];
    for (let i = 0; i < 100000; i++) {
      arr.push({
        path: `f${i}`,
        content: "x",
        originalContent: null,
        seq: i * 2,
        contentHash: "",
      });
    }
    // Should return without performance issue
    const start = Date.now();
    assert.strictEqual(lowerBound(arr, 100001), 50001);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `lowerBound took ${elapsed}ms (expected <100ms)`);
  });
});

// ── buildSummaryFromWrites ─────────────────────────────────────────────────

describe("buildSummaryFromWrites", () => {
  it("returns undefined for empty array", () => {
    assert.strictEqual(buildSummaryFromWrites([]), undefined);
  });

  it("handles single write with null original", () => {
    const writes: FileWriteRecord[] = [
      {
        path: "/a.ts",
        content: "line1\nline2",
        originalContent: null,
        seq: 0,
        contentHash: "",
      },
    ];
    const result = buildSummaryFromWrites(writes);
    assert.ok(result);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, "/a.ts");
    assert.strictEqual(result[0].lineCount, 2);
    assert.strictEqual(result[0].deletedLines, 0);
    assert.strictEqual(result[0].writtenContent, "line1\nline2");
  });

  it("merges multiple writes to same path (latest wins for diff)", () => {
    const writes: FileWriteRecord[] = [
      {
        path: "/a.ts",
        content: "v1",
        originalContent: null,
        seq: 0,
        contentHash: "",
      },
      {
        path: "/a.ts",
        content: "v2\nv2",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
    ];
    const result = buildSummaryFromWrites(writes);
    assert.ok(result);
    assert.strictEqual(result!.length, 1);
    assert.strictEqual(result[0].path, "/a.ts");
    assert.strictEqual(result[0].writtenContent, "v2\nv2");
    // Latest content = "v2\nv2" → 2 lines; original=null → 2 added
    assert.strictEqual(result[0].lineCount, 2);
  });

  it("preserves originalContent from first write", () => {
    const writes: FileWriteRecord[] = [
      {
        path: "/a.ts",
        content: "new",
        originalContent: "original",
        seq: 0,
        contentHash: "",
      },
      {
        path: "/a.ts",
        content: "newer",
        originalContent: "ignored",
        seq: 1,
        contentHash: "",
      },
    ];
    const result = buildSummaryFromWrites(writes);
    assert.ok(result);
    assert.strictEqual(result[0].originalContent, "original");
  });

  it("returns multiple entries for distinct paths", () => {
    const writes: FileWriteRecord[] = [
      {
        path: "/a.ts",
        content: "a1",
        originalContent: null,
        seq: 0,
        contentHash: "",
      },
      {
        path: "/b.ts",
        content: "b1\nb2",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/c.ts",
        content: "c1",
        originalContent: null,
        seq: 2,
        contentHash: "",
      },
    ];
    const result = buildSummaryFromWrites(writes);
    assert.ok(result);
    assert.strictEqual(result.length, 3);
    const paths = result.map((r) => r.path);
    assert.deepStrictEqual(paths, ["/a.ts", "/b.ts", "/c.ts"]);
  });

  it("insertion order is preserved across unsorted seq", () => {
    // Writes arrive out of seq order but Map preserves insertion order
    const writes: FileWriteRecord[] = [
      {
        path: "/later.ts",
        content: "aa",
        originalContent: null,
        seq: 5,
        contentHash: "",
      },
      {
        path: "/early.ts",
        content: "bb",
        originalContent: null,
        seq: 1,
        contentHash: "",
      },
      {
        path: "/mid.ts",
        content: "cc",
        originalContent: null,
        seq: 3,
        contentHash: "",
      },
    ];
    const result = buildSummaryFromWrites(writes);
    assert.ok(result);
    // buildSummaryFromWrites does NOT re-sort — returns in Map order (insertion order)
    const paths = result.map((r) => r.path);
    assert.deepStrictEqual(paths, ["/later.ts", "/early.ts", "/mid.ts"]);
  });
});

// ── clearDiffCache ──────────────────────────────────────────────────────────

describe("clearDiffCache", () => {
  it("is a no-op (LRU handles eviction)", () => {
    // First compute a diff to populate the cache
    computeLineDiff(null, "hello\nworld");
    // Calling clearDiffCache should NOT throw
    assert.doesNotThrow(() => clearDiffCache());
    // The cache should still have entries (no-op, not a full clear)
    // We can't directly inspect the cache, but calling it again should be fine
    assert.doesNotThrow(() => clearDiffCache());
  });
});

// ── attachStepFileEditSummariesV2 ──────────────────────────────────────────

describe("attachStepFileEditSummariesV2", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
    keyCounter = 0;
  });

  it("does nothing when steps array is empty", () => {
    attachStepFileEditSummariesV2([], "a1", "s1");
    // No error thrown
  });

  it("does nothing when no writes exist for session", () => {
    const steps = [makeStep(agentChat("hello", { writeSeq: 0 }))];
    attachStepFileEditSummariesV2(steps, "a1", "s1");
    for (const s of steps) {
      assert.strictEqual(s.fileEditSummary, undefined);
    }
  });

  it("partitions writes across 3 steps by writeSeq boundaries", () => {
    // Setup: writes with seq 0,1 → step1, seq 2,3 → step2, seq 4 → step3(final)
    useFileWriteStore.getState().addWrite("a1", "s1", "/s1a.ts", "x"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/s1b.ts", "y"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/s2a.ts", "z"); // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/s2b.ts", "w"); // seq=3
    useFileWriteStore.getState().addWrite("a1", "s1", "/s3.ts", "q"); // seq=4

    const steps = [
      makeStep(agentChat("step1", { writeSeq: 0 })),
      makeStep(agentChat("step2", { writeSeq: 2 })),
      makeStep(agentChat("final", { writeSeq: 4, stopReason: "end_turn" })),
    ];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    // Step 1: writes seq in [0,2) → 2 entries
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 2);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/s1a.ts");
    assert.strictEqual(steps[0].fileEditSummary![1].path, "/s1b.ts");

    // Step 2: writes seq in [2,4) → 2 entries
    assert.ok(steps[1].fileEditSummary);
    assert.strictEqual(steps[1].fileEditSummary!.length, 2);
    assert.strictEqual(steps[1].fileEditSummary![0].path, "/s2a.ts");
    assert.strictEqual(steps[1].fileEditSummary![1].path, "/s2b.ts");

    // Step 3 (final): writes seq in [4,∞) → 1 entry
    assert.ok(steps[2].fileEditSummary);
    assert.strictEqual(steps[2].fileEditSummary!.length, 1);
    assert.strictEqual(steps[2].fileEditSummary![0].path, "/s3.ts");
  });

  it("does not leak writes between adjacent steps", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "a"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "b"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "c"); // seq=2

    const steps = [
      makeStep(agentChat("s1", { writeSeq: 0 })), // [0,1)
      makeStep(agentChat("s2", { writeSeq: 1 })), // [1,2)
      makeStep(agentChat("s3", { writeSeq: 2 })), // [2,∞)
    ];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 1);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/a.ts");

    assert.ok(steps[1].fileEditSummary);
    assert.strictEqual(steps[1].fileEditSummary!.length, 1);
    assert.strictEqual(steps[1].fileEditSummary![0].path, "/b.ts");

    assert.ok(steps[2].fileEditSummary);
    assert.strictEqual(steps[2].fileEditSummary!.length, 1);
    assert.strictEqual(steps[2].fileEditSummary![0].path, "/c.ts");
  });

  it("handles undefined writeSeq (defaults to 0)", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/x.ts", "x"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/y.ts", "y"); // seq=1

    const steps = [
      makeStep(agentChat("no-seq")), // writeSeq undefined → 0
      makeStep(agentChat("with-seq", { writeSeq: 1 })),
    ];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    // Step 1: writes seq in [0,1) → only seq=0 → /x.ts
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 1);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/x.ts");

    // Step 2: writes seq in [1,∞) → /y.ts
    assert.ok(steps[1].fileEditSummary);
    assert.strictEqual(steps[1].fileEditSummary!.length, 1);
    assert.strictEqual(steps[1].fileEditSummary![0].path, "/y.ts");
  });

  it("handles collapsed empty range (same writeSeq on adjacent steps)", () => {
    // Both steps have writeSeq=0 → boundary collapse: first step gets [0,0) = empty,
    // then expanded to next different lo. Since no different lo exists, all go to [0,∞).
    useFileWriteStore.getState().addWrite("a1", "s1", "/only.ts", "z"); // seq=0

    const steps = [
      makeStep(agentChat("chunk1", { writeSeq: 0 })),
      makeStep(agentChat("chunk2", { writeSeq: 0 })),
    ];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    // First step: boundary collapse → [0, ∞) includes the write
    // After collapse: boundaries[0].hi = boundaries[1].lo (=0) → no expansion possible
    // So writes go to second step (which has hi=∞)
    const totalWithSummary = steps.filter(
      (s) => s.fileEditSummary && s.fileEditSummary.length > 0
    ).length;
    assert.ok(totalWithSummary >= 1, "At least one step should have the write");
  });

  it("handles pre-agent step (agentMessage=null)", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/pre.ts", "pre"); // seq=0

    const steps = [
      makeStep(null, [], true), // pre-agent step → writeSeq undefined → 0
      makeStep(agentChat("agent", { writeSeq: 1 })),
    ];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    // Pre-agent step has writeSeq=0 → writes in [0,1) → includes seq=0
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 1);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/pre.ts");
  });

  it("does not mutate input steps when no writes exist", () => {
    const steps = [
      makeStep(agentChat("a", { writeSeq: 0 })),
      makeStep(agentChat("b", { writeSeq: 1 })),
    ];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    for (const s of steps) {
      assert.strictEqual(s.fileEditSummary, undefined);
    }
  });

  it("assigns all writes to single step when only one step", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "a"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "b"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "c"); // seq=2

    const steps = [makeStep(agentChat("only", { writeSeq: 0 }))];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 3);
  });

  it("respects session isolation (writes from other sessions ignored)", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/mine.ts", "m"); // seq=0 (correct session)
    useFileWriteStore.getState().addWrite("a2", "s2", "/other.ts", "o"); // seq=1 (wrong session)

    const steps = [makeStep(agentChat("step", { writeSeq: 0 }))];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 1);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/mine.ts");
  });

  it("immutability: original step objects are referenced (not mutated in-place)", () => {
    // v2 specifically creates new step objects via spread instead of mutating.
    useFileWriteStore.getState().addWrite("a1", "s1", "/immut.ts", "im"); // seq=0

    const originalStep = makeStep(agentChat("orig", { writeSeq: 0 }));
    const originalRef = originalStep;
    const steps = [originalStep];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    // The array entry is replaced (not mutated), so original ref stays unchanged
    assert.strictEqual(originalRef.fileEditSummary, undefined);
    // The array's step has the summary
    assert.ok(steps[0].fileEditSummary);
  });

  it("produces correct line counts after partitioning", () => {
    useFileWriteStore
      .getState()
      .addWrite("a1", "s1", "/multi.ts", "l1\nl2\nl3"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/single.ts", "s1"); // seq=1

    const steps = [
      makeStep(agentChat("s1", { writeSeq: 0 })), // [0,1) → /multi.ts
      makeStep(agentChat("s2", { writeSeq: 1 })), // [1,∞) → /single.ts
    ];

    attachStepFileEditSummariesV2(steps, "a1", "s1");

    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary![0].lineCount, 3); // "l1\nl2\nl3" = 3 lines

    assert.ok(steps[1].fileEditSummary);
    assert.strictEqual(steps[1].fileEditSummary![0].lineCount, 1); // "s1" = 1 line
  });
});

// ── computeLineDiff (v2 cache behavior) ────────────────────────────────────

describe("computeLineDiff — LRU cache behavior", () => {
  it("caches repeated calls with same content", () => {
    const r1 = computeLineDiff(null, "hello\nworld");
    const r2 = computeLineDiff(null, "hello\nworld");
    assert.deepStrictEqual(r1, r2);
    assert.strictEqual(r1.added, 2);
  });

  it("uses hash-based keys (long strings with different references)", () => {
    // Long strings (>256 chars) use FNV-1a hash; identical content with different object references should hit cache
    const longStr = "a".repeat(500);
    const r1 = computeLineDiff(longStr, longStr);
    assert.strictEqual(r1.added, 0);
    assert.strictEqual(r1.deleted, 0);

    // Same content, different object
    const copy = "a".repeat(500);
    const r2 = computeLineDiff(copy, longStr);
    assert.strictEqual(r2.added, 0);
    assert.strictEqual(r2.deleted, 0);
  });

  it("null → content returns correct additions", () => {
    const r = computeLineDiff(null, "line1\nline2\nline3");
    assert.strictEqual(r.added, 3);
    assert.strictEqual(r.deleted, 0);
  });

  it("content → null returns correct deletions", () => {
    const r = computeLineDiff("line1\nline2\nline3", null);
    assert.strictEqual(r.added, 0);
    assert.strictEqual(r.deleted, 3);
  });

  it("mixed additions and deletions", () => {
    // orig: a b c d → new: a x c y
    // LCS = [a, c] → added = 4-2=2, deleted = 4-2=2
    const r = computeLineDiff("a\nb\nc\nd", "a\nx\nc\ny");
    assert.strictEqual(r.added, 2);
    assert.strictEqual(r.deleted, 2);
  });
});
