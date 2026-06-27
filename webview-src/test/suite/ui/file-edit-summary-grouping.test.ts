import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import type { PipelineItem, ChatDisplayItem, IntermediateStep } from "../../../pipeline/types";
import { IntermediateStepGrouper } from "../../../pipeline/stages/grouping";

let keyCounter = 0;
function nextKey(prefix: string): string {
  return `${prefix}-${++keyCounter}`;
}

function userMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "user", agentId: "a1", sessionId: "s1",
    content, key: nextKey("user"),
    timestamp: Date.now(), isConsecutive: false, groupKey: "user",
    attachments: [], thinking: undefined, ...overrides,
  };
}

function agentMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "agent", agentId: "a1", sessionId: "s1",
    content, key: nextKey("agent"),
    timestamp: Date.now(), isConsecutive: false, groupKey: "agent:a1",
    attachments: [], thinking: undefined, ...overrides,
  };
}

describe("groupByUserBoundary — per-step file edit summary", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
    keyCounter = 0;
  });

  it("partitions writes across steps by writeSeq", () => {
    // Step1 agent created when 0 writes recorded (writeSeq=0).
    // Then writes seq 0,1 happen during step1.
    // Step2 agent created when 2 writes recorded (writeSeq=2).
    // Then writes seq 2,3 happen during step2 (final).
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aaa");   // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "bbb");   // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "ccc");   // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/d.ts", "ddd\nl");// seq=3

    const items: PipelineItem[] = [
      userMsg("multi-step"),
      agentMsg("step 1", { isConsecutive: false, writeSeq: 0 }),
      agentMsg("step 2 (final)", { isConsecutive: false, writeSeq: 2, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    const steps = result.latestGroup!.steps;
    assert.strictEqual(steps.length, 1);

    // Step 1: writes seq in [0,2) → seq 0,1 → /a.ts, /b.ts
    assert.strictEqual(steps[0].agentMessage?.content, "step 1");
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 2);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/a.ts");
    assert.strictEqual(steps[0].fileEditSummary![1].path, "/b.ts");

    // Final step: writes seq in [2,∞) → seq 2,3 → /c.ts, /d.ts
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs);
    assert.ok(cs.fileEditSummary);
    assert.strictEqual(cs.fileEditSummary!.length, 2);
    assert.strictEqual(cs.fileEditSummary![0].path, "/c.ts");
    assert.strictEqual(cs.fileEditSummary![1].path, "/d.ts");
    assert.strictEqual(cs.fileEditSummary![1].lineCount, 2);
  });

  it("assigns writes to the step whose writeSeq bound contains them", () => {
    // streamStart stamps writeSeq=0 before any writes arrive
    // then write seq=0 happens during this step
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "line1\nline2"); // seq=0

    const items: PipelineItem[] = [
      userMsg("edit foo"),
      agentMsg("done!", { isConsecutive: false, writeSeq: 0, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // No intermediate steps; summary is on currentStep
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs);
    assert.ok(cs.fileEditSummary);
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/foo.ts");
    assert.strictEqual(cs.fileEditSummary![0].lineCount, 2);
  });

  it("omits fileEditSummary on steps with no writes", () => {
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("hi!", { isConsecutive: false, writeSeq: 0, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    for (const step of result.latestGroup!.steps) {
      assert.strictEqual(step.fileEditSummary, undefined);
    }
    assert.strictEqual(result.latestGroup!.currentStep?.fileEditSummary, undefined);
  });

  it("clearing store before grouping omits all summaries", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "hello");
    useFileWriteStore.getState().clearSession("a1", "s1");

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("done!", { isConsecutive: false, writeSeq: 1, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    for (const step of result.latestGroup?.steps ?? []) {
      assert.strictEqual(step.fileEditSummary, undefined);
    }
    assert.strictEqual(result.latestGroup?.currentStep?.fileEditSummary, undefined);
  });

  it("multiple intermediate steps each get their own writes", () => {
    // Step1 writeSeq=0: writes seq 0,1
    useFileWriteStore.getState().addWrite("a1", "s1", "/a1.ts", "a1");     // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/a2.ts", "a2\na2"); // seq=1
    // Step2 writeSeq=2: writes seq 2,3
    useFileWriteStore.getState().addWrite("a1", "s1", "/b1.ts", "b1");     // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/b2.ts", "b2");     // seq=3
    // Final writeSeq=4: writes seq 4
    useFileWriteStore.getState().addWrite("a1", "s1", "/c1.ts", "c1");     // seq=4

    const items: PipelineItem[] = [
      userMsg("multi"),
      agentMsg("step1", { isConsecutive: false, writeSeq: 0 }),
      agentMsg("step2", { isConsecutive: true, writeSeq: 2 }),
      agentMsg("final", { isConsecutive: false, writeSeq: 4, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    const steps = result.latestGroup!.steps;
    assert.strictEqual(steps.length, 2);

    // Step 1: writes seq in [0,2) → /a1.ts, /a2.ts
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 2);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/a1.ts");
    assert.strictEqual(steps[0].fileEditSummary![1].lineCount, 2); // "a2\na2" = 2 lines

    // Step 2: writes seq in [2,4) → /b1.ts, /b2.ts
    assert.ok(steps[1].fileEditSummary);
    assert.strictEqual(steps[1].fileEditSummary!.length, 2);
    assert.strictEqual(steps[1].fileEditSummary![0].path, "/b1.ts");

    // CurrentStep (final): writes seq in [4,∞) → /c1.ts
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs);
    assert.ok(cs.fileEditSummary);
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/c1.ts");
  });

  it("merges multiple writes to the same path within a step", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "line1\nline2"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "line3");         // seq=1

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("done!", { isConsecutive: false, writeSeq: 0, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    const cs = result.latestGroup!.currentStep;
    assert.ok(cs?.fileEditSummary);
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].lineCount, 3); // 2 + 1
  });

  // ── turnFileEditSummary: full-turn aggregate ──────────────────────────

  it("populates turnFileEditSummary with all writes for the turn", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aaa"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "bbb"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "ccc"); // seq=2

    const items: PipelineItem[] = [
      userMsg("edit many"),
      agentMsg("step1", { isConsecutive: false, writeSeq: 0 }),
      agentMsg("final", { isConsecutive: false, writeSeq: 2, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 3);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary![0].path, "/a.ts");
    assert.strictEqual(result.latestGroup!.turnFileEditSummary![1].path, "/b.ts");
    assert.strictEqual(result.latestGroup!.turnFileEditSummary![2].path, "/c.ts");
  });

  it("merges same-path writes across all steps in turnFileEditSummary", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "line1\nline2"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/bar.ts", "bb");           // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "line3");        // seq=2

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("step1", { isConsecutive: false, writeSeq: 0 }),
      agentMsg("final", { isConsecutive: false, writeSeq: 2, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 2);
    const fooEntry = result.latestGroup!.turnFileEditSummary!.find(e => e.path === "/foo.ts");
    const barEntry = result.latestGroup!.turnFileEditSummary!.find(e => e.path === "/bar.ts");
    assert.ok(fooEntry);
    assert.ok(barEntry);
    assert.strictEqual(fooEntry!.lineCount, 3); // 2 + 1 merged across steps
    assert.strictEqual(barEntry!.lineCount, 1);
  });

  it("omits turnFileEditSummary when no writes exist", () => {
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("hi!", { isConsecutive: false, writeSeq: 0, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.strictEqual(result.latestGroup!.turnFileEditSummary, undefined);
  });

  it("populates turnFileEditSummary on past groups too", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/old.ts", "old"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/new.ts", "new"); // seq=1

    const items: PipelineItem[] = [
      userMsg("q1"),
      agentMsg("a1", { isConsecutive: false, writeSeq: 0, stopReason: "end_turn" }),
      userMsg("q2"),
      agentMsg("a2", { isConsecutive: false, writeSeq: 1, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // Past group (q1): both writes are in the store for session a1:s1,
    // so turnFileEditSummary includes all writes (seq 0 + 1).
    assert.ok(result.groups[0].turnFileEditSummary);
    assert.strictEqual(result.groups[0].turnFileEditSummary!.length, 2);

    // Latest group (q2): same session, same store — both writes visible
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 2);
  });

  // ── turnFileEditSummary: additional edge cases ────────────────────

  it("turnFileEditSummary coexists with per-step fileEditSummary on currentStep", () => {
    // Writes across two steps, each attributed to their own step via writeSeq,
    // but turnFileEditSummary merges ALL writes regardless of step partitioning.
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aaa"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "bbb"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "ccc"); // seq=2

    const items: PipelineItem[] = [
      userMsg("multi"),
      agentMsg("step1", { isConsecutive: false, writeSeq: 0 }),
      agentMsg("final", { isConsecutive: false, writeSeq: 2, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // Per-step: step1 has /a.ts + /b.ts, currentStep has /c.ts
    const steps = result.latestGroup!.steps;
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 2);

    const cs = result.latestGroup!.currentStep;
    assert.ok(cs?.fileEditSummary);
    assert.strictEqual(cs.fileEditSummary!.length, 1);

    // Turn-level: ALL 3 files merged
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 3);
  });

  it("turnFileEditSummary preserves Map insertion order (first-seen path first)", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/z.ts", "zz"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aa"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/m.ts", "mm"); // seq=2

    const items: PipelineItem[] = [
      userMsg("order"),
      agentMsg("f", { isConsecutive: false, writeSeq: 0, stopReason: "end_turn" }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.ok(result.latestGroup!.turnFileEditSummary);
    const paths = result.latestGroup!.turnFileEditSummary!.map(e => e.path);
    assert.deepStrictEqual(paths, ["/z.ts", "/a.ts", "/m.ts"]);
  });

  it("turnFileEditSummary isolates writes across different sessions", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "f"); // seq=0
    useFileWriteStore.getState().addWrite("a2", "s2", "/bar.ts", "b"); // seq=1

    // Group for session a1:s1 — should NOT see a2:s2 writes
    const items1: PipelineItem[] = [
      { type: "chat", role: "user", agentId: "a1", sessionId: "s1",
        content: "q1", key: "u1", timestamp: Date.now(),
        isConsecutive: false, groupKey: "user", attachments: [], thinking: undefined } as ChatDisplayItem,
      { type: "chat", role: "agent", agentId: "a1", sessionId: "s1",
        content: "a1", key: "a1", timestamp: Date.now(),
        isConsecutive: false, groupKey: "agent:a1", attachments: [], thinking: undefined,
        writeSeq: 0, stopReason: "end_turn" } as ChatDisplayItem,
    ];
    const result1 = new IntermediateStepGrouper(items1).compute();
    assert.ok(result1.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result1.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(result1.latestGroup!.turnFileEditSummary![0].path, "/foo.ts");

    // Group for session a2:s2 — should NOT see a1:s1 writes
    const items2: PipelineItem[] = [
      { type: "chat", role: "user", agentId: "a2", sessionId: "s2",
        content: "q2", key: "u2", timestamp: Date.now(),
        isConsecutive: false, groupKey: "user", attachments: [], thinking: undefined } as ChatDisplayItem,
      { type: "chat", role: "agent", agentId: "a2", sessionId: "s2",
        content: "a2", key: "a2", timestamp: Date.now(),
        isConsecutive: false, groupKey: "agent:a2", attachments: [], thinking: undefined,
        writeSeq: 1, stopReason: "end_turn" } as ChatDisplayItem,
    ];
    const result2 = new IntermediateStepGrouper(items2).compute();
    assert.ok(result2.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result2.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(result2.latestGroup!.turnFileEditSummary![0].path, "/bar.ts");
  });
});
