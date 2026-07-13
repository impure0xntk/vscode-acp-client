import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useMessageStore } from "../../../store/messageStore";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import { MessagePipeline } from "../../../pipeline/pipeline";
import {
  IntermediateStepGrouper,
  splitLatestSteps,
} from "../../../pipeline/stages/grouping";
import type { PipelineItem, ChatDisplayItem, RawMessage } from "../../../pipeline/types";

const cfg: any = {
  filter: { hideCompression: false, hideModeChange: false, hideErrorNotices: false },
  annotate: { resolveAttachments: true, detectInlinePaths: false },
};
const ctx: any = {
  sessionId: "s",
  agentId: "a",
  sessionCwd: undefined,
  existingItems: [],
};
const key = "a:s";

// Reproduce the REAL pipeline path used by useMessagePipeline:
// each appended batch is processed via processIncremental (annotated in
// isolation with prevWasTurnBoundary=true), so every new agent/tool message
// batch's first agent message becomes isFirstOfTurn=true.
function makePipeline() {
  return new MessagePipeline(cfg);
}

let raw: RawMessage[] = [];
let pipe: MessagePipeline;

function push(msg: RawMessage) {
  raw.push(msg);
  const newOnes = [msg];
  const result = pipe.processIncremental(newOnes as RawMessage[], ctx);
  return result as PipelineItem[];
}

function dump(label: string) {
  const { latestGroup } = new IntermediateStepGrouper(pipe.cached).compute();
  assert.ok(latestGroup, `${label}: latestGroup`);
  const items = pipe.cached;
  const fot = items
    .map((i) =>
      i.type === "chat"
        ? `${(i as ChatDisplayItem).role}${((i as ChatDisplayItem).thinking ? "*" : "")}:${(
            i as ChatDisplayItem
          ).isFirstOfTurn}`
        : i.type
    )
    .join(",");
  const final = latestGroup.finalResponse != null
    ? ((latestGroup.finalResponse.item as ChatDisplayItem).content || "[thinking]")
    : null;
  const { olderSteps } = splitLatestSteps(
    latestGroup.steps,
    latestGroup.finalResponse != null,
    latestGroup.currentStep
  );
  console.log(
    `[${label}] items=[${fot}] final="${final}" finalKey=${latestGroup.finalResponse?.item.key ?? null} ` +
      `steps=${latestGroup.steps.length} olderSteps=${olderSteps.length} => BANNER=${olderSteps.length > 0 ? "SHOWN" : "HIDDEN"}`
  );
  return olderSteps.length;
}

function user(content: string) {
  return push({
    id: `u-${Math.random().toString(36).slice(2, 8)}`,
    role: "user", content, timestamp: Date.now(), agentId: "a", sessionId: "s",
  } as RawMessage);
}
function agentText(chunk: string, messageId: string) {
  return push({
    id: messageId, role: "agent", content: chunk, timestamp: Date.now(),
    agentId: "a", sessionId: "s", messageId,
  } as RawMessage);
}
function thinking(chunk: string, messageId: string) {
  return push({
    id: messageId, role: "agent", content: "", timestamp: Date.now(),
    agentId: "a", sessionId: "s", messageId,
    thinking: { content: chunk, isStreaming: true },
  } as RawMessage);
}
function toolCall(id: string, title: string) {
  return push({
    id: `tc-${id}-${Math.random().toString(36).slice(2, 8)}`,
    role: "tool", content: "", timestamp: Date.now(), agentId: "a", sessionId: "s",
    toolCalls: [{ id, title, status: "completed" as const, kind: "read" as const,
      input: undefined, output: undefined, durationMs: undefined,
      locations: undefined, diffContent: undefined }],
  } as RawMessage);
}
function turnEnded(reason: string) {
  // Stamp stopReason on last non-thinking agent raw message (mirrors handler)
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i] as any;
    if (m.role === "agent" && !m.thinking && (m.stopReason == null || m.stopReason === "")) {
      m.stopReason = reason;
      break;
    }
  }
  // hook: only last changed → refreshLast
  const result = pipe.refreshLast(raw as RawMessage[], ctx);
  return result as PipelineItem[];
}

describe("repro: REAL incremental pipeline + final-step thinking+tool", () => {
  beforeEach(() => {
    useMessageStore.setState({ perSession: {}, streaming: {}, promptQueue: {} });
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
    raw = [];
    pipe = makePipeline();
  });

  it("multi-step with final text + thinking + tool in final step", () => {
    user("do it"); dump("1:user");
    agentText("step1 ", "m1"); dump("2:m1");
    toolCall("t1", "Read"); dump("3:t1");
    agentText("step2 ", "m2"); dump("4:m2");
    toolCall("t2", "Read"); dump("5:t2");
    agentText("final answer ", "m3"); dump("6:m3");
    thinking("final-step thought", "m3"); dump("7:thinking");
    toolCall("t3", "Write"); dump("8:t3");
    dump("=== before turnEnded ===");
    turnEnded("end_turn"); dump("9:end_turn");
  });

  it("final step is ONLY thinking+tool (no final text)", () => {
    user("do it"); dump("1:user");
    agentText("step1 ", "m1"); dump("2:m1");
    toolCall("t1", "Read"); dump("3:t1");
    agentText("step2 ", "m2"); dump("4:m2");
    toolCall("t2", "Read"); dump("5:t2");
    thinking("final-step thought", "mT"); dump("6:thinking");
    toolCall("t3", "Write"); dump("7:t3");
    dump("=== before turnEnded ===");
    turnEnded("end_turn"); dump("8:end_turn");
  });

  it("final step: thinking THEN tool THEN final text", () => {
    user("do it"); dump("1:user");
    agentText("step1 ", "m1"); dump("2:m1");
    toolCall("t1", "Read"); dump("3:t1");
    agentText("step2 ", "m2"); dump("4:m2");
    toolCall("t2", "Read"); dump("5:t2");
    thinking("final-step thought", "mT"); dump("6:thinking");
    toolCall("t3", "Write"); dump("7:t3");
    agentText("final answer ", "m3"); dump("8:m3");
    dump("=== before turnEnded ===");
    turnEnded("end_turn"); dump("9:end_turn");
  });
});
