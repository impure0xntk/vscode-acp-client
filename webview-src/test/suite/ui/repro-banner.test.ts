import assert from "assert";
import { describe, it } from "mocha";
import type { PipelineItem, ChatDisplayItem } from "../../../pipeline/types";
import { IntermediateStepGrouper } from "../../../pipeline/stages/grouping";
import { splitLatestSteps } from "../../../pipeline/stages/grouping";

let k = 0;
const nk = (p: string) => `${p}-${++k}`;
// isFirstOfTurn emulates annotate.ts: first agent/tool after a user/system
// boundary is first-of-turn; subsequent ones in the same turn are not.
function buildIsFirstOfTurn(items: PipelineItem[]): void {
  let boundary = true;
  for (const it of items) {
    if (it.type !== "chat") {
      boundary = true;
      continue;
    }
    const chat = it as ChatDisplayItem;
    const isAT = chat.role === "agent" || chat.role === "tool";
    chat.isFirstOfTurn = isAT && boundary;
    boundary = false;
  }
}

function user(c: string): ChatDisplayItem {
  return {
    type: "chat",
    role: "user",
    agentId: "a",
    content: c,
    key: nk("u"),
    timestamp: 1,
    isFirstOfTurn: false,
    attachments: [],
    thinking: undefined,
  };
}
function agent(c: string, o: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat",
    role: "agent",
    agentId: "a",
    content: c,
    key: nk("a"),
    timestamp: 1,
    isFirstOfTurn: false,
    attachments: [],
    thinking: undefined,
    ...o,
  };
}
function think(c: string, o: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat",
    role: "agent",
    agentId: "a",
    content: "",
    key: nk("t"),
    timestamp: 1,
    isFirstOfTurn: false,
    attachments: [],
    thinking: { content: c, isStreaming: false },
    ...o,
  };
}
function tool(c: string, o: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat",
    role: "tool",
    agentId: "a",
    content: c,
    key: nk("tl"),
    timestamp: 1,
    isFirstOfTurn: false,
    attachments: [],
    thinking: undefined,
    resolvedToolCalls: [
      {
        id: c,
        title: c,
        kind: "generic",
        status: "completed",
        input: undefined,
        output: undefined,
        durationMs: undefined,
        locations: undefined,
        diffContent: undefined,
      },
    ],
    ...o,
  };
}

function snapshot(label: string, items: PipelineItem[]): void {
  buildIsFirstOfTurn(items);
  const { latestGroup } = new IntermediateStepGrouper(items).compute();
  assert.ok(latestGroup, `${label}: latestGroup`);
  const { olderSteps, currentStep } = splitLatestSteps(
    latestGroup.steps,
    latestGroup.finalResponse != null,
    latestGroup.currentStep
  );
  const finalContent = latestGroup.finalResponse
    ? (latestGroup.finalResponse.item as ChatDisplayItem).content ||
      "[thinking]"
    : null;
  console.log(
    `[${label}] steps=${latestGroup.steps.length} final="${finalContent}" ` +
      `currentStep=${currentStep ? currentStep.agentMessage?.content || "[thinking]" : "null"} ` +
      `olderSteps=${olderSteps.length} => BANNER=${olderSteps.length > 0 ? "SHOWN" : "HIDDEN"}`
  );
}

describe("repro: banner hides when thinking+tool in final step", () => {
  it("scenario trace", () => {
    // A turn: intermediate step (tool_use), then final step with thinking+tool after end_turn
    const items: PipelineItem[] = [user("do it")];
    snapshot("1:user", items);

    items.push(agent("checking files...", { stopReason: "tool_use" }));
    snapshot("2:intermediate(tool_use)", items);

    items.push(tool("read"));
    snapshot("3:+tool", items);

    items.push(agent("Done! Here is the answer.", { stopReason: "end_turn" }));
    snapshot("4:+final(end_turn)", items);

    items.push(think("final-step thought"));
    snapshot("5:+thinking(final step)", items);

    items.push(tool("write"));
    snapshot("6:+tool(final step)", items);
  });
});
