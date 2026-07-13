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

function dump(label: string) {
  const msgs = useMessageStore.getState().perSession[key];
  const pipe = new MessagePipeline(cfg);
  const items = pipe.process(msgs as RawMessage[], ctx) as PipelineItem[];
  const { latestGroup } = new IntermediateStepGrouper(items).compute();
  assert.ok(latestGroup, `${label}: latestGroup`);
  const final = latestGroup.finalResponse != null
    ? (latestGroup.finalResponse.item as ChatDisplayItem).content || "[thinking]"
    : null;
  const { olderSteps } = splitLatestSteps(
    latestGroup.steps,
    latestGroup.finalResponse != null,
    latestGroup.currentStep
  );
  console.log(
    `[${label}] steps=${latestGroup.steps.length} final="${final}" ` +
      `finalKey=${latestGroup.finalResponse?.item.key ?? null} ` +
      `currentStep=${latestGroup.currentStep ? "[set]" : "null"} ` +
      `olderSteps=${olderSteps.length} => BANNER=${olderSteps.length > 0 ? "SHOWN" : "HIDDEN"}`
  );
  return olderSteps.length;
}

function user(content: string) {
  useMessageStore.getState().appendMessage(key, {
    id: `u-${Math.random().toString(36).slice(2, 8)}`,
    role: "user", content, timestamp: Date.now(), agentId: "a", sessionId: "s",
  } as RawMessage);
}
function agentText(chunk: string, messageId: string) {
  useMessageStore.getState().appendStreamChunks(key, "a", "s", [chunk], messageId, "agent_message_chunk");
}
function thinking(chunk: string, messageId: string) {
  useMessageStore.getState().appendStreamChunks(key, "a", "s", [chunk], messageId, "agent_thought_chunk");
}
function toolCall(id: string, title: string) {
  const last = useMessageStore.getState().perSession[key];
  const lastMsg = last[last.length - 1];
  const toolMsg =
    lastMsg && lastMsg.role === "tool"
      ? lastMsg
      : {
          id: `tc-${id}-${Math.random().toString(36).slice(2, 8)}`,
          role: "tool" as const, content: "", timestamp: Date.now(),
          agentId: "a", sessionId: "s", toolCalls: [] as any[],
        };
  const updated = {
    ...toolMsg,
    toolCalls: [...(toolMsg.toolCalls ?? []), {
      id, title, status: "completed" as const, kind: "read" as const,
      input: undefined, output: undefined, durationMs: undefined,
      locations: undefined, diffContent: undefined,
    }],
  };
  if (lastMsg && lastMsg.role === "tool") {
    useMessageStore.getState().updateMessage(key, last.length - 1, updated as any);
  } else {
    useMessageStore.getState().appendMessage(key, updated as any);
  }
}
function turnEnded(reason: string) {
  useMessageStore.getState().updateLastAgentMessage(key, { stopReason: reason });
}

// Build N intermediate steps (each: agent text + tool), then a final step
// composed of the given `finalParts` in order, optionally ending with a final
// text that receives `endReason`.
type Part = "text" | "thinking" | "tool";
function build(intermediateSteps: number, finalParts: Part[], endReason: string | null, label: string) {
  user("do it");
  for (let i = 1; i <= intermediateSteps; i++) {
    agentText(`step${i} text `, `m${i}`);
    toolCall(`t${i}`, `Tool${i}`);
  }
  // final step: messageId "mf" for the final text
  let hasFinalText = false;
  for (const p of finalParts) {
    if (p === "text") { agentText("final text ", "mf"); hasFinalText = true; }
    else if (p === "thinking") { thinking("final thinking", "mf"); }
    else { toolCall("tf", "FinalTool"); }
  }
  const before = dump(`${label} [before turnEnded]`);
  if (endReason) turnEnded(endReason);
  const after = dump(`${label} [after turnEnded=${endReason}]`);
  return { before, after };
}

const orderings: Part[][] = [
  ["text", "thinking", "tool"],
  ["thinking", "tool", "text"],
  ["text", "tool", "thinking"],
  ["thinking", "text", "tool"],
  ["thinking", "tool"],
  ["text", "thinking"],
  ["text", "tool"],
  ["tool"],
  ["thinking"],
];

describe("repro matrix: final-step ordering vs banner visibility", () => {
  beforeEach(() => {
    useMessageStore.setState({ perSession: {}, streaming: {}, promptQueue: {} });
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
  });

  for (const ordering of orderings) {
    it(`2 intermediate steps + final[${ordering.join(",")}] end_turn`, () => {
      const { before, after } = build(2, ordering, "end_turn", `2step/final[${ordering.join(",")}]`);
      console.log(`   => before=${before > 0 ? "SHOWN" : "HIDDEN"} after=${after > 0 ? "SHOWN" : "HIDDEN"}`);
    });
  }

  it("spotlight: 2 intermediate + final[thinking,tool] (no final text) end_turn", () => {
    build(2, ["thinking", "tool"], "end_turn", "noText-end_turn");
  });
  it("spotlight: 1 intermediate + final[text,thinking,tool] end_turn", () => {
    build(1, ["text", "thinking", "tool"], "end_turn", "1step");
  });
});
