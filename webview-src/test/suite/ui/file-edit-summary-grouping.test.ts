import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import type {
  PipelineItem,
  ChatDisplayItem,
  IntermediateStep,
} from "../../../pipeline/types";
import { IntermediateStepGrouper } from "../../../pipeline/stages/grouping";

let keyCounter = 0;
function nextKey(prefix: string): string {
  return `${prefix}-${++keyCounter}`;
}

function userMsg(
  content: string,
  overrides: Partial<ChatDisplayItem> = {}
): ChatDisplayItem {
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
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aaa"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "bbb"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "ccc"); // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/d.ts", "ddd\nl"); // seq=3

    const items: PipelineItem[] = [
      userMsg("multi-step"),
      agentMsg("step 1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("step 2 (final)", {
        isFirstOfTurn: false,
        writeSeq: 2,
        stopReason: "end_turn",
      }),
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

    // Final step (currentStep): writes seq in [2,∞) → /c.ts, /d.ts
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist (synthetic from finalStepSummary)");
    assert.ok(
      cs.fileEditSummary,
      "currentStep should carry fileEditSummary for final step writes"
    );
    assert.strictEqual(cs.fileEditSummary!.length, 2);
    assert.strictEqual(cs.fileEditSummary![0].path, "/c.ts");
    assert.strictEqual(cs.fileEditSummary![1].path, "/d.ts");

    // turnFileEditSummary merges ALL writes across all steps
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 4);
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].path,
      "/a.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![1].path,
      "/b.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![2].path,
      "/c.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![3].path,
      "/d.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![3].lineCount,
      2
    );
  });

  it("assigns writes to the step whose writeSeq bound contains them", () => {
    // streamStart stamps writeSeq=0 before any writes arrive
    // then write seq=0 happens during this step
    useFileWriteStore
      .getState()
      .addWrite("a1", "s1", "/foo.ts", "line1\nline2"); // seq=0

    const items: PipelineItem[] = [
      userMsg("edit foo"),
      agentMsg("done!", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // No intermediate steps; currentStep is synthetic with fileEditSummary
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist (synthetic from finalStepSummary)");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/foo.ts");
    assert.strictEqual(cs.fileEditSummary![0].lineCount, 2);

    // turnFileEditSummary contains all writes for the turn
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].path,
      "/foo.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].lineCount,
      2
    );
  });

  it("omits fileEditSummary on steps with no writes", () => {
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("hi!", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    for (const step of result.latestGroup!.steps) {
      assert.strictEqual(step.fileEditSummary, undefined);
    }
    // currentStep is null when no writes exist
    assert.strictEqual(result.latestGroup!.currentStep, null);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary, undefined);
  });

  it("clearing store before grouping omits all summaries", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "hello");
    useFileWriteStore.getState().clearSession("a1", "s1");

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("done!", {
        isFirstOfTurn: false,
        writeSeq: 1,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    for (const step of result.latestGroup?.steps ?? []) {
      assert.strictEqual(step.fileEditSummary, undefined);
    }
    assert.strictEqual(
      result.latestGroup?.currentStep?.fileEditSummary,
      undefined
    );
    assert.strictEqual(result.latestGroup?.turnFileEditSummary, undefined);
  });

  it("multiple intermediate steps each get their own writes", () => {
    // Step1 writeSeq=0: writes seq 0,1
    useFileWriteStore.getState().addWrite("a1", "s1", "/a1.ts", "a1"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/a2.ts", "a2\na2"); // seq=1
    // Step2 writeSeq=2: writes seq 2,3
    useFileWriteStore.getState().addWrite("a1", "s1", "/b1.ts", "b1"); // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/b2.ts", "b2"); // seq=3
    // Final writeSeq=4: writes seq 4
    useFileWriteStore.getState().addWrite("a1", "s1", "/c1.ts", "c1"); // seq=4

    const items: PipelineItem[] = [
      userMsg("multi"),
      agentMsg("step1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("step2", { isFirstOfTurn: true, writeSeq: 2 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 4,
        stopReason: "end_turn",
      }),
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

    // CurrentStep (final): carries fileEditSummary for writes in [4,∞) → /c1.ts
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/c1.ts");

    // turnFileEditSummary merges ALL writes across all steps
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 5);
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].path,
      "/a1.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![4].path,
      "/c1.ts"
    );
  });

  it("merges multiple writes to the same path within a step", () => {
    // When the same path is written twice, the latest content is diffed against
    // the original (null → ""). "line3" = 1 line added.
    useFileWriteStore
      .getState()
      .addWrite("a1", "s1", "/foo.ts", "line1\nline2"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "line3"); // seq=1

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("done!", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // currentStep carries fileEditSummary (synthetic from finalStepSummary)
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    // lineCount = diff(null, "line3") = 1 line
    assert.strictEqual(cs.fileEditSummary![0].lineCount, 1);
    assert.strictEqual(cs.fileEditSummary![0].writtenContent, "line3");

    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].lineCount,
      1
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].writtenContent,
      "line3"
    );
  });

  // ── turnFileEditSummary: full-turn aggregate ──────────────────────────

  it("populates turnFileEditSummary with all writes for the turn", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aaa"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "bbb"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "ccc"); // seq=2

    const items: PipelineItem[] = [
      userMsg("edit many"),
      agentMsg("step1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 2,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 3);
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].path,
      "/a.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![1].path,
      "/b.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![2].path,
      "/c.ts"
    );
  });

  it("merges same-path writes across all steps in turnFileEditSummary", () => {
    // Two writes to /foo.ts: first "line1\nline2" (seq=0), then "line3" (seq=2).
    // latest writtenContent = "line3" → diff(null, "line3") = 1 line.
    useFileWriteStore
      .getState()
      .addWrite("a1", "s1", "/foo.ts", "line1\nline2"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/bar.ts", "bb"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "line3"); // seq=2

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("step1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 2,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 2);
    const fooEntry = result.latestGroup!.turnFileEditSummary!.find(
      (e) => e.path === "/foo.ts"
    );
    const barEntry = result.latestGroup!.turnFileEditSummary!.find(
      (e) => e.path === "/bar.ts"
    );
    assert.ok(fooEntry);
    assert.ok(barEntry);
    // lineCount = diff(null, "line3") = 1 line (latest content)
    assert.strictEqual(fooEntry!.lineCount, 1);
    assert.strictEqual(fooEntry!.writtenContent, "line3");
    assert.strictEqual(barEntry!.lineCount, 1);
  });

  it("omits turnFileEditSummary when no writes exist", () => {
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("hi!", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.strictEqual(result.latestGroup!.turnFileEditSummary, undefined);
  });

  it("populates turnFileEditSummary on past groups too", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/old.ts", "old"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/new.ts", "new"); // seq=1

    const items: PipelineItem[] = [
      userMsg("q1"),
      agentMsg("a1", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
      userMsg("q2"),
      agentMsg("a2", {
        isFirstOfTurn: false,
        writeSeq: 1,
        stopReason: "end_turn",
      }),
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

  it("turnFileEditSummary shows all writes after turn completes", () => {
    // Writes across two steps, each attributed to their own step via writeSeq,
    // but turnFileEditSummary merges ALL writes regardless of step partitioning.
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aaa"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "bbb"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "ccc"); // seq=2

    const items: PipelineItem[] = [
      userMsg("multi"),
      agentMsg("step1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 2,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // Per-step: step1 has /a.ts + /b.ts
    const steps = result.latestGroup!.steps;
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 2);

    // currentStep carries fileEditSummary (final step writes seq in [2,∞))
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/c.ts");

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
      agentMsg("f", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.ok(result.latestGroup!.turnFileEditSummary);
    const paths = result.latestGroup!.turnFileEditSummary!.map((e) => e.path);
    assert.deepStrictEqual(paths, ["/z.ts", "/a.ts", "/m.ts"]);
  });

  it("turnFileEditSummary isolates writes across different sessions", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "f"); // seq=0
    useFileWriteStore.getState().addWrite("a2", "s2", "/bar.ts", "b"); // seq=1

    // Group for session a1:s1 — should NOT see a2:s2 writes
    const items1: PipelineItem[] = [
      {
        type: "chat",
        role: "user",
        agentId: "a1",
        sessionId: "s1",
        content: "q1",
        key: "u1",
        timestamp: Date.now(),
        isFirstOfTurn: false,
        attachments: [],
        thinking: undefined,
      } as ChatDisplayItem,
      {
        type: "chat",
        role: "agent",
        agentId: "a1",
        sessionId: "s1",
        content: "a1",
        key: "a1",
        timestamp: Date.now(),
        isFirstOfTurn: false,
        attachments: [],
        thinking: undefined,
        writeSeq: 0,
        stopReason: "end_turn",
      } as ChatDisplayItem,
    ];
    const result1 = new IntermediateStepGrouper(items1).compute();
    assert.ok(result1.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result1.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(
      result1.latestGroup!.turnFileEditSummary![0].path,
      "/foo.ts"
    );

    // Group for session a2:s2 — should NOT see a1:s1 writes
    const items2: PipelineItem[] = [
      {
        type: "chat",
        role: "user",
        agentId: "a2",
        sessionId: "s2",
        content: "q2",
        key: "u2",
        timestamp: Date.now(),
        isFirstOfTurn: false,
        attachments: [],
        thinking: undefined,
      } as ChatDisplayItem,
      {
        type: "chat",
        role: "agent",
        agentId: "a2",
        sessionId: "s2",
        content: "a2",
        key: "a2",
        timestamp: Date.now(),
        isFirstOfTurn: false,
        attachments: [],
        thinking: undefined,
        writeSeq: 1,
        stopReason: "end_turn",
      } as ChatDisplayItem,
    ];
    const result2 = new IntermediateStepGrouper(items2).compute();
    assert.ok(result2.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result2.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(
      result2.latestGroup!.turnFileEditSummary![0].path,
      "/bar.ts"
    );
  });

  // ── currentStep.fileEditSummary: undefined when finalResponse exists ──

  it("currentStep has no fileEditSummary when finalResponse exists with writes", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/x.ts", "xx"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/y.ts", "yy"); // seq=1

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("done!", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // currentStep carries fileEditSummary (synthetic from finalStepSummary)
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 2);

    // turnFileEditSummary carries the aggregate
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 2);
  });

  it("currentStep is null when finalResponse exists with no writes", () => {
    // When there are no writes, finalStepSummary is undefined → no synthetic currentStep
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("hi!", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // currentStep is null because finalStepSummary is undefined (no writes)
    assert.strictEqual(result.latestGroup!.currentStep, null);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary, undefined);
  });

  it("with multiple consecutive agent messages, last is final with fileEditSummary", () => {
    // Streaming scenario: multiple consecutive agent messages, fallback picks last as final.
    // Both have writeSeq=0; the write collapses into the final step via boundary fix.
    useFileWriteStore.getState().addWrite("a1", "s1", "/s.ts", "ss"); // seq=0

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("thinking...", { isFirstOfTurn: true, writeSeq: 0 }),
      agentMsg("working...", { isFirstOfTurn: true, writeSeq: 0 }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // Final response is the last consecutive agent (fallback)
    assert.ok(result.latestGroup!.finalResponse);
    assert.strictEqual(
      (result.latestGroup!.finalResponse!.item as ChatDisplayItem).content,
      "working..."
    );

    // Intermediate step ("thinking...") is in steps array
    const steps = result.latestGroup!.steps;
    assert.ok(steps.length >= 1);

    // currentStep carries fileEditSummary (boundary collapse → writes go to final step)
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/s.ts");

    // turnFileEditSummary has the write
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].path,
      "/s.ts"
    );
  });

  // ── turnFileEditSummary: comprehensive aggregation ───────────────────

  it("turnFileEditSummary includes writes from all steps including final", () => {
    // Intermediate step writes
    useFileWriteStore.getState().addWrite("a1", "s1", "/step1-a.ts", "a1"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/step1-b.ts", "b1\nb1"); // seq=1
    // Final step writes
    useFileWriteStore.getState().addWrite("a1", "s1", "/final-a.ts", "fa"); // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/final-b.ts", "fb\nfb"); // seq=3

    const items: PipelineItem[] = [
      userMsg("multi"),
      agentMsg("intermediate", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 2,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // Per-step: intermediate has 2 files
    const steps = result.latestGroup!.steps;
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 2);

    // currentStep carries fileEditSummary (final step writes seq in [2,∞))
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 2);
    assert.strictEqual(cs.fileEditSummary![0].path, "/final-a.ts");

    // turnFileEditSummary: ALL 4 files
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 4);
    const paths = result.latestGroup!.turnFileEditSummary!.map((e) => e.path);
    assert.deepStrictEqual(paths, [
      "/step1-a.ts",
      "/step1-b.ts",
      "/final-a.ts",
      "/final-b.ts",
    ]);
  });

  it("turnFileEditSummary merges same-path writes across all steps with correct lineCount", () => {
    // Same path written multiple times; latest content wins for diff.
    // First: "line1\nline2", then "line3", finally "line4\nline5".
    // diff(null, "line4\nline5") = 2 lines.
    useFileWriteStore
      .getState()
      .addWrite("a1", "s1", "/shared.ts", "line1\nline2"); // seq=0 (intermediate)
    useFileWriteStore.getState().addWrite("a1", "s1", "/shared.ts", "line3"); // seq=1 (intermediate)
    useFileWriteStore
      .getState()
      .addWrite("a1", "s1", "/shared.ts", "line4\nline5"); // seq=2 (final)

    const items: PipelineItem[] = [
      userMsg("edit shared"),
      agentMsg("step1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 2,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // turnFileEditSummary: 1 entry for /shared.ts, lineCount = diff(null, "line4\nline5") = 2
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 1);
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].path,
      "/shared.ts"
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].lineCount,
      2
    );
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].writtenContent,
      "line4\nline5"
    );
  });

  it("turnFileEditSummary uses later writtenContent for same-path merges", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/f.ts", "version1"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/f.ts", "version2"); // seq=1

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("done!", {
        isFirstOfTurn: false,
        writeSeq: 0,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 1);
    // Later write's content should be preserved
    assert.strictEqual(
      result.latestGroup!.turnFileEditSummary![0].writtenContent,
      "version2"
    );
  });

  // ── Per-step fileEditSummary isolation ───────────────────────────────

  it("intermediate step fileEditSummary does not leak into next step", () => {
    // Step1: seq 0,1 → /a.ts, /b.ts
    useFileWriteStore.getState().addWrite("a1", "s1", "/a.ts", "aaa"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/b.ts", "bbb"); // seq=1
    // Step2 (final): seq 2 → /c.ts
    useFileWriteStore.getState().addWrite("a1", "s1", "/c.ts", "ccc"); // seq=2

    const items: PipelineItem[] = [
      userMsg("multi"),
      agentMsg("step1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 2,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    const steps = result.latestGroup!.steps;
    assert.strictEqual(steps.length, 1);

    // Step 1: only /a.ts and /b.ts (seq in [0,2))
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 2);
    const step1Paths = steps[0].fileEditSummary!.map((e) => e.path);
    assert.deepStrictEqual(step1Paths, ["/a.ts", "/b.ts"]);

    // currentStep carries fileEditSummary (final step writes seq in [2,∞))
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/c.ts");

    // turnFileEditSummary: all 3 files
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 3);
    const turnPaths = result.latestGroup!.turnFileEditSummary!.map(
      (e) => e.path
    );
    assert.deepStrictEqual(turnPaths, ["/a.ts", "/b.ts", "/c.ts"]);
  });

  it("pre-agent step writes are attributed to the pre-agent step", () => {
    // Writes before any agent message (seq 0) → pre-agent step
    useFileWriteStore.getState().addWrite("a1", "s1", "/pre.ts", "pre"); // seq=0

    const items: PipelineItem[] = [
      userMsg("setup"),
      // Pre-agent tool call (role="tool")
      {
        type: "chat",
        role: "tool",
        agentId: "a1",
        sessionId: "s1",
        content: "",
        key: "tool-1",
        timestamp: Date.now(),
        isFirstOfTurn: true,
        attachments: [],
        thinking: undefined,
        resolvedToolCalls: [
          {
            id: "tc-1",
            title: "Write",
            kind: "write",
            status: "completed",
            input: undefined,
            output: undefined,
            durationMs: undefined,
            locations: undefined,
            diffContent: undefined,
          },
        ],
      } as ChatDisplayItem,
      agentMsg("done!", {
        isFirstOfTurn: false,
        writeSeq: 1,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    // Pre-agent step should have fileEditSummary with /pre.ts
    const steps = result.latestGroup!.steps;
    assert.ok(steps.length >= 1);
    const preAgentStep = steps[0];
    assert.strictEqual(preAgentStep.isPreAgent, true);
    assert.ok(preAgentStep.fileEditSummary);
    assert.strictEqual(preAgentStep.fileEditSummary!.length, 1);
    assert.strictEqual(preAgentStep.fileEditSummary![0].path, "/pre.ts");
  });

  // ── Edge: writeSeq gap between steps ────────────────────────────────

  it("handles writeSeq gap between steps (no writes in intermediate)", () => {
    // Final step has writeSeq=5, but only seq 0 exists → all writes go to intermediate step
    useFileWriteStore.getState().addWrite("a1", "s1", "/only.ts", "only"); // seq=0

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("intermediate", { isFirstOfTurn: true, writeSeq: 0 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 5,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    const steps = result.latestGroup!.steps;
    assert.strictEqual(steps.length, 1);

    // Step 1: writes seq in [0,5) → seq 0 → /only.ts
    assert.ok(steps[0].fileEditSummary);
    assert.strictEqual(steps[0].fileEditSummary!.length, 1);
    assert.strictEqual(steps[0].fileEditSummary![0].path, "/only.ts");

    // currentStep: no fileEditSummary (synthetic from finalStepSummary, which has no writes → null)
    // Since finalStepSummary is undefined (no writes in [5,∞)), currentStep is null
    const cs = result.latestGroup!.currentStep;
    assert.strictEqual(cs, null);
  });

  // ── Edge: many intermediate steps with separate writes ──────────────

  it("distributes writes across 4 steps correctly", () => {
    useFileWriteStore.getState().addWrite("a1", "s1", "/s1.ts", "s1"); // seq=0
    useFileWriteStore.getState().addWrite("a1", "s1", "/s2.ts", "s2"); // seq=1
    useFileWriteStore.getState().addWrite("a1", "s1", "/s3.ts", "s3"); // seq=2
    useFileWriteStore.getState().addWrite("a1", "s1", "/s4.ts", "s4"); // seq=3

    const items: PipelineItem[] = [
      userMsg("multi"),
      agentMsg("step1", { isFirstOfTurn: false, writeSeq: 0 }),
      agentMsg("step2", { isFirstOfTurn: true, writeSeq: 1 }),
      agentMsg("step3", { isFirstOfTurn: true, writeSeq: 2 }),
      agentMsg("final", {
        isFirstOfTurn: false,
        writeSeq: 3,
        stopReason: "end_turn",
      }),
    ];
    const result = new IntermediateStepGrouper(items).compute();

    const steps = result.latestGroup!.steps;
    assert.strictEqual(steps.length, 3);

    // Each step gets exactly 1 write
    for (let i = 0; i < 3; i++) {
      assert.ok(steps[i].fileEditSummary);
      assert.strictEqual(steps[i].fileEditSummary!.length, 1);
      assert.strictEqual(steps[i].fileEditSummary![0].path, `/s${i + 1}.ts`);
    }

    // currentStep carries fileEditSummary (final step writes seq in [3,∞))
    const cs = result.latestGroup!.currentStep;
    assert.ok(cs, "currentStep should exist");
    assert.ok(cs.fileEditSummary, "currentStep should carry fileEditSummary");
    assert.strictEqual(cs.fileEditSummary!.length, 1);
    assert.strictEqual(cs.fileEditSummary![0].path, "/s4.ts");

    // turnFileEditSummary: all 4 files
    assert.ok(result.latestGroup!.turnFileEditSummary);
    assert.strictEqual(result.latestGroup!.turnFileEditSummary!.length, 4);
  });
});
