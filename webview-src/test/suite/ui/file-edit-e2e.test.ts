/**
 * E2E-style test that simulates the exact webview message flow:
 * streamStart → agent msg notification → file write → tool_call_update → turnEnded
 * 
 * This bypasses the pipeline and directly tests the grouping logic
 * with the exact sequence of events as they arrive in the webview.
 */
import { useFileWriteStore } from "../../../store/fileWriteStore";
import type { PipelineItem, ChatDisplayItem } from "../../../pipeline/types";
import { IntermediateStepGrouper } from "../../../pipeline/stages/grouping";
import assert from "assert";

let keyCounter = 0;
function nextKey(p: string) { return `${p}-${++keyCounter}`; }

function userMsg(content: string): ChatDisplayItem {
  return {
    type: "chat", role: "user", agentId: "Goose CLI", sessionId: "20260627_82",
    content, key: nextKey("user"), timestamp: Date.now(),
    isConsecutive: false, groupKey: "user", attachments: [], thinking: undefined,
  };
}

function agentMsg(content: string, writeSeq?: number, stopReason?: string): ChatDisplayItem {
  return {
    type: "chat", role: "agent", agentId: "Goose CLI", sessionId: "20260627_82",
    content, key: nextKey("agent"), timestamp: Date.now(),
    isConsecutive: false, groupKey: "agent:Goose CLI", attachments: [],
    thinking: undefined, writeSeq, stopReason,
  };
}

describe("E2E: FileEdit flow with space in agentId", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
    keyCounter = 0;
  });

  it("shows turnFileEditSummary after file write + turn complete", () => {
    // Step 1: streamStart arrives → webview stamps writeSeq=0 on agent msg
    // (At streamStart time, no writes have happened yet)
    // Step 2: agent message notification arrives
    // Step 3: tool_call notification (fs/write_text_file)
    // Step 4: session/webviewFileWrite arrives → fileWriteStore records write with seq=0
    // Step 5: tool_call_update with hasDiff=true
    // Step 6: turnEnded with stopReason="end_turn"

    // Simulate: file write recorded BEFORE agent message arrives
    // (this is the critical race — write may arrive before the agent msg)
    useFileWriteStore.getState().addWrite("Goose CLI", "20260627_82", "/test/file.ts", "content1\ncontent2");
    
    // Agent message with writeSeq=0 (stamped at streamStart, before any writes)
    // Then second agent message (final) with writeSeq=1 (after 1 write recorded)
    const items: PipelineItem[] = [
      userMsg("update the test file"),
      agentMsg("I'll update it now", 0),
      agentMsg("Done! File updated.", 1, "end_turn"),
    ];

    const result = new IntermediateStepGrouper(items).compute();

    console.log("Latest group:");
    console.log("  steps:", result.latestGroup?.steps.length);
    console.log("  currentStep:", result.latestGroup?.currentStep?.agentMessage?.content);
    console.log("  finalResponse:", result.latestGroup?.finalResponse?.item ? "yes" : "no");
    console.log("  turnFileEditSummary:", JSON.stringify(result.latestGroup?.turnFileEditSummary?.map(e => ({path: e.path, lc: e.lineCount}))));

    // ASSERTIONS:
    // 1. turnFileEditSummary should contain the written file
    assert.ok(result.latestGroup?.turnFileEditSummary, "turnFileEditSummary should exist");
    assert.strictEqual(result.latestGroup.turnFileEditSummary.length, 1);
    assert.strictEqual(result.latestGroup.turnFileEditSummary[0].path, "/test/file.ts");
    assert.strictEqual(result.latestGroup.turnFileEditSummary[0].lineCount, 2);

    // 2. currentStep is null when finalStepSummary is undefined (no writes in final step range)
    // But the rendering path uses !currentStep && latestGroup.finalResponse → DisplayItemView
    // AND latestGroup.finalResponse && latestGroup.turnFileEditSummary → FileEditSummary
    const cs = result.latestGroup.currentStep;
    assert.strictEqual(cs, null, "currentStep should be null (no writes in final step range)");
    assert.ok(result.latestGroup?.finalResponse, "finalResponse should exist");
  });

  it("handles write that arrives BEFORE any agent message", () => {
    // This is the actual bug scenario:
    // 1. streamStart → creates agent message in webview
    // 2. writeTextFile event arrives → fileWriteStore.addWrite (seq=0)
    // 3. tool_call notification → creates tool message
    // 4. tool_call_update with hasDiff=true
    // 5. turnEnded → stopReason stamped on agent msg
    // 
    // The agent message was created at streamStart with writeSeq=0
    // But the write also has seq=0
    // Partitioning: step1.lo=0, step1.hi=Infinity → writes in [0,∞) → includes seq=0
    // This means the write goes to the intermediate step, NOT the final step
    // But if there's only one agent message (final), there are no intermediate steps
    // → the write should go to turnFileEditSummary

    useFileWriteStore.getState().addWrite("Goose CLI", "20260627_82", "/test.ts", "line1\nline2\nline3");

    const items: PipelineItem[] = [
      userMsg("write file"),
      agentMsg("Written!", undefined, "end_turn"),  // writeSeq undefined → defaults to 0
    ];

    const result = new IntermediateStepGrouper(items).compute();

    console.log("\nTest 2 - write before agent msg:");
    console.log("  steps:", result.latestGroup?.steps.length);
    console.log("  currentStep:", result.latestGroup?.currentStep?.agentMessage?.content);
    console.log("  turnFileEditSummary:", JSON.stringify(result.latestGroup?.turnFileEditSummary?.map(e => ({path: e.path, lc: e.lineCount}))));

    // turnFileEditSummary should have the file
    assert.ok(result.latestGroup?.turnFileEditSummary);
    assert.strictEqual(result.latestGroup.turnFileEditSummary.length, 1);
    assert.strictEqual(result.latestGroup.turnFileEditSummary[0].lineCount, 3);
  });

  it("handles writeSeq=undefined on all messages (no streamStart received)", () => {
    // Edge case: what if streamStart was never received?
    // All messages have writeSeq=undefined → defaults to 0
    // All writes go to [0, Infinity) → first step

    useFileWriteStore.getState().addWrite("Goose CLI", "20260627_82", "/a.ts", "aaa");
    useFileWriteStore.getState().addWrite("Goose CLI", "20260627_82", "/b.ts", "bbb");

    const items: PipelineItem[] = [
      userMsg("edit"),
      agentMsg("done!", undefined, "end_turn"),
    ];

    const result = new IntermediateStepGrouper(items).compute();

    console.log("\nTest 3 - undefined writeSeq:");
    console.log("  steps:", result.latestGroup?.steps.length);
    console.log("  currentStep:", result.latestGroup?.currentStep?.agentMessage?.content);
    console.log("  turnFileEditSummary:", JSON.stringify(result.latestGroup?.turnFileEditSummary?.map(e => ({path: e.path, lc: e.lineCount}))));

    assert.ok(result.latestGroup?.turnFileEditSummary);
    assert.strictEqual(result.latestGroup.turnFileEditSummary.length, 2);
  });
});
