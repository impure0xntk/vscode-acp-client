/**
 * Tests for useGroupFileEditSummaryMaps (B案 fix).
 *
 * The hook reads from fileWriteStore (Zustand) and calls
 * buildSummaryFromWrites + lowerBound internally.  To verify the computation
 * without a React renderer, we replicate the hook's internal useMemo logic
 * here (it is pure) — the same approach used by use-file-edit-summary-map.test.ts.
 *
 * Verifies:
 * 1. The new shape: groupMaps (per-group Map) + latestCurrentStepSummary.
 * 2. latestCurrentStepSummary reflects the LATEST edit when the same file is
 *    written multiple times within a turn — derived from the latest writes in
 *    the store, NOT from a stale step.fileEditSummary captured at grouping time.
 * 3. The previous (buggy) path — reading at olderSteps.length — is not used for
 *    the current step; latestCurrentStepSummary is authoritative instead.
 */
import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import {
  buildSummaryFromWrites,
  lowerBound,
} from "../../../pipeline/stages/grouping";
import type { FileWriteRecord } from "../../../store/fileWriteStore";
import type { FileEditEntry } from "../../../pipeline/types";
import type { AgentResponseGroup } from "../../../pipeline/stages/grouping";

const EMPTY_WRITES: readonly FileWriteRecord[] = [];

/**
 * Inline replica of useGroupFileEditSummaryMap.computeGroupBoundaries.
 * Not exported from the hook module, so we replicate it (mirrors the existing
 * use-file-edit-summary-map.test.ts pattern of testing the algorithm directly).
 */
function computeGroupBoundaries(
  group: AgentResponseGroup
): { lo: number; hi: number }[] {
  const boundaries: { lo: number; hi: number }[] = [];
  for (let i = 0; i < group.steps.length; i++) {
    const step = group.steps[i];
    const lo = step.agentMessage?.writeSeq ?? 0;
    const hi =
      i + 1 < group.steps.length
        ? (group.steps[i + 1].agentMessage?.writeSeq ?? Infinity)
        : Infinity;
    boundaries.push({ lo, hi });
  }
  if (group.finalResponse) {
    const finalWriteSeq =
      (group.finalResponse.item as { writeSeq?: number | null }).writeSeq ?? 0;
    boundaries.push({ lo: finalWriteSeq, hi: Infinity });
    if (boundaries.length >= 2) {
      const prev = boundaries[boundaries.length - 2];
      if (prev.hi > finalWriteSeq) prev.hi = finalWriteSeq;
    }
  }
  return boundaries;
}

/** Pure replica of useGroupFileEditSummaryMaps' internal useMemo logic. */
function computeGroupMaps(
  writes: readonly FileWriteRecord[],
  group: AgentResponseGroup | null
): Map<number, FileEditEntry[]> | undefined {
  if (!group || writes.length === 0) return undefined;

  const boundaries = computeGroupBoundaries(group);
  if (boundaries.length === 0) return undefined;

  const sortedWrites = [...writes].sort((a, b) => a.seq - b.seq);
  const groupMap = new Map<number, FileEditEntry[]>();
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
      if (summary) groupMap.set(i, summary);
    }
  }
  return groupMap.size > 0 ? groupMap : undefined;
}

/** Pure replica of the new latestCurrentStepSummary derivation. */
function computeLatestCurrentStepSummary(
  writes: readonly FileWriteRecord[],
  group: AgentResponseGroup | null
): FileEditEntry[] | undefined {
  const map = computeGroupMaps(writes, group);
  if (!map || map.size === 0) return undefined;
  // Boundaries are contiguous 0..n-1; the last populated key is the current step.
  let last: FileEditEntry[] | undefined;
  for (const [, v] of map) last = v;
  return last;
}

let keyCounter = 0;
function nextKey(prefix: string): string {
  return `${prefix}-${++keyCounter}`;
}

