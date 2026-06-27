import assert from "assert";
import { describe, it } from "mocha";
import type { PipelineItem, ChatDisplayItem, IntermediateStep } from "../../../pipeline/types";
import {
  selectFinalResponse,
  splitLatestSteps,
  type AgentResponseGroup,
  type GroupedItems,
} from "../../../pipeline/stages/grouping";
import { IntermediateStepGrouper } from "../../../pipeline/stages/grouping";

// ── Helpers ─────────────────────────────────────────────────────────────────

let keyCounter = 0;
function nextKey(prefix: string): string {
  return `${prefix}-${++keyCounter}`;
}

function userMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "user", agentId: "a1", content, key: nextKey("user"),
    timestamp: Date.now(), isConsecutive: false, groupKey: "user",
    attachments: [], thinking: undefined, ...overrides,
  };
}

function agentMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "agent", agentId: "a1", content, key: nextKey("agent"),
    timestamp: Date.now(), isConsecutive: false, groupKey: "agent:a1",
    attachments: [], thinking: undefined, ...overrides,
  };
}

function thinkingItem(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "agent", agentId: "a1", content: "", key: nextKey("think"),
    timestamp: Date.now(), isConsecutive: true, groupKey: "agent:a1",
    attachments: [], thinking: { content, isStreaming: false }, ...overrides,
  };
}

function groupByUserBoundary(items: PipelineItem[]): GroupedItems {
  return new IntermediateStepGrouper(items).compute();
}

