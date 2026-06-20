import * as assert from "assert";
import { describe, it } from "mocha";
import type { PipelineItem, ChatDisplayItem } from "../../../pipeline/types";

// ── Re-implementation of groupByUserBoundary for unit testing ───────────────
// (mirrors the pure function from SessionChatContainer.tsx, including
//  selectFinalResponse with stopReason-first strategy)

interface FinalResponse {
  item: PipelineItem;
  index: number;
}

interface AgentResponseGroup {
  userItem: PipelineItem;
  items: PipelineItem[];
  finalResponse: FinalResponse | null;
}

interface GroupedItems {
  groups: AgentResponseGroup[];
  latestGroup: AgentResponseGroup | null;
  trailing: PipelineItem[];
}

/**
 * Selects the final response from a group of agent/tool items.
 * Priority: stopReason > first non-consecutive > last non-promoted fallback.
 */
function selectFinalResponse(
  agentChats: PipelineItem[]
): { item: PipelineItem; index: number } | null {
  if (agentChats.length === 0) return null;

  // 1. stopReason-based: the message carrying stopReason is the definitive final response
  const stopReasonIdx = agentChats.findIndex(
    (item) => item.type === "chat" && item.stopReason != null
  );
  if (stopReasonIdx !== -1) {
    return { item: agentChats[stopReasonIdx], index: stopReasonIdx };
  }

  // 2. First non-consecutive agent chat (not a promoted tool)
  const isNonConsecutiveAgent = (item: PipelineItem) =>
    item.type === "chat" &&
    item.role === "agent" &&
    (item as ChatDisplayItem).originalRole !== "tool" &&
    !item.isConsecutive;
  const ncIdx = agentChats.findIndex(isNonConsecutiveAgent);
  if (ncIdx !== -1) {
    return { item: agentChats[ncIdx], index: ncIdx };
  }

  // 3. Fallback: last non-promoted agent chat
  for (let i = agentChats.length - 1; i >= 0; i--) {
    const item = agentChats[i];
    if (
      item.type === "chat" &&
      item.role === "agent" &&
      (item as ChatDisplayItem).originalRole !== "tool"
    ) {
      return { item, index: i };
    }
  }

  return null;
}

function groupByUserBoundary(items: PipelineItem[]): GroupedItems {
  const userIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === "chat" && item.role === "user") {
      userIndices.push(i);
    }
  }

  if (userIndices.length === 0) {
    return { groups: [], latestGroup: null, trailing: [] };
  }

  const lastUserIdx = userIndices[userIndices.length - 1];
  const afterLastUser = items.slice(lastUserIdx + 1);

  const isAgentOrTool = (item: PipelineItem) =>
    item.type === "chat" && (item.role === "agent" || item.role === "tool");

  const latestAgentChats = afterLastUser.filter(isAgentOrTool);
  const trailing = afterLastUser.filter((item) => !isAgentOrTool(item));

  const latestFinal = selectFinalResponse(latestAgentChats);
  const latestIntermediate = latestFinal
    ? latestAgentChats.filter((item) => item.key !== latestFinal.item.key)
    : latestAgentChats;

  const latestGroup: AgentResponseGroup = {
    userItem: items[lastUserIdx],
    items: latestIntermediate,
    finalResponse: latestFinal,
  };

  const groups: AgentResponseGroup[] = [];
  for (let g = 0; g < userIndices.length - 1; g++) {
    const startIdx = userIndices[g];
    const endIdx = userIndices[g + 1];
    const groupItems = items.slice(startIdx + 1, endIdx);

    const turnAgentChats = groupItems.filter(isAgentOrTool);
    const final = selectFinalResponse(turnAgentChats);

    const intermediateItems = final
      ? groupItems.filter((item) => item.key !== final.item.key)
      : groupItems;

    groups.push({
      userItem: items[startIdx],
      items: intermediateItems,
      finalResponse: final,
    });
  }

  return { groups, latestGroup, trailing };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    content,
    key: nextKey("user"),
    timestamp: Date.now(),
    isConsecutive: false,
    groupKey: "user",
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
    content,
    key: nextKey("agent"),
    timestamp: Date.now(),
    isConsecutive: false,
    groupKey: "agent:a1",
    attachments: [],
    thinking: undefined,
    ...overrides,
  };
}

