import assert from "assert";
import { describe, it } from "mocha";
import type {
  PipelineItem,
  ChatDisplayItem,
  IntermediateStep,
} from "../../../pipeline/types";
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
    content,
    key: nextKey("agent"),
    timestamp: Date.now(),
    isFirstOfTurn: false,
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
    isFirstOfTurn: true,
    attachments: [],
    thinking: { content, isStreaming: false },
    ...overrides,
  };
}

function toolMsg(
  toolCallId: string,
  overrides: Partial<ChatDisplayItem> = {}
): ChatDisplayItem {
  return {
    type: "chat",
    role: "tool",
    agentId: "a1",
    content: `[tool result: ${toolCallId}]`,
    key: nextKey("tool"),
    timestamp: Date.now(),
    isFirstOfTurn: false,
    attachments: [],
    thinking: undefined,
    resolvedToolCalls: [
      {
        id: toolCallId,
        title: toolCallId,
        kind: "generic",
        status: "completed" as const,
        input: undefined,
        output: undefined,
        durationMs: undefined,
        locations: undefined,
        diffContent: undefined,
      },
    ],
    ...overrides,
  };
}

function groupByUserBoundary(items: PipelineItem[]): GroupedItems {
  return new IntermediateStepGrouper(items).compute();
}

function makeStep(
  agentMessage: ChatDisplayItem | null,
  toolCalls: ChatDisplayItem[] = []
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
      agentMsg("done!", { isFirstOfTurn: true }),
      agentMsg("Result: success", { isFirstOfTurn: false }),
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
      agentMsg("first answer", { isFirstOfTurn: false }),
      userMsg("second question"),
      agentMsg("second answer", { isFirstOfTurn: false }),
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
      agentMsg("running...", { isFirstOfTurn: true }),
      agentMsg("tests passed!", { isFirstOfTurn: false }),
      userMsg("commit changes"),
      agentMsg("committed", { isFirstOfTurn: false }),
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
      agentMsg("hi!", { isFirstOfTurn: false }),
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
      agentMsg("a", { isFirstOfTurn: true }),
      agentMsg("b", { isFirstOfTurn: true }),
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
    const toolMsg = agentMsg("using tool...", { isFirstOfTurn: true });
    const finalResponse = agentMsg("Here's the answer!", {
      isFirstOfTurn: false,
    });

    const items: PipelineItem[] = [
      userMsg("help me"),
      think,
      toolMsg,
      finalResponse,
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // thinking and toolMsg are intermediate steps
    assert.ok(result.latestGroup.steps.length >= 1);
    assert.strictEqual(result.latestGroup.finalResponse?.item, finalResponse);
  });

  // ── Multiple past turns all have final responses separated ───────────

  it("three turns: two past groups both have final responses", () => {
    const items: PipelineItem[] = [
      userMsg("q1"),
      thinkingItem("t1"),
      agentMsg("a1", { isFirstOfTurn: false }),
      userMsg("q2"),
      thinkingItem("t2"),
      agentMsg("a2", { isFirstOfTurn: false }),
      userMsg("q3"),
      thinkingItem("t3"),
      agentMsg("a3", { isFirstOfTurn: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 2);
    assert.ok(result.groups[0].steps.length >= 1);
    assert.strictEqual(
      (result.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    assert.ok(result.groups[1].steps.length >= 1);
    assert.strictEqual(
      (result.groups[1].finalResponse?.item as ChatDisplayItem).content,
      "a2"
    );
    assert.ok(result.latestGroup);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content,
      "a3"
    );
  });

  // ── Final response is the LAST non-consecutive agent message ─────────

  it("final response is the last non-consecutive, rest become intermediate", () => {
    const items: PipelineItem[] = [
      userMsg("cmd"),
      agentMsg("thinking...", { isFirstOfTurn: false }),
      agentMsg("still working", { isFirstOfTurn: true }),
      agentMsg("done!", { isFirstOfTurn: false }),
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
      agentMsg("step 1", { isFirstOfTurn: true }),
      agentMsg("step 2", { isFirstOfTurn: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "step 2"
    );
  });

  it("cancel after final response: finalResponse preserved, new turn starts", () => {
    const items: PipelineItem[] = [
      userMsg("q1"),
      thinkingItem("t1"),
      agentMsg("a1", { isFirstOfTurn: false }),
      userMsg("q2"),
      thinkingItem("t2"),
      agentMsg("partial...", { isFirstOfTurn: true }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    assert.ok(result.groups[0].steps.length >= 1);
    assert.strictEqual(
      (result.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    assert.ok(result.latestGroup);
    assert.ok(result.latestGroup.finalResponse);
    assert.strictEqual(
      (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
      "partial..."
    );
  });

  // ── stopReason-based final response selection ────────────────────────

  describe("stopReason-based final response selection", () => {
    it("stopReason marks the final response even when isFirstOfTurn is true", () => {
      const items: PipelineItem[] = [
        userMsg("hello"),
        thinkingItem("thinking..."),
        agentMsg("chunk1", { isFirstOfTurn: true }),
        agentMsg("chunk2", { isFirstOfTurn: true, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "chunk2"
      );
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).stopReason,
        "end_turn"
      );
    });

    it("stopReason on middle message selects it as final, rest are intermediate", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("first", { isFirstOfTurn: false }),
        agentMsg("second", { isFirstOfTurn: true, stopReason: "max_tokens" }),
        agentMsg("third", { isFirstOfTurn: true }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "second"
      );
    });

    it("stopReason takes priority over isFirstOfTurn detection", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isFirstOfTurn: false }),
        agentMsg("b", { isFirstOfTurn: false, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "b"
      );
    });

    it("stopReason on past turn final response", () => {
      const items: PipelineItem[] = [
        userMsg("q1"),
        agentMsg("thinking...", { isFirstOfTurn: true }),
        agentMsg("answer", { isFirstOfTurn: true, stopReason: "end_turn" }),
        userMsg("q2"),
        agentMsg("reply", { isFirstOfTurn: false }),
      ];
      const result = groupByUserBoundary(items);
      assert.strictEqual(result.groups.length, 1);
      const past = result.groups[0];
      assert.ok(past.finalResponse);
      assert.strictEqual(
        (past.finalResponse.item as ChatDisplayItem).content,
        "answer"
      );
      assert.strictEqual(
        (past.finalResponse.item as ChatDisplayItem).stopReason,
        "end_turn"
      );
    });

    it("cancelled stopReason still marks final response", () => {
      const items: PipelineItem[] = [
        userMsg("do stuff"),
        thinkingItem("thinking..."),
        agentMsg("partial work", {
          isFirstOfTurn: true,
          stopReason: "cancelled",
        }),
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

    it("no stopReason falls back to isFirstOfTurn detection", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isFirstOfTurn: true }),
        agentMsg("b", { isFirstOfTurn: false }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "b"
      );
    });

    it("all consecutive with no stopReason → fallback picks last as finalResponse", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        agentMsg("a", { isFirstOfTurn: true }),
        agentMsg("b", { isFirstOfTurn: true }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "b"
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
        const B = makeStep(agentMsg("step", { isFirstOfTurn: true }));
        const { olderSteps, currentStep } = splitLatestSteps([A, B], false);
        assert.strictEqual(olderSteps.length, 1);
        assert.deepStrictEqual(olderSteps, [A]);
        assert.strictEqual(currentStep, B);
      });

      it("3 steps → older=[A,B], current=C (last peeled out)", () => {
        const A = makeStep(thinkingItem("t1"));
        const B = makeStep(agentMsg("step1", { isFirstOfTurn: true }));
        const C = makeStep(agentMsg("step2", { isFirstOfTurn: true }));
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
        const B = makeStep(agentMsg("step", { isFirstOfTurn: true }));
        const { olderSteps, currentStep } = splitLatestSteps([A, B], true);
        assert.strictEqual(olderSteps.length, 2);
        assert.deepStrictEqual(olderSteps, [A, B]);
        assert.strictEqual(currentStep, null);
      });
    });

    describe("integration: groupByUserBoundary → splitLatestSteps", () => {
      it("no final response, 2 steps → last peeled out", () => {
        const items: PipelineItem[] = [
          userMsg("do stuff"),
          thinkingItem("thinking..."),
          agentMsg("working...", { isFirstOfTurn: true }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);
        assert.strictEqual(
          (latestGroup.finalResponse.item as ChatDisplayItem).content,
          "working..."
        );

        const { olderSteps, currentStep } = splitLatestSteps(
          latestGroup.steps,
          latestGroup.finalResponse != null
        );
        // With final, all steps are older (folded in banner)
        assert.strictEqual(currentStep, null);
        assert.ok(olderSteps.length >= 1);
      });

      it("final response arrived, 2 steps → all in banner", () => {
        const items: PipelineItem[] = [
          userMsg("do stuff"),
          thinkingItem("thinking..."),
          agentMsg("working...", { isFirstOfTurn: true }),
          agentMsg("done!", { isFirstOfTurn: false }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.steps.length >= 1);
        assert.ok(latestGroup.finalResponse);

        const { olderSteps, currentStep } = splitLatestSteps(
          latestGroup.steps,
          latestGroup.finalResponse != null
        );
        assert.ok(olderSteps.length >= 1);
        assert.strictEqual(currentStep, null);
      });

      it("no final response, 1 step → last peeled out, banner empty", () => {
        const items: PipelineItem[] = [
          userMsg("hello"),
          thinkingItem("thinking..."),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);

        const { olderSteps, currentStep } = splitLatestSteps(
          latestGroup.steps,
          latestGroup.finalResponse != null
        );
        assert.strictEqual(currentStep, null);
      });

      it("final response with stopReason, steps → all in banner", () => {
        const items: PipelineItem[] = [
          userMsg("q"),
          thinkingItem("t"),
          agentMsg("s1", { isFirstOfTurn: true }),
          agentMsg("s2", { isFirstOfTurn: true }),
          agentMsg("final", { isFirstOfTurn: true, stopReason: "end_turn" }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);

        const { olderSteps, currentStep } = splitLatestSteps(
          latestGroup.steps,
          latestGroup.finalResponse != null
        );
        assert.ok(olderSteps.length >= 1);
        assert.strictEqual(currentStep, null);
      });

      it("cancel: no final, 0 steps → older=[], current=null", () => {
        const items: PipelineItem[] = [userMsg("q")];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.strictEqual(latestGroup.steps.length, 0);
        assert.strictEqual(latestGroup.finalResponse, null);

        const { olderSteps, currentStep } = splitLatestSteps(
          latestGroup.steps,
          latestGroup.finalResponse != null
        );
        assert.strictEqual(olderSteps.length, 0);
        assert.strictEqual(currentStep, null);
      });

      it("non-consecutive after consecutive: final picked, rest intermediate → split", () => {
        const items: PipelineItem[] = [
          userMsg("do stuff"),
          thinkingItem("thinking..."),
          agentMsg("working...", { isFirstOfTurn: true }),
          agentMsg("done!", { isFirstOfTurn: false }),
        ];
        const { latestGroup } = groupByUserBoundary(items);
        assert.ok(latestGroup);
        assert.ok(latestGroup.finalResponse);
        assert.strictEqual(
          (latestGroup.finalResponse.item as ChatDisplayItem).content,
          "done!"
        );

        const { olderSteps, currentStep } = splitLatestSteps(
          latestGroup.steps,
          latestGroup.finalResponse != null
        );
        assert.ok(olderSteps.length >= 1);
        assert.strictEqual(currentStep, null);
      });
    });
  });

  // ── New user message causes previous latest to become past group ──────

  it("new user message: previous latest becomes folded past group with final response", () => {
    const items: PipelineItem[] = [
      userMsg("q1"),
      thinkingItem("t1"),
      agentMsg("a1", { isFirstOfTurn: false }),
      userMsg("q2"),
      agentMsg("a2", { isFirstOfTurn: false }),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    const past = result.groups[0];
    assert.ok(past.steps.length >= 1);
    assert.strictEqual(
      (past.finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup.steps.length, 0);
    assert.strictEqual(
      (result.latestGroup.finalResponse?.item as ChatDisplayItem).content,
      "a2"
    );
  });

  // ── selectFinalResponse must not select tool items ─────────────────────

  describe("selectFinalResponse rejects tool items", () => {
    it("tool item with isFirstOfTurn=true is NOT selected as finalResponse", () => {
      const items: PipelineItem[] = [
        userMsg("hello"),
        agentMsg("I'll check", {
          isFirstOfTurn: true,
          stopReason: "tool_use",
        }),
        toolMsg("call-1", { isFirstOfTurn: true }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      // Must NOT be the tool item
      const fr = result.latestGroup.finalResponse.item as ChatDisplayItem;
      assert.strictEqual(fr.role, "agent");
      assert.strictEqual(fr.content, "I'll check");
      assert.strictEqual(fr.stopReason, "tool_use");
    });

    it("only tool items after agent → no finalResponse from tools selected", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        toolMsg("call-1", { isFirstOfTurn: true }),
        toolMsg("call-2", { isFirstOfTurn: true }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      // No agent message → no finalResponse (pre-agent steps only)
      assert.strictEqual(result.latestGroup.finalResponse, null);
      // But steps should capture both tool calls as pre-agent
      assert.strictEqual(result.latestGroup.steps.length, 1);
      assert.strictEqual(result.latestGroup.steps[0].isPreAgent, true);
      assert.strictEqual(result.latestGroup.steps[0].toolCalls.length, 2);
    });
  });

  // ── Tool calls after final agent message → currentStep ──────────────────

  describe("tool calls after final response belong to currentStep", () => {
    it("one tool call after agent-stopReason → currentStep holds it", () => {
      const items: PipelineItem[] = [
        userMsg("do it"),
        agentMsg("result", { isFirstOfTurn: true, stopReason: "end_turn" }),
        toolMsg("call-1", { isFirstOfTurn: false }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "result"
      );
      // currentStep carries the tool call alongside the final agent message
      assert.ok(result.latestGroup.currentStep);
      assert.strictEqual(
        result.latestGroup.currentStep.agentMessage?.content,
        "result"
      );
      assert.strictEqual(result.latestGroup.currentStep.toolCalls.length, 1);
      assert.strictEqual(
        result.latestGroup.currentStep.toolCalls[0].role,
        "tool"
      );
    });

    it("multiple tool calls after agent → all in currentStep", () => {
      const items: PipelineItem[] = [
        userMsg("go"),
        agentMsg("done", { isFirstOfTurn: true, stopReason: "end_turn" }),
        toolMsg("c1"),
        toolMsg("c2"),
        toolMsg("c3"),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup?.currentStep);
      assert.strictEqual(
        result.latestGroup.currentStep.agentMessage?.content,
        "done"
      );
      assert.strictEqual(result.latestGroup.currentStep.toolCalls.length, 3);
    });

    it("tool calls before any agent message → pre-agent step", () => {
      const items: PipelineItem[] = [
        userMsg("go"),
        toolMsg("c1", { isFirstOfTurn: true }),
        toolMsg("c2", { isFirstOfTurn: true }),
        agentMsg("got it", { isFirstOfTurn: true, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "got it"
      );
      // Pre-agent tool calls → intermediate steps (no agentMessage)
      assert.strictEqual(result.latestGroup.steps.length, 1);
      assert.strictEqual(result.latestGroup.steps[0].isPreAgent, true);
      assert.strictEqual(result.latestGroup.steps[0].toolCalls.length, 2);
      // No currentStep because no tool calls after the final agent
      assert.strictEqual(result.latestGroup.currentStep, null);
    });
  });

  // ── New agent message shifts previous step into intermediate ────────────

  describe("new agent message shifts previous into intermediate steps", () => {
    it("agent → tool → agent: first pair becomes intermediate, last agent is final", () => {
      const items: PipelineItem[] = [
        userMsg("task"),
        agentMsg("step1", { isFirstOfTurn: true, stopReason: "tool_use" }),
        toolMsg("c1"),
        agentMsg("step2", { isFirstOfTurn: true, stopReason: "end_turn" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      // finalResponse = step2
      assert.ok(result.latestGroup.finalResponse);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "step2"
      );
      // step1 + tool c1 → folded into intermediate steps
      assert.strictEqual(result.latestGroup.steps.length, 1);
      const inter = result.latestGroup.steps[0];
      assert.strictEqual(inter.agentMessage?.content, "step1");
      assert.strictEqual(inter.toolCalls.length, 1);
      assert.strictEqual(inter.toolCalls[0].role, "tool");
      // Final response has no trailing tool calls
      assert.strictEqual(result.latestGroup.currentStep, null);
    });

    it("agent → tool → agent → tool: intermediate captures first pair, currentStep captures last pair", () => {
      const items: PipelineItem[] = [
        userMsg("task"),
        agentMsg("s1", { isFirstOfTurn: true, stopReason: "tool_use" }),
        toolMsg("c1"),
        agentMsg("s2", { isFirstOfTurn: true, stopReason: "end_turn" }),
        toolMsg("c2"),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      // finalResponse = s2
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "s2"
      );
      // s1 + c1 → intermediate
      assert.strictEqual(result.latestGroup.steps.length, 1);
      assert.strictEqual(
        result.latestGroup.steps[0].agentMessage?.content,
        "s1"
      );
      assert.strictEqual(result.latestGroup.steps[0].toolCalls.length, 1);
      // s2 + c2 → currentStep
      assert.ok(result.latestGroup.currentStep);
      assert.strictEqual(
        result.latestGroup.currentStep.agentMessage?.content,
        "s2"
      );
      assert.strictEqual(result.latestGroup.currentStep.toolCalls.length, 1);
    });

    it("two complete pairs in single turn → first intermediate, second final+currentStep", () => {
      const items: PipelineItem[] = [
        userMsg("do it"),
        thinkingItem("hmm"),
        agentMsg("checking...", {
          isFirstOfTurn: true,
          stopReason: "tool_use",
        }),
        toolMsg("read"),
        toolMsg("search"),
        agentMsg("result", { isFirstOfTurn: true, stopReason: "end_turn" }),
        toolMsg("write"),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).content,
        "result"
      );
      // Intermediate: thinking + checking + read + search
      assert.strictEqual(result.latestGroup.steps.length, 2);
      assert.strictEqual(result.latestGroup.steps[0].isPreAgent, true); // thinking
      assert.strictEqual(
        result.latestGroup.steps[1].agentMessage?.content,
        "checking..."
      );
      assert.strictEqual(result.latestGroup.steps[1].toolCalls.length, 2);
      // currentStep: result + write
      assert.ok(result.latestGroup.currentStep);
      assert.strictEqual(
        result.latestGroup.currentStep.agentMessage?.content,
        "result"
      );
      assert.strictEqual(result.latestGroup.currentStep.toolCalls.length, 1);
    });
  });

  // ── messageId-boundary: streaming chunks with same messageId merge ───────

  describe("messageId boundary: same-messageId chunks merge", () => {
    it("chunk → tool → chunk (same messageId) → single step", () => {
      const items: PipelineItem[] = [
        userMsg("go"),
        agentMsg("chunk1", {
          isFirstOfTurn: true,
          messageId: "msg-A",
          stopReason: "tool_use",
        }),
        toolMsg("c1"),
        agentMsg("chunk2", { isFirstOfTurn: true, messageId: "msg-A" }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      // All three (chunk1+chunk2 + tool c1) in one intermediate step
      assert.strictEqual(result.latestGroup.steps.length, 1);
      const step = result.latestGroup.steps[0];
      assert.strictEqual(step.agentMessage?.content, "chunk1chunk2");
      assert.strictEqual(step.toolCalls.length, 1);
    });

    it("different messageId → separate steps", () => {
      const items: PipelineItem[] = [
        userMsg("go"),
        agentMsg("msg1", {
          isFirstOfTurn: true,
          messageId: "id-1",
          stopReason: "tool_use",
        }),
        toolMsg("c1"),
        agentMsg("msg2", {
          isFirstOfTurn: true,
          messageId: "id-2",
          stopReason: "end_turn",
        }),
      ];
      const result = groupByUserBoundary(items);
      assert.ok(result.latestGroup);
      // msg1 + c1 → intermediate, msg2 → final
      assert.strictEqual(result.latestGroup.steps.length, 1);
      assert.strictEqual(
        result.latestGroup.steps[0].agentMessage?.messageId,
        "id-1"
      );
      assert.strictEqual(
        (result.latestGroup.finalResponse.item as ChatDisplayItem).messageId,
        "id-2"
      );
    });
  });

  // ── selectFinalResponse isolates stopReason to agent items ──────────────

  describe("selectFinalResponse isolates stopReason to agent items", () => {
    it("agent with end_turn selected, ignoring tool items", () => {
      const agent = agentMsg("end", { stopReason: "end_turn" });
      const tool = toolMsg("t");
      const result = selectFinalResponse([tool, agent, tool]);
      assert.ok(result);
      assert.strictEqual(result.item, agent);
    });

    it("no agent with stopReason, tools with isFirstOfTurn ignored", () => {
      const t1 = toolMsg("t1", { isFirstOfTurn: true });
      const t2 = toolMsg("t2", { isFirstOfTurn: true });
      const result = selectFinalResponse([t1, t2]);
      assert.strictEqual(result, null);
    });

    it("agent with non-end_turn stopReason selected over tools", () => {
      const agent = agentMsg("mid", { stopReason: "tool_use" });
      const tool = toolMsg("t", { isFirstOfTurn: true });
      const result = selectFinalResponse([tool, agent]);
      assert.ok(result);
      assert.strictEqual(result.item, agent);
    });
  });
});
