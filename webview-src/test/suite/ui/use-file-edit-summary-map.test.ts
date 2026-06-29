/**
 * Tests for the useFileEditSummaryMap hook.
 *
 * Since the hook reads from fileWriteStore (Zustand) and calls
 * buildSummaryFromWrites + lowerBound internally, these tests exercise
 * the full computation path without mocking React.
 *
 * The hook is exercised indirectly: we replicate its internal useMemo
 * logic (which is pure) here to verify correctness without needing a
 * React renderer.  The hook itself is a thin wrapper around useFileWriteStore
 * + useMemo, so testing the algorithm is the key validation.
 */
import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import {
  buildSummaryFromWrites,
  lowerBound,
} from "../../../pipeline/stages/grouping";
import type { FileEditEntry } from "../../../pipeline/types";
import type { FileWriteRecord } from "../../../store/fileWriteStore";

// ── Pure replica of useFileEditSummaryMap's useMemo logic ─────────────────

function computeSummaryMap(
  writes: FileWriteRecord[],
  boundaries: { lo: number; hi: number }[],
): Map<number, FileEditEntry[]> | undefined {
  if (writes.length === 0 || boundaries.length === 0) return undefined;

  const sortedWrites = [...writes].sort((a, b) => a.seq - b.seq);
  const result = new Map<number, FileEditEntry[]>();

  let writeIdx = 0;
  for (let i = 0; i < boundaries.length; i++) {
    const { lo, hi } = boundaries[i];
    writeIdx = lowerBound(sortedWrites, lo, writeIdx);

    const stepWrites: FileWriteRecord[] = [];
    while (writeIdx < sortedWrites.length && sortedWrites[writeIdx].seq < hi) {
      stepWrites.push(sortedWrites[writeIdx]);
      writeIdx++;
    }

    if (stepWrites.length > 0) {
      const summary = buildSummaryFromWrites(stepWrites);
      if (summary) result.set(i, summary);
    }
  }

  return result;
}

