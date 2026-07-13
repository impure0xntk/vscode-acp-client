import assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useMessageStore } from "../../../store/messageStore";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import { MessagePipeline } from "../../../pipeline/pipeline";
import {
  IntermediateStepGrouper,
  splitLatestSteps,
} from "../../../pipeline/stages/grouping";
import type {
  RawMessage,
  PipelineConfig,
  PipelineContext,
  ChatDisplayItem,
} from "../../../pipeline/types";

let c = 0;
function msg(
  overrides: Partial<RawMessage> & { role: RawMessage["role"] }
): RawMessage {
  c++;
  return {
    id: `msg-${c}`,
    content: "",
    timestamp: 1700000000000 + c,
    ...(overrides as Record<string, unknown>),
  } as RawMessage;
}
const cfg: PipelineConfig = {
  filter: { hideCompression: false, hideModeChange: false, hideErrorNotices: false },
  annotate: { resolveAttachments: true, detectInlinePaths: false },
};
const ctx: PipelineContext = {
  sessionId: "s",
  agentId: "a",
  sessionCwd: undefined,
  existingItems: [],
};

function report(label: string, messages: RawMessage[]) {
  const pipe = new MessagePipeline(cfg);
  const items = pipe.process(messages, ctx);
  const { latestGroup } = new IntermediateStepGrouper(items).compute();
  assert.ok(latestGroup, `${label}: latestGroup`);
  const final = latestGroup.finalResponse
    ? ((latestGroup.finalResponse.item as ChatDisplayItem).content || "[thinking]")
    : null;
  const { olderSteps, currentStep } = splitLatestSteps(
    latestGroup.steps,
    latestGroup.finalResponse != null,
    latestGroup.currentStep
  );
  console.log(
    `[${label}] steps=${latestGroup.steps.length} final="${final}" ` +
      `currentStep=${currentStep ? "[set]" : "null"} ` +
      `olderSteps=${olderSteps.length} => BANNER=${olderSteps.length > 0 ? "SHOWN" : "HIDDEN"}`
  );
  return { olderSteps, latestGroup };
}

describe("repro: faithful streaming multi-step turn", () => {
  beforeEach(() => {
    c = 0;
    useMessageStore.setState({ perSession: {}, streaming: {}, promptQueue: {} });
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
  });

  it("intermediate step + final (thinking+tool) during streaming", () => {
    const key = "a:s";

    useMessageStore.getState().appendMessage(key, msg({ role: "user", content: "do it" }));
    report("1:user", useMessageStore.getState().perSession[key]);

    useMessageStore.getState().appendMessage(key, msg({ role: "agent", content: "reading files..." }));
    report("2:intermediate", useMessageStore.getState().perSession[key]);

    useMessageStore.getState().appendMessage(
      key,
      msg({
        role: "tool",
        content: "result",
        toolCalls: [{ id: "t1", title: "Read", status: "completed", kind: "read" }],
      })
    );
    report("3:+tool", useMessageStore.getState().perSession[key]);

    useMessageStore.getState().appendStreamChunk(key, "a", "s", "Here is the answer.", "m-final");
    report("4:+final-streaming", useMessageStore.getState().perSession[key]);

    useMessageStore.getState().appendMessage(
      key,
      msg({
        role: "agent",
        content: "",
        thinking: { type: "thinking", content: "final-step thought", isStreaming: false },
      })
    );
    report("5:+thinking(final step)", useMessageStore.getState().perSession[key]);

    useMessageStore.getState().appendMessage(
      key,
      msg({
        role: "tool",
        content: "write result",
        toolCalls: [{ id: "t2", title: "Write", status: "completed", kind: "write" }],
      })
    );
    report("6:+tool(final step)", useMessageStore.getState().perSession[key]);

    useMessageStore.getState().updateLastAgentMessage(key, { stopReason: "end_turn" });
    report("7:end_turn", useMessageStore.getState().perSession[key]);
  });
});