function makeStep(
  agentMessage: ChatDisplayItem | null,
  toolCalls: ChatDisplayItem[] = [],
): IntermediateStep {
  return { agentMessage, toolCalls, isPreAgent: agentMessage == null };
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
    assert.strictEqual(result.latestGroup.steps.length, 0);
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
    // thinking + done! are intermediate steps, Result: success is final
    assert.ok(result.latestGroup.steps.length >= 1);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "Result: success"
    );
  });

  // ── Multiple turns ────────────────────────────────────────────────────

  it("multiple turns: past group folded completely", () => {
    const items: PipelineItem[] = [
      userMsg("first question"),
      thinkingItem("thinking about first"),
      agentMsg("first answer", { isConsecutive: false }),
      userMsg("second question"),
      agentMsg("second answer", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    const pastGroup = result.groups[0];
    assert.ok(pastGroup.steps.length >= 1);
    assert.ok(pastGroup.finalResponse);
    assert.strictEqual(
      (pastGroup.finalResponse.item as ChatDisplayItem).content,
      "first answer"
    );
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.steps.length, 0);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "second answer"
    );
  });

  it("past turn with everything folded except final response", () => {
    const items: PipelineItem[] = [
      userMsg("run tests"),
      thinkingItem("checking tests"),
      agentMsg("running...", { isConsecutive: true }),
      agentMsg("tests passed!", { isConsecutive: false }),
      userMsg("commit changes"),
      agentMsg("committed", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    const past = result.groups[0];
    assert.ok(past.steps.length >= 1);
    assert.ok(past.finalResponse);
    assert.strictEqual(
      (past.finalResponse.item as ChatDisplayItem).content,
      "tests passed!"
    );
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.steps.length, 0);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content,
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

  it("all consecutive agent msgs → fallback picks last agent as finalResponse", () => {
    const items: PipelineItem[] = [
      userMsg("hello"),
      agentMsg("a", { isConsecutive: true }),
      agentMsg("b", { isConsecutive: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "b"
    );
  });

  // ── Banner items exclude the final response ─────────────────────────

  it("banner items exclude the final response", () => {
    const think = thinkingItem("thinking...");
    const toolMsg = agentMsg("using tool...", { isConsecutive: true });
    const finalResponse = agentMsg("Here's the answer!", { isConsecutive: false });

    const items: PipelineItem[] = [userMsg("help me"), think, toolMsg, finalResponse];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // thinking and toolMsg are intermediate steps
    assert.ok(result.latestGroup.steps.length >= 1);
    assert.strictEqual(result.latestGroup.finalResponse?.item, finalResponse);
  });

  // ── Multiple past turns all have final responses separated ───────────

  it("three turns: two past groups both have final responses", () => {
    const items: PipelineItem[] = [
      userMsg("q1"), thinkingItem("t1"), agentMsg("a1", { isConsecutive: false }),
      userMsg("q2"), thinkingItem("t2"), agentMsg("a2", { isConsecutive: false }),
      userMsg("q3"), thinkingItem("t3"), agentMsg("a3", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 2);
    assert.ok(result.groups[0].steps.length >= 1);
    assert.strictEqual(
      (result.groups[0].finalResponse?.item as ChatDisplayItem).content, "a1"
    );
    assert.ok(result.groups[1].steps.length >= 1);
    assert.strictEqual(
      (result.groups[1].finalResponse?.item as ChatDisplayItem).content, "a2"
    );
    assert.ok(result.latestGroup);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content, "a3"
    );
  });

  // ── Final response is the LAST non-consecutive agent message ─────────

  it("final response is the last non-consecutive, rest become intermediate", () => {
    const items: PipelineItem[] = [
      userMsg("cmd"),
      agentMsg("thinking...", { isConsecutive: false }),
      agentMsg("still working", { isConsecutive: true }),
      agentMsg("done!", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // selectFinalResponse picks the LAST non-consecutive agent = "done!"
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content,
      "done!"
    );
  });

  // ── Cancel scenarios ─────────────────────────────────────────────────

  it("cancel: all consecutive agent msgs → fallback picks last as finalResponse", () => {
    const items: PipelineItem[] = [
      userMsg("do something"),
      thinkingItem("thinking..."),
      agentMsg("step 1", { isConsecutive: true }),
      agentMsg("step 2", { isConsecutive: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "step 2"
    );
  });

  it("cancel after final response: finalResponse preserved, new turn starts", () => {
    const items: PipelineItem[] = [
      userMsg("q1"), thinkingItem("t1"), agentMsg("a1", { isConsecutive: false }),
      userMsg("q2"), thinkingItem("t2"), agentMsg("partial...", { isConsecutive: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    assert.ok(result.groups[0].steps.length >= 1);
    assert.strictEqual(
      (result.groups[0].finalResponse?.item as ChatDisplayItem).content, "a1"
    );
    assert.ok(result.latestGroup);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "partial..."
    );
  });

  // ── stopReason-based final response selection ────────────────────────

  describe("stopReason-based final response selection", () => {
    it("stopReason marks the final response even when isConsecutive is true", () => {
      const items: PipelineItem[] = [
        userMsg("hello"),
        thinkingItem("thinking..."),
        agentMsg("chunk1", { isConsecutive: true }),
        agentMsg("chunk2", { isConsecutive: true, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "chunk2"
      );
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).stopReason, "end_turn"
      );
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
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "second"
      );
    });

    it("stopReason takes priority over isConsecutive detection", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isConsecutive: false }),
        agentMsg("b", { isConsecutive: false, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "b"
      );
    });

    it("stopReason on past turn final response", () => {
      const items: PipelineItem[] = [
        userMsg("q1"),
        agentMsg("thinking...", { isConsecutive: true }),
        agentMsg("answer", { isConsecutive: true, stopReason: "end_turn" }),
        userMsg("q2"),
        agentMsg("reply", { isConsecutive: false }),
      ];
      const result = groupByUserBoundary(items);
      assert.strictEqual(result.groups.length, 1);
      const past = result.groups[0];
      assert.ok(past.finalResponse);
      assert.strictEqual(
        (past.finalResponse.item as ChatDisplayItem).content, "answer"
      );
      assert.strictEqual(
        (past.finalResponse.item as ChatDisplayItem).stopReason, "end_turn"
      );
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
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "partial work"
      );
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).stopReason, "cancelled"
      );
    });

    it("no stopReason falls back to isConsecutive detection", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isConsecutive: true }),
        agentMsg("b", { isConsecutive: false }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "b"
      );
    });

    it("all consecutive with no stopReason → fallback picks last as finalResponse", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isConsecutive: true }),
        agentMsg("b", { isConsecutive: true }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content, "b"
      );
    });
  });

  // ── Latest group: splitLatestSteps (render-time logic) ───────────────

  describe("splitLatestSteps", () => {
    describe("before final response (hasFinal=false)", () => {
      it("0 steps → older=[], current=null", () => {
        const { olderSteps, currentStep } = splitLatestSteps([], false);
        assert.strictEqual(olderSteps.length, 0);
        assert.strictEqual(currentStep, null);
      });

      it("1 step → older=[], current=A (last peeled out)", () => {
        const A = thinkingItem("t");
        const step = makeStep(A);
        const { olderSteps, currentStep } = splitLatestSteps([step], false);
        assert.strictEqual(olderSteps.length, 0);
        assert.strictEqual(currentStep, step);
      });

      it("2 steps → older=[A], current=B (last peeled out)", () => {
        const A = makeStep(thinkingItem("t1"));
        const B = makeStep(agentMsg("step", { isConsecutive: true }));
        const { olderSteps, currentStep } = splitLatestSteps([A, B], false);
        assert.strictEqual(olderSteps.length, 1);
        assert.deepStrictEqual(olderSteps, [A]);
        assert.strictEqual(currentStep, B);
      });

      it("3 steps → older=[A,B], current=C (last peeled out)", () => {
        const A = makeStep(thinkingItem("t1"));
        const B = makeStep(agentMsg("step1", { isConsecutive: true }));
        const C = makeStep(agentMsg("step2", { isConsecutive: true }));
        const { olderSteps, currentStep } = splitLatestSteps([A, B, C], false);
        assert.strictEqual(olderSteps.length, 2);
        assert.deepStrictEqual(olderSteps, [A, B]);
        assert.strictEqual(currentStep, C);
      });
    });

    describe("after final response (hasFinal=true)", () => {
      it("0 steps → older=[], current=null", () => {
        const { olderSteps, currentStep } = splitLatestSteps([], true);
        assert.strictEqual(olderSteps.length, 0);
        assert.strictEqual(currentStep, null);
      });

      it("1 step → older=[A], current=null (all in banner)", () => {
        const A = makeStep(thinkingItem("t"));
        const { olderSteps, currentStep } = splitLatestSteps([A], true);
        assert.strictEqual(olderSteps.length, 1);
        assert.deepStrictEqual(olderSteps, [A]);
        assert.strictEqual(currentStep, null);
      });

      it("2 steps → older=[A,B], current=null (all in banner)", () => {
        const A = makeStep(thinkingItem("t1"));
        const B = makeStep(agentMsg("step", { isConsecutive: true }));
        const { olderSteps, currentStep } = splitLatestSteps([A, B], true);
        assert.strictEqual(olderSteps.length, 2);
        assert.deepStrictEqual(olderSteps, [A, B]);
        assert.strictEqual(currentStep, null);
      });
    });

    describe("integration: groupByUserBoundary → splitLatestSteps", () => {
      it("no final response, 2 steps → last peeled out", () => {
        const items: PipelineItem[] = [
          userMsg("do stuff"), thinkingItem("thinking..."),
          agentMsg("working...", { isConsecutive: true }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);
        assert.strictEqual(
          (latestGroup.finalResponse.item as ChatDisplayItem).content, "working..."
        );

        const { olderSteps, currentStep } =
          splitLatestSteps(latestGroup.steps, latestGroup.finalResponse != null);
        // With final, all steps are older (folded in banner)
        assert.strictEqual(currentStep, null);
        assert.ok(olderSteps.length >= 1);
      });

      it("final response arrived, 2 steps → all in banner", () => {
        const items: PipelineItem[] = [
          userMsg("do stuff"), thinkingItem("thinking..."),
          agentMsg("working...", { isConsecutive: true }),
          agentMsg("done!", { isConsecutive: false }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.steps.length >= 1);
        assert.ok(latestGroup.finalResponse);

        const { olderSteps, currentStep } =
          splitLatestSteps(latestGroup.steps, latestGroup.finalResponse != null);
        assert.ok(olderSteps.length >= 1);
        assert.strictEqual(currentStep, null);
      });

      it("no final response, 1 step → last peeled out, banner empty", () => {
        const items: PipelineItem[] = [userMsg("hello"), thinkingItem("thinking...")];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);

        const { olderSteps, currentStep } =
          splitLatestSteps(latestGroup.steps, latestGroup.finalResponse != null);
        assert.strictEqual(currentStep, null);
      });

      it("final response with stopReason, steps → all in banner", () => {
        const items: PipelineItem[] = [
          userMsg("q"), thinkingItem("t"),
          agentMsg("s1", { isConsecutive: true }),
          agentMsg("s2", { isConsecutive: true }),
          agentMsg("final", { isConsecutive: true, stopReason: "end_turn" }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);

        const { olderSteps, currentStep } =
          splitLatestSteps(latestGroup.steps, latestGroup.finalResponse != null);
        assert.ok(olderSteps.length >= 1);
        assert.strictEqual(currentStep, null);
      });

      it("cancel: no final, 0 steps → older=[], current=null", () => {
        const items: PipelineItem[] = [userMsg("q")];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.strictEqual(latestGroup.steps.length, 0);
        assert.strictEqual(latestGroup.finalResponse, null);

        const { olderSteps, currentStep } =
          splitLatestSteps(latestGroup.steps, latestGroup.finalResponse != null);
        assert.strictEqual(olderSteps.length, 0);
        assert.strictEqual(currentStep, null);
      });

      it("non-consecutive after consecutive: final picked, rest intermediate → split", () => {
        const items: PipelineItem[] = [
          userMsg("do stuff"), thinkingItem("thinking..."),
          agentMsg("working...", { isConsecutive: true }),
          agentMsg("done!", { isConsecutive: false }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);
        assert.strictEqual(
          (latestGroup.finalResponse.item as ChatDisplayItem).content, "done!"
        );

        const { olderSteps, currentStep } =
          splitLatestSteps(latestGroup.steps, latestGroup.finalResponse != null);
        assert.ok(olderSteps.length >= 1);
        assert.strictEqual(currentStep, null);
      });
    });
  });

  // ── New user message causes previous latest to become past group ──────

  it("new user message: previous latest becomes folded past group with final response", () => {
    const items: PipelineItem[] = [
      userMsg("q1"), thinkingItem("t1"), agentMsg("a1", { isConsecutive: false }),
      userMsg("q2"), agentMsg("a2", { isConsecutive: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    const past = result.groups[0];
    assert.ok(past.steps.length >= 1);
    assert.strictEqual(
      (past.finalResponse?.item as ChatDisplayItem).content, "a1"
    );
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.steps.length, 0);
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content, "a2"
    );
  });
});