describe("useFileEditSummaryMap — computeSummaryMap (pure replica)", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
  });

  it("returns undefined when no writes", () => {
    const map = computeSummaryMap([], [{ lo: 0, hi: Infinity }]);
    assert.strictEqual(map, undefined);
  });

  it("returns undefined when no boundaries", () => {
    const writes: FileWriteRecord[] = [
      { path: "/a.ts", content: "x", originalContent: null, seq: 0, contentHash: "h1" },
    ];
    const map = computeSummaryMap(writes, []);
    assert.strictEqual(map, undefined);
  });

  it("assigns writes to correct step indices by boundary", () => {
    const writes: FileWriteRecord[] = [
      { path: "/s1.ts", content: "a", originalContent: null, seq: 0, contentHash: "" },
      { path: "/s2.ts", content: "b", originalContent: null, seq: 1, contentHash: "" },
      { path: "/s3.ts", content: "c", originalContent: null, seq: 2, contentHash: "" },
    ];
    const boundaries = [
      { lo: 0, hi: 1 }, // step 0
      { lo: 1, hi: 2 }, // step 1
      { lo: 2, hi: Infinity }, // step 2
    ];

    const map = computeSummaryMap(writes, boundaries);
    assert.ok(map);
    assert.strictEqual(map!.size, 3);
    assert.strictEqual(map!.get(0)![0].path, "/s1.ts");
    assert.strictEqual(map!.get(1)![0].path, "/s2.ts");
    assert.strictEqual(map!.get(2)![0].path, "/s3.ts");
  });

  it("returns only populated steps (sparse Map)", () => {
    const writes: FileWriteRecord[] = [
      { path: "/a.ts", content: "a", originalContent: null, seq: 0, contentHash: "" },
      // No writes for step 1 (boundary [1,2))
      { path: "/c.ts", content: "c", originalContent: null, seq: 2, contentHash: "" },
    ];
    const boundaries = [
      { lo: 0, hi: 1 },
      { lo: 1, hi: 2 },
      { lo: 2, hi: Infinity },
    ];

    const map = computeSummaryMap(writes, boundaries);
    assert.ok(map);
    assert.strictEqual(map!.size, 2); // only step 0 and step 2 have writes
    assert.ok(map!.has(0));
    assert.ok(!map!.has(1));
    assert.ok(map!.has(2));
  });

  it("omits empty boundaries between populated steps", () => {
    const writes: FileWriteRecord[] = [
      { path: "/first.ts", content: "1", originalContent: null, seq: 0, contentHash: "" },
      { path: "/last.ts", content: "2", originalContent: null, seq: 9, contentHash: "" },
    ];
    const boundaries = [
      { lo: 0, hi: 1 },
      { lo: 1, hi: 2 },
      { lo: 2, hi: 3 },
      { lo: 3, hi: 4 },
      { lo: 4, hi: Infinity }, // seq 9 → here
    ];

    const map = computeSummaryMap(writes, boundaries);
    assert.ok(map);
    assert.strictEqual(map!.size, 2);
    assert.strictEqual(map!.get(0)![0].path, "/first.ts");
    assert.strictEqual(map!.get(4)![0].path, "/last.ts");
  });

  it("merges same-path writes within a single step boundary", () => {
    const writes: FileWriteRecord[] = [
      { path: "/shared.ts", content: "v1", originalContent: null, seq: 0, contentHash: "" },
      { path: "/shared.ts", content: "v2\nv2", originalContent: null, seq: 1, contentHash: "" },
    ];
    const boundaries = [
      { lo: 0, hi: Infinity }, // single boundary covers everything
    ];

    const map = computeSummaryMap(writes, boundaries);
    assert.ok(map);
    assert.strictEqual(map!.get(0)!.length, 1);
    assert.strictEqual(map!.get(0)![0].writtenContent, "v2\nv2");
  });

  it("uses store.getWritesForSession via direct read", () => {
    // Seed store directly
    useFileWriteStore.getState().addWrite("a1", "s1", "/store.ts", "hello");

    // Read from store (simulating what the hook does)
    const key = "a1:s1";
    const writes = useFileWriteStore.getState().writes[key] ?? [];
    const boundaries = [{ lo: 0, hi: Infinity }];

    const map = computeSummaryMap(writes, boundaries);
    assert.ok(map);
    assert.strictEqual(map!.get(0)![0].path, "/store.ts");
    assert.strictEqual(map!.get(0)![0].lineCount, 1);
  });

  it("boundaries param shape matches SessionChatContainer summaryBoundaries", () => {
    // Simulate the exact boundary shape produced by SessionChatContainer:
    // stepsWithSeq → [{ writeSeq: 0 }, { writeSeq: 2 }, ...]
    // finalWriteSeq → 5 → pushes { lo: 5, hi: Infinity }
    useFileWriteStore.getState().addWrite("a1", "s1", "/s0.ts", "z"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/s1.ts", "y"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/s5.ts", "x"); // seq=2

    const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
    const boundaries = [
      { lo: 0, hi: 2 },            // intermediate step 0 [first.writeSeq, second.writeSeq)
      { lo: 2, hi: 5 },            // intermediate step 1 [second.writeSeq, finalWriteSeq)
      { lo: 5, hi: Infinity },     // final step [finalWriteSeq, ∞)
    ];

    const map = computeSummaryMap(writes, boundaries);
    assert.ok(map);
    // writes: seq 0 (/s0.ts), seq 1 (/s1.ts), seq 2 (/s5.ts)
    // boundaries: [0,2) → seq 0,1 → /s0.ts, /s1.ts
    //             [2,5) → seq 2 → /s5.ts
    //             [5,∞) → no writes
    assert.ok(map!.has(0));
    assert.strictEqual(map!.get(0)!.length, 2);
    assert.strictEqual(map!.get(0)![0].path, "/s0.ts");
    assert.strictEqual(map!.get(0)![1].path, "/s1.ts");
    assert.ok(map!.has(1));
    assert.strictEqual(map!.get(1)![0].path, "/s5.ts");
    assert.ok(!map!.has(2));
  });

  it("O(W log W) performance — 1000 writes across 100 steps", () => {
    // Seed 1000 writes across 100 "steps" (10 writes per step)
    const store = useFileWriteStore.getState();
    for (let i = 0; i < 1000; i++) {
      store.addWrite("a1", "s1", `/f${i}.ts`, `content${i}`);
    }
    const writes = store.getWritesForSession("a1", "s1");

    // Create 110 boundaries (100 real + 10 extra to simulate mixed scenario)
    const boundaries: { lo: number; hi: number }[] = [];
    for (let i = 0; i < 100; i++) {
      boundaries.push({ lo: i * 10, hi: (i + 1) * 10 });
    }
    boundaries.push({ lo: 1000, hi: Infinity }); // final step (empty)

    const start = Date.now();
    const map = computeSummaryMap(writes, boundaries);
    const elapsed = Date.now() - start;

    assert.ok(map);
    // Some steps should have writes
    assert.ok(map!.size > 0);
    assert.ok(elapsed < 1000, `computeSummaryMap took ${elapsed}ms (expected <1000ms for 1000 writes + 101 boundaries)`);
  });
});

// ── Hook integration: useFileEditSummaryMap exports are callable ──────────

describe("useFileEditSummaryMap — import verification", () => {
  it("hook module can be imported without errors", async () => {
    // Dynamic import to verify the module is syntactically valid
    // (we can't render hooks outside React, but we can verify the module loads)
    await import("../../../hooks/useFileEditSummaryMap.js");
    // No error thrown
  });

  it("fileWriteStore is Zustand-based and supports getState/setState", () => {
    // Verify the store contract the hook depends on
    assert.strictEqual(typeof useFileWriteStore.getState, "function");
    assert.strictEqual(typeof useFileWriteStore.setState, "function");
    assert.ok(useFileWriteStore.getState().writes !== undefined);
    assert.ok(useFileWriteStore.getState().addWrite !== undefined);
    assert.ok(useFileWriteStore.getState().getWritesForSession !== undefined);
  });
});