function thinkingItem(
  content: string,
  overrides: Partial<ChatDisplayItem> = {}
): ChatDisplayItem {
  return {
    type: "chat",
    role: "agent",
    agentId: "a1",
    content: "",
    key: nextKey("think"),
    timestamp: Date.now(),
    isConsecutive: true,
    groupKey: "agent:a1",
    attachments: [],
    thinking: { content, isStreaming: false },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("groupByUserBoundary", () => {
  // ── Empty / no-user cases ─────────────────────────────────────────────

  it("returns empty for empty items", () => {
    const result = groupByUserBoundary([]);
    assert.strictEqual(result.groups.length, 0);
    assert.strictEqual(result.latestGroup, null);
    assert.strictEqual(result.trailing.length, 0);
  });

  it("returns empty when no user messages", () => {
    const items: PipelineItem[] = [agentMsg("hello"), agentMsg("world")];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 0);
    assert.strictEqual(result.latestGroup, null);
    assert.strictEqual(result.trailing.length, 0);
  });

  // ── Single turn (one user message) ────────────────────────────────────

  it("single turn: user + agent response, no intermediate steps", () => {
    const items: PipelineItem[] = [userMsg("hello"), agentMsg("hi there")];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 0);
    assert.ok(result.latestGroup);
    // agentMsg has isConsecutive=false, so it should be the final response
    assert.strictEqual(result.latestGroup.items.length, 0);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "hi there"
    );
    assert.strictEqual(result.trailing.length, 0);
  });

  it("single turn: intermediate steps folded, final response shown", () => {
    const items: PipelineItem[] = [
      userMsg("do something"),
      thinkingItem("let me think"),
      agentMsg("done!", { isConsecutive: true }),
      agentMsg("Result: success", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 0);
    assert.ok(result.latestGroup);
    // Intermediate: thinking + consecutive agent
    assert.strictEqual(result.latestGroup.items.length, 2);
    // Final response: non-consecutive agent
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "Result: success"
    );
  });

  // ── Multiple turns ────────────────────────────────────────────────────

  it("multiple turns: past group folded completely", () => {
    const items: PipelineItem[] = [
      // Turn 1 (past)
      userMsg("first question"),
      thinkingItem("thinking about first"),
      agentMsg("first answer", { isConsecutive: false }),
      // Turn 2 (latest)
      userMsg("second question"),
      agentMsg("second answer", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    const pastGroup = result.groups[0];
    assert.strictEqual(pastGroup.items.length, 1); // thinking
    assert.ok(pastGroup.finalResponse);
    assert.strictEqual(
      (pastGroup.finalResponse.item as ChatDisplayItem).content,
      "first answer"
    );
    // Latest group
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.items.length, 0);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "second answer"
    );
  });

  it("past turn with everything folded except final response", () => {
    const items: PipelineItem[] = [
      // Turn 1: intermediate steps should be foldable
      userMsg("run tests"),
      thinkingItem("checking tests"),
      agentMsg("running...", { isConsecutive: true }),
      agentMsg("tests passed!", { isConsecutive: false }),
      // Latest turn
      userMsg("commit changes"),
      agentMsg("committed", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    const past = result.groups[0];
    // items (intermediate) = thinking + running
    assert.strictEqual(past.items.length, 2);
    assert.ok(past.finalResponse);
    assert.strictEqual(
      (past.finalResponse.item as ChatDisplayItem).content,
      "tests passed!"
    );
    // Latest
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.items.length, 0);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "committed"
    );
  });

  // ── Trailing items (system notifications, compression) ───────────────

  it("trailing system items are not grouped", () => {
    const compItem: PipelineItem = {
      type: "compression",
      info: { contextWindowMax: 1000, usedTokens: 800 },
      key: nextKey("comp"),
      timestamp: Date.now(),
    };
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("hi!", { isConsecutive: false }),
      compItem,
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 0);
    assert.ok(result.latestGroup);
    assert.strictEqual(result.trailing.length, 1);
    assert.strictEqual(result.trailing[0], compItem);
  });

  // ── Edge: all consecutive agent messages (no non-consecutive) ─────────

  it("all consecutive agent msgs → no finalResponse, all in items", () => {
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("a", { isConsecutive: true }),
      agentMsg("b", { isConsecutive: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // No non-consecutive agent → finalResponse is null, all in items
    assert.strictEqual(result.latestGroup.finalResponse, null);
    assert.strictEqual(result.latestGroup.items.length, 2);
  });

  // ── IntermediateStepsBanner only gets intermediate items ─────────────

  it("banner items exclude the final response", () => {
    const think = thinkingItem("thinking...");
    const toolMsg = agentMsg("using tool...", { isConsecutive: true });
    const finalResponse = agentMsg("Here's the answer!", {
      isConsecutive: false,
    });

    const items: PipelineItem[] = [
      userMsg("help me"),
      think,
      toolMsg,
      finalResponse,
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // Banner should see only thinking + tool call
    assert.strictEqual(result.latestGroup.items.length, 2);
    assert.deepStrictEqual(result.latestGroup.items, [think, toolMsg]);
    // Final response is separate
    assert.strictEqual(result.latestGroup.finalResponse?.item, finalResponse);
  });

  // ── Multiple past turns all have final responses separated ───────────

  it("three turns: two past groups both have final responses", () => {
    const items: PipelineItem[] = [
      // Turn 1
      userMsg("q1"),
      thinkingItem("t1"),
      agentMsg("a1", { isConsecutive: false }),
      // Turn 2
      userMsg("q2"),
      thinkingItem("t2"),
      agentMsg("a2", { isConsecutive: false }),
      // Turn 3 (latest)
      userMsg("q3"),
      thinkingItem("t3"),
      agentMsg("a3", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);

    // Two past groups
    assert.strictEqual(result.groups.length, 2);
    // Turn 1
    assert.strictEqual(result.groups[0].items.length, 1); // thinking
    assert.strictEqual(
      (result.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    // Turn 2
    assert.strictEqual(result.groups[1].items.length, 1); // thinking
    assert.strictEqual(
      (result.groups[1].finalResponse?.item as ChatDisplayItem).content,
      "a2"
    );
    // Latest turn
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.items.length, 1); // thinking
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content,
      "a3"
    );
  });

  // ── Final response is the FIRST non-consecutive agent message ─────────

  it("final response is the first non-consecutive, rest become intermediate", () => {
    const items: PipelineItem[] = [
      userMsg("cmd"),
      agentMsg("thinking...", { isConsecutive: false }),
      agentMsg("still working", { isConsecutive: true }),
      agentMsg("done!", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // First non-consecutive is the final response
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content,
      "thinking..."
    );
    // Items after final response are also intermediate
    assert.strictEqual(result.latestGroup.items.length, 2);
  });

  // ── Cancel scenario: no final response, all agent msgs are consecutive ──

  it("cancel: all consecutive agent msgs → no finalResponse, all folded into banner", () => {
    const items: PipelineItem[] = [
      userMsg("do something"),
      thinkingItem("thinking..."),
      agentMsg("step 1", { isConsecutive: true }),
      agentMsg("step 2", { isConsecutive: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // All consecutive -> no non-consecutive agent -> finalResponse is null, all in items
    assert.strictEqual(result.latestGroup.finalResponse, null);
    assert.strictEqual(result.latestGroup.items.length, 3);
  });

  it("cancel after final response: finalResponse preserved, new turn starts", () => {
    const items: PipelineItem[] = [
      userMsg("q1"),
      thinkingItem("t1"),
      agentMsg("a1", { isConsecutive: false }),
      userMsg("q2"),
      thinkingItem("t2"),
      agentMsg("partial...", { isConsecutive: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    // Past turn: thinkingItem is consecutive, a1 is non-consecutive -> final = a1, intermediate = [t1]
    assert.strictEqual(result.groups[0].items.length, 1);
    assert.strictEqual(
      (result.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    // Latest turn: all consecutive -> no finalResponse
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.finalResponse, null);
    assert.strictEqual(result.latestGroup.items.length, 2);
  });

  // ── stopReason-based final response selection ────────────────────────

  describe("stopReason-based final response selection", () => {
    it("stopReason marks the final response even when isConsecutive is true", () => {
      // This is the key scenario: all agent messages are consecutive (streaming),
      // but the last one has stopReason set — it should be the final response.
      const items: PipelineItem[] = [
        userMsg("hello"),
        thinkingItem("thinking..."),
        agentMsg("chunk1", { isConsecutive: true }),
        agentMsg("chunk2", { isConsecutive: true, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      // The message with stopReason is the final response
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "chunk2"
      );
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).stopReason,
        "end_turn"
      );
      // Intermediate: thinking + chunk1 (chunk2 is the final response)
      assert.strictEqual(result.latestGroup.items.length, 2);
    });

    it("stopReason on middle message selects it as final, rest are intermediate", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("first", { isConsecutive: false }),
        agentMsg("second", { isConsecutive: true, stopReason: "max_tokens" }),
        agentMsg("third", { isConsecutive: true }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      // "second" has stopReason → it's the final response
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "second"
      );
      // first and third are intermediate
      assert.strictEqual(result.latestGroup.items.length, 2);
    });

    it("stopReason takes priority over isConsecutive detection", () => {
      // Both stopReason and isConsecutive=false exist — stopReason wins
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isConsecutive: false }),
        agentMsg("b", { isConsecutive: false, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      // "b" has stopReason → final response (not "a" which is first non-consecutive)
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "b"
      );
    });

    it("stopReason on past turn final response", () => {
      const items: PipelineItem[] = [
        // Turn 1 (past)
        userMsg("q1"),
        agentMsg("thinking...", { isConsecutive: true }),
        agentMsg("answer", { isConsecutive: true, stopReason: "end_turn" }),
        // Turn 2 (latest)
        userMsg("q2"),
        agentMsg("reply", { isConsecutive: false }),
      ];
      const result = groupByUserBoundary(items);
      assert.strictEqual(result.groups.length, 1);
      const past = result.groups[0];
      // Past turn: "answer" has stopReason → final response
      assert.ok(past.finalResponse);
      assert.strictEqual(
        (past.finalResponse.item as ChatDisplayItem).content,
        "answer"
      );
      assert.strictEqual(
        (past.finalResponse.item as ChatDisplayItem).stopReason,
        "end_turn"
      );
      // "thinking..." is intermediate
      assert.strictEqual(past.items.length, 1);
    });

    it("cancelled stopReason still marks final response", () => {
      const items: PipelineItem[] = [
        userMsg("do stuff"),
        thinkingItem("thinking..."),
        agentMsg("partial work", { isConsecutive: true, stopReason: "cancelled" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "partial work"
      );
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).stopReason,
        "cancelled"
      );
    });

    it("no stopReason falls back to isConsecutive detection", () => {
      // Without stopReason, the original isConsecutive logic applies
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isConsecutive: true }),
        agentMsg("b", { isConsecutive: false }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      // "b" is first non-consecutive → final response
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "b"
      );
    });

    it("all consecutive with no stopReason → no finalResponse", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isConsecutive: true }),
        agentMsg("b", { isConsecutive: true }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.strictEqual(result.latestGroup.finalResponse, null);
      assert.strictEqual(result.latestGroup.items.length, 2);
    });
  });

  // ── Latest group: peel-last-intermediate logic ───────────────────────

  describe("latest group: peel-last-intermediate for banner", () => {
    // Simulates the render-time split in SessionChatContainer:
    // allIntermediate = latestGroup.items (already excludes finalResponse)
    // olderIntermediate = allIntermediate.length > 2 ? slice(0, -1) : allIntermediate
    // lastIntermediate  = allIntermediate.length > 2 ? last item : null

    function splitForBanner(intermediate: PipelineItem[]): {
      older: PipelineItem[];
      last: PipelineItem | null;
    } {
      const older =
        intermediate.length > 2 ? intermediate.slice(0, -1) : intermediate;
      const last =
        intermediate.length > 2
          ? intermediate[intermediate.length - 1]
          : null;
      return { older, last };
    }

    it("0 intermediate → older=[], last=null", () => {
      const { older, last } = splitForBanner([]);
      assert.strictEqual(older.length, 0);
      assert.strictEqual(last, null);
    });

    it("1 intermediate → older=[A], last=null (all in banner)", () => {
      const A = thinkingItem("t");
      const { older, last } = splitForBanner([A]);
      assert.strictEqual(older.length, 1);
      assert.deepStrictEqual(older, [A]);
      assert.strictEqual(last, null);
    });

    it("2 intermediates → older=[A,B], last=null (all in banner)", () => {
      const A = thinkingItem("t1");
      const B = agentMsg("step", { isConsecutive: true });
      const { older, last } = splitForBanner([A, B]);
      assert.strictEqual(older.length, 2);
      assert.deepStrictEqual(older, [A, B]);
      assert.strictEqual(last, null);
    });

    it("3 intermediates → older=[A,B], last=C (last peeled out)", () => {
      const A = thinkingItem("t1");
      const B = agentMsg("step1", { isConsecutive: true });
      const C = agentMsg("step2", { isConsecutive: true });
      const { older, last } = splitForBanner([A, B, C]);
      assert.strictEqual(older.length, 2);
      assert.deepStrictEqual(older, [A, B]);
      assert.strictEqual(last, C);
    });

    it("4 intermediates → older=[A,B,C], last=D", () => {
      const items = [
        thinkingItem("t"),
        agentMsg("s1", { isConsecutive: true }),
        agentMsg("s2", { isConsecutive: true }),
        agentMsg("s3", { isConsecutive: true }),
      ];
      const { older, last } = splitForBanner(items);
      assert.strictEqual(older.length, 3);
      assert.deepStrictEqual(older, items.slice(0, 3));
      assert.strictEqual(last, items[3]);
    });
  });

  // ── New user message causes previous latest to become past group ──────

  it("new user message: previous latest becomes folded past group with final response", () => {
    const items: PipelineItem[] = [
      userMsg("q1"),
      thinkingItem("t1"),
      agentMsg("a1", { isConsecutive: false }),
      userMsg("q2"),
      agentMsg("a2", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    const past = result.groups[0];
    // thinkingItem is consecutive -> intermediate, a1 is non-consecutive -> final
    assert.strictEqual(past.items.length, 1);
    const pastThinking = past.items[0] as ChatDisplayItem;
    assert.strictEqual(pastThinking.thinking?.content, "t1");
    assert.strictEqual(
      (past.finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    // Latest turn: a2 is non-consecutive -> final, no intermediate
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.items.length, 0);
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content,
      "a2"
    );
  });
});
