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
  PipelineItem,
  ChatDisplayItem,
  RawMessage,
} from "../../../pipeline/types";

const cfg: any = {
  filter: {
    hideCompression: false,
    hideModeChange: false,
    hideErrorNotices: false,
  },
  annotate: { resolveAttachments: true, detectInlinePaths: false },
};
const ctx: any = {
  sessionId: "s",
  agentId: "a",
  sessionCwd: undefined,
  existingItems: [],
};

const key = "a:s";

function step(label: string) {
  const msgs = useMessageStore.getState().perSession[key];
  const pipe = new MessagePipeline(cfg);
  const items = pipe.process(msgs as RawMessage[], ctx) as PipelineItem[];
  const { latestGroup } = new IntermediateStepGrouper(items).compute();
  assert.ok(latestGroup, `${label}: latestGroup`);
  const final =
    latestGroup.finalResponse != null
      ? (latestGroup.finalResponse.item as ChatDisplayItem).content ||
        "[thinking]"
      : null;
  const { olderSteps, currentStep } = splitLatestSteps(
    latestGroup.steps,
    latestGroup.finalResponse != null,
    latestGroup.currentStep
  );
  const finalKey = latestGroup.finalResponse?.item.key ?? null;
  console.log(
    `[${label}] steps=${latestGroup.steps.length} final="${final}" ` +
      `finalKey=${finalKey} ` +
      `currentStep=${currentStep ? "[set]" : "null"} ` +
      `olderSteps=${olderSteps.length} => BANNER=${olderSteps.length > 0 ? "SHOWN" : "HIDDEN"}`
  );
  return { olderSteps, latestGroup };
}

function user(content: string) {
  useMessageStore.getState().appendMessage(key, {
    id: `u-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content,
    timestamp: Date.now(),
    agentId: "a",
    sessionId: "s",
  } as RawMessage);
}
function stream(chunk: string, messageId: string, su: string) {
  useMessageStore
    .getState()
    .appendStreamChunks(key, "a", "s", [chunk], messageId, su);
}
function toolCall(id: string, title: string) {
  const last = useMessageStore.getState().perSession[key];
  const lastMsg = last[last.length - 1];
  const toolMsg =
    lastMsg && lastMsg.role === "tool"
      ? lastMsg
      : {
          id: `tc-${id}-${Math.random().toString(36).slice(2, 8)}`,
          role: "tool" as const,
          content: "",
          timestamp: Date.now(),
          agentId: "a",
          sessionId: "s",
          toolCalls: [] as any[],
        };
  const updated = {
    ...toolMsg,
    toolCalls: [
      ...(toolMsg.toolCalls ?? []),
      {
        id,
        title,
        status: "completed" as const,
        kind: "read" as const,
        input: undefined,
        output: undefined,
        durationMs: undefined,
        locations: undefined,
        diffContent: undefined,
      },
    ],
  };
  if (lastMsg && lastMsg.role === "tool") {
    useMessageStore
      .getState()
      .updateMessage(key, last.length - 1, updated as any);
  } else {
    useMessageStore.getState().appendMessage(key, updated as any);
  }
}
function turnEnded(reason: string) {
  useMessageStore
    .getState()
    .updateLastAgentMessage(key, { stopReason: reason });
}

describe("repro: faithful streaming multi-step with thinking+tool in final step", () => {
  beforeEach(() => {
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
  });

  it("per-step messageId -> multiple first-of-turn", () => {
    user("do it");
    step("1:user");
    stream("Let me read the file. ", "m1", "agent_message_chunk");
    step("2:agent step1");
    toolCall("t1", "Read");
    step("3:+tool");
    stream("Now let me check config. ", "m2", "agent_message_chunk");
    step("4:agent step2");
    toolCall("t2", "Read");
    step("5:+tool");
    stream("Here is the answer. ", "m3", "agent_message_chunk");
    step("6:final streaming");
    stream("final-step thought", "m3", "agent_thought_chunk");
    step("7:+thinking (final step)");
    toolCall("t3", "Write");
    step("8:+tool (final step)");
    turnEnded("end_turn");
    step("9:end_turn");
  });
});