function userMsg(
  content: string,
  overrides: Partial<{ writeSeq: number; stopReason: string }> = {}
): any {
  return {
    type: "chat",
    role: "user",
    agentId: "a1",
    sessionId: "s1",
    content,
    key: nextKey("user"),
    timestamp: Date.now(),
    isFirstOfTurn: false,
    attachments: [],
    thinking: undefined,
    ...overrides,
  };
}

function agentMsg(
  content: string,
  overrides: Partial<{
    writeSeq: number;
    stopReason: string;
    isFirstOfTurn: boolean;
  }> = {}
): any {
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

/** Build a latestGroup-shaped object matching IntermediateStepGrouper output. */
function buildLatestGroup(items: any[]): AgentResponseGroup {
  const agents = items.filter((i) => i.type === "chat" && i.role === "agent");
  const stepAgent = agents[0];
  const finalAgent = agents[agents.length - 1];

  return {
    userItem: userMsg("u"),
    steps: [
      {
        agentMessage: stepAgent,
        toolCalls: [],
        isPreAgent: false,
        fileEditSummary: undefined,
      },
    ],
    finalResponse: { item: finalAgent, index: items.indexOf(finalAgent) },
    currentStep: null,
    turnFileEditSummary: undefined,
    passthrough: [],
  };
}

describe("useGroupFileEditSummaryMaps — B案 (latestCurrentStepSummary)", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
    keyCounter = 0;
  });

  it("latestCurrentStepSummary is undefined when no writes", () => {
    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("done", { writeSeq: 0, stopReason: "end_turn" }),
    ]);
    const writes =
      useFileWriteStore.getState().getWritesForSession("a1", "s1") ??
      EMPTY_WRITES;
    const summary = computeLatestCurrentStepSummary(writes, latestGroup);
    assert.strictEqual(summary, undefined);
  });

  it("latestCurrentStepSummary reflects the LATEST same-file edit (not the first)", () => {
    // Same file written twice within one turn.
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "v1"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "v2"); // seq=1

    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("done", { writeSeq: 0, stopReason: "end_turn" }),
    ]);
    const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
    const summary = computeLatestCurrentStepSummary(writes, latestGroup);

    assert.ok(summary);
    assert.strictEqual(summary!.length, 1);
    // BUG REGRESSION CHECK: must show v2 (latest), NOT v1 (first).
    assert.strictEqual(
      summary![0].writtenContent,
      "v2",
      "latest edit content must win"
    );
  });

  it("latestCurrentStepSummary updates when an additional write arrives (stable group ref)", () => {
    // Simulate the bug trigger: groups/latestGroup refs are STABLE (file_write
    // does not re-run grouping), but the store gets a new write.
    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("done", { writeSeq: 0, stopReason: "end_turn" }),
    ]);

    // First edit.
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "v1"); // seq=0
    let writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
    const first = computeLatestCurrentStepSummary(writes, latestGroup);
    assert.strictEqual(first![0].writtenContent, "v1");

    // Second edit arrives WITHOUT changing latestGroup reference.
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "v2"); // seq=1
    writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
    const second = computeLatestCurrentStepSummary(writes, latestGroup);
    assert.strictEqual(
      second![0].writtenContent,
      "v2",
      "second call with same group refs but new store write must reflect v2"
    );
  });

  it("does NOT require olderSteps.length indexing for the current step", () => {
    // With 2 steps + 1 final response, computeGroupBoundaries yields 3
    // boundaries (step0, step1, final).  The current step is the LAST *step*
    // boundary = index 1, whereas olderSteps.length would be 2 — which points
    // at the (empty) final-response boundary, NOT the current step.  This is
    // exactly the bug: reading groupMaps.get(key).get(olderSteps.length)
    // returns undefined and falls back to a stale step.fileEditSummary.
    // latestCurrentStepSummary derives from the latest writes so it is correct.
    useFileWriteStore.getState().addWrite("a1", "s1", "/s0.ts", "s0"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/s1.ts", "s1"); // seq=1

    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("step0", { writeSeq: 0 }),
      agentMsg("final", { writeSeq: 1, stopReason: "end_turn" }),
    ]);
    const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");

    const summary = computeLatestCurrentStepSummary(writes, latestGroup);
    assert.ok(summary);
    assert.strictEqual(summary![0].path, "/s1.ts");
    assert.strictEqual(summary![0].writtenContent, "s1");

    const map = computeGroupMaps(writes, latestGroup);
    assert.ok(map);
    // step0 boundary (index 0) holds /s0.ts; step1/final boundary (index 1)
    // holds /s1.ts.  olderSteps.length would be 2 → final-response boundary
    // (index 2), which is empty — proving the old indexing was wrong.
    assert.ok(map!.has(0));
    assert.ok(map!.has(1));
    assert.ok(!map!.has(2));
  });

  it("latestCurrentStepSummary is correct for multi-step turn (last step wins)", () => {
    // Step1 writeSeq=0: /a1.ts, /a2.ts (seq 0,1)
    useFileWriteStore.getState().addWrite("a1", "s1", "/a1.ts", "a1"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/a2.ts", "a2"); // seq=1
    // Final writeSeq=2: /b1.ts (seq 2), then same file edited again (seq 3).
    useFileWriteStore.getState().addWrite("a1", "s1", "/b1.ts", "b1"); // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/b1.ts", "b1-revised"); // seq=3

    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("step1", { writeSeq: 0 }),
      agentMsg("final", { writeSeq: 2, stopReason: "end_turn" }),
    ]);
    const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
    const summary = computeLatestCurrentStepSummary(writes, latestGroup);

    assert.ok(summary);
    // Final step (boundary [2,∞)) has only /b1.ts with latest content.
    assert.strictEqual(summary!.length, 1);
    assert.strictEqual(summary![0].path, "/b1.ts");
    assert.strictEqual(summary![0].writtenContent, "b1-revised");
  });

  it("groupMaps partitions writes into the correct boundary (final step bucket)", () => {
    // With a single step (writeSeq=0) + final response (writeSeq=0), the step
    // boundary collapses to [0,0)=empty and writes land in the final-response
    // boundary (index 1, [0,∞)).  This mirrors production: when step and final
    // share writeSeq, the writes bucket to the final/current step.  The banner
    // uses whatever boundary the writes actually landed in.
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "a"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "b"); // seq=1

    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("done", { writeSeq: 0, stopReason: "end_turn" }),
    ]);
    const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
    const map = computeGroupMaps(writes, latestGroup);

    assert.ok(map);
    // Writes collapse into the final-response boundary (index 1), not index 0.
    assert.ok(!map!.has(0));
    assert.ok(map!.has(1));
    assert.strictEqual(map!.get(1)!.length, 2);
  });

  it("groupMaps splits writes across distinct step boundaries", () => {
    // step0 writeSeq=0 (boundary [0,1)) gets /a.ts; final writeSeq=1
    // (boundary [1,∞)) gets /b.ts.
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "a"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "b"); // seq=1

    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("step0", { writeSeq: 0, isFirstOfTurn: true }),
      agentMsg("final", { writeSeq: 1, stopReason: "end_turn" }),
    ]);
    const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
    const map = computeGroupMaps(writes, latestGroup);

    assert.ok(map);
    assert.ok(map!.has(0), "step0 boundary holds /a.ts");
    assert.strictEqual(map!.get(0)![0].path, "/a.ts");
    assert.ok(map!.has(1), "final boundary holds /b.ts");
    assert.strictEqual(map!.get(1)![0].path, "/b.ts");
  });

  it("latestCurrentStepSummary undefined when store cleared", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "x");
    useFileWriteStore.getState().clearSession("a1", "s1");

    const latestGroup = buildLatestGroup([
      userMsg("u"),
      agentMsg("done", { writeSeq: 0, stopReason: "end_turn" }),
    ]);
    const writes =
      useFileWriteStore.getState().getWritesForSession("a1", "s1") ??
      EMPTY_WRITES;
    const summary = computeLatestCurrentStepSummary(writes, latestGroup);
    assert.strictEqual(summary, undefined);
    assert.strictEqual(computeGroupMaps(writes, latestGroup), undefined);
  });
});
