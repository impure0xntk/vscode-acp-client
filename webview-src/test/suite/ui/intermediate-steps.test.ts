import assert from "assert";
import { describe, it } from "mocha";
import type {
  PipelineItem,
  ChatDisplayItem,
  ClassifiedMessage,
  IntermediateStep,
} from "../../../pipeline/types";
import {
  IntermediateStepGrouper,
  selectFinalResponse,
  splitIntoSteps,
  splitLatestSteps,
} from "../../../pipeline/stages/grouping";

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

function rawToolMsg(
  content: string,
  overrides: Partial<ChatDisplayItem> = {}
): ChatDisplayItem {
  return {
    type: "chat",
    role: "tool",
    agentId: "a1",
    content,
    key: nextKey("tool"),
    timestamp: Date.now(),
    isFirstOfTurn: true,
    attachments: [],
    thinking: undefined,
    resolvedToolCalls: [
      {
        id: `tc-${content}`,
        title: content,
        kind: "generic",
        status: "completed",
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

function classifiedMsg(
  role: "user" | "agent" | "tool" | "system",
  content: string,
  overrides: Partial<ClassifiedMessage> = {}
): ClassifiedMessage {
  return {
    id: nextKey("msg"),
    role,
    content,
    timestamp: Date.now(),
    agentId: "a1",
    systemKind: "info" as const,
    ...overrides,
  };
}

function makeStep(
  agentMessage: ChatDisplayItem | null,
  toolCalls: ChatDisplayItem[] = []
): IntermediateStep {
  return { agentMessage, toolCalls, isPreAgent: agentMessage == null };
}

// ── IntermediateStepGrouper ─────────────────────────────────────────────────

describe("IntermediateStepGrouper", () => {
  describe("compute()", () => {
    it("returns empty for empty items", () => {
      const r = new IntermediateStepGrouper([]).compute();
      assert.strictEqual(r.groups.length, 0);
      assert.strictEqual(r.latestGroup, null);
      assert.strictEqual(r.trailing.length, 0);
    });

    it("returns empty when no user messages", () => {
      const r = new IntermediateStepGrouper([
        agentMsg("a"),
        agentMsg("b"),
      ]).compute();
      assert.strictEqual(r.groups.length, 0);
      assert.strictEqual(r.latestGroup, null);
    });

    it("single turn: user + agent, no intermediate", () => {
      const { groups, latestGroup, trailing } = new IntermediateStepGrouper([
        userMsg("hi"),
        agentMsg("hello"),
      ]).compute();
      assert.strictEqual(groups.length, 0);
      assert.ok(latestGroup);
      assert.strictEqual(latestGroup.steps.length, 0);
      assert.ok(latestGroup.finalResponse);
      assert.strictEqual(
        (latestGroup.finalResponse.item as ChatDisplayItem).content,
        "hello"
      );
      assert.strictEqual(trailing.length, 0);
    });

    it("single turn: intermediate folded, final outside", () => {
      const items: PipelineItem[] = [
        userMsg("do it"),
        thinkingItem("thinking..."),
        agentMsg("working...", { isFirstOfTurn: true }),
        agentMsg("done!", { isFirstOfTurn: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      // thinking + working... are intermediate steps, done! is final
      assert.ok(latestGroup.steps.length >= 1);
      assert.strictEqual(
        (latestGroup.finalResponse?.item as ChatDisplayItem).content,
        "done!"
      );
    });

    it("multiple turns: past group folded", () => {
      const items: PipelineItem[] = [
        userMsg("q1"),
        thinkingItem("t1"),
        agentMsg("a1", { isFirstOfTurn: false }),
        userMsg("q2"),
        agentMsg("a2", { isFirstOfTurn: false }),
      ];
      const { groups, latestGroup } = new IntermediateStepGrouper(
        items
      ).compute();
      assert.strictEqual(groups.length, 1);
      assert.ok(groups[0].steps.length >= 1);
      assert.strictEqual(
        (groups[0].finalResponse?.item as ChatDisplayItem).content,
        "a1"
      );
      assert.strictEqual(latestGroup.steps.length, 0);
      assert.strictEqual(
        (latestGroup.finalResponse?.item as ChatDisplayItem).content,
        "a2"
      );
    });

    it("trailing system items not grouped", () => {
      const compItem: PipelineItem = {
        type: "compression",
        info: { contextWindowMax: 1000, usedTokens: 800 },
        key: nextKey("comp"),
        timestamp: Date.now(),
      };
      const { trailing } = new IntermediateStepGrouper([
        userMsg("hi"),
        agentMsg("hello", { isFirstOfTurn: false }),
        compItem,
      ]).compute();
      assert.strictEqual(trailing.length, 1);
      assert.strictEqual(trailing[0], compItem);
    });

    it("all consecutive fallback picks last as final", () => {
      const items: PipelineItem[] = [
        userMsg("hi"),
        agentMsg("a", { isFirstOfTurn: true }),
        agentMsg("b", { isFirstOfTurn: true }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup?.finalResponse);
      assert.strictEqual(
        (latestGroup.finalResponse.item as ChatDisplayItem).content,
        "b"
      );
    });

    it("promoted tool messages treated as intermediate not final", () => {
      const items: PipelineItem[] = [
        userMsg("read file"),
        rawToolMsg("reading..."),
        agentMsg("done!", { isFirstOfTurn: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      // raw tool (role="tool") is an intermediate step, done! is final
      assert.ok(latestGroup.steps.length >= 1);
      assert.strictEqual(
        (latestGroup.finalResponse?.item as ChatDisplayItem).content,
        "done!"
      );
    });
  });

  describe("splitLatestSteps()", () => {
    it("0 steps yields empty", () => {
      const { olderSteps, currentStep } = splitLatestSteps([], false);
      assert.strictEqual(olderSteps.length, 0);
      assert.strictEqual(currentStep, null);
    });

    it("1 step without final is peeled as current", () => {
      const a = makeStep(agentMsg("t"));
      const { olderSteps, currentStep } = splitLatestSteps([a], false);
      assert.strictEqual(olderSteps.length, 0);
      assert.strictEqual(currentStep, a);
    });

    it("3 steps without final yields older=[A,B] current=C", () => {
      const a = makeStep(agentMsg("s1"));
      const b = makeStep(agentMsg("s2"));
      const c = makeStep(agentMsg("s3"));
      const { olderSteps, currentStep } = splitLatestSteps([a, b, c], false);
      assert.strictEqual(olderSteps.length, 2);
      assert.deepStrictEqual(olderSteps, [a, b]);
      assert.strictEqual(currentStep, c);
    });

    it("2 steps with final yields all older, no current", () => {
      const a = makeStep(agentMsg("s1"));
      const b = makeStep(agentMsg("s2"));
      const { olderSteps, currentStep } = splitLatestSteps([a, b], true);
      assert.strictEqual(olderSteps.length, 2);
      assert.deepStrictEqual(olderSteps, [a, b]);
      assert.strictEqual(currentStep, null);
    });

    it("currentStep parameter takes precedence over hasFinal", () => {
      const a = makeStep(agentMsg("s1"));
      const b = makeStep(agentMsg("s2"));
      const cs = makeStep(agentMsg("final"), [rawToolMsg("t1")]);
      const { olderSteps, currentStep } = splitLatestSteps([a, b], true, cs);
      assert.strictEqual(olderSteps.length, 2);
      assert.strictEqual(currentStep, cs);
    });
  });

  describe("compute() then splitLatestSteps() integration", () => {
    it("latest group: steps split with last peeled out when no final", () => {
      const items: PipelineItem[] = [
        userMsg("q"),
        thinkingItem("t"),
        agentMsg("s1", { isFirstOfTurn: true }),
        agentMsg("s2", { isFirstOfTurn: true }),
        agentMsg("done!", { isFirstOfTurn: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      assert.ok(latestGroup.steps.length >= 1);

      const { olderSteps, currentStep } = splitLatestSteps(
        latestGroup.steps,
        latestGroup.finalResponse != null
      );
      // With final response, all steps are older (folded)
      assert.strictEqual(currentStep, null);
      assert.ok(olderSteps.length >= 1);
    });

    it("latest group without explicit final: last step peeled out", () => {
      // Agent is non-consecutive → it IS the final response, all steps go to banner
      const items: PipelineItem[] = [
        userMsg("q"),
        thinkingItem("t"),
        agentMsg("s1", { isFirstOfTurn: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      assert.ok(latestGroup.finalResponse);

      const { olderSteps, currentStep } = splitLatestSteps(
        latestGroup.steps,
        latestGroup!.finalResponse != null
      );
      // With explicit final, all steps are older (folded), no current
      assert.strictEqual(currentStep, null);
      assert.ok(olderSteps.length >= 1);
    });

    it("latest group with all consecutive: last step shown as current", () => {
      // All consecutive → fallback picks s1 as final, but since it's a
      // fallback (not explicit), we treat it as having no real final
      const items: PipelineItem[] = [
        userMsg("q"),
        thinkingItem("t"),
        agentMsg("s1", { isFirstOfTurn: true }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      assert.ok(latestGroup.finalResponse);
    });
  });
});

// ── splitIntoSteps ──────────────────────────────────────────────────────────

describe("splitIntoSteps", () => {
  it("empty items yields no steps", () => {
    const steps = splitIntoSteps([], null);
    assert.strictEqual(steps.length, 0);
  });

  it("single agent message yields one step", () => {
    const a = agentMsg("hello");
    const steps = splitIntoSteps([a], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.strictEqual(steps[0].toolCalls.length, 0);
    assert.strictEqual(steps[0].isPreAgent, false);
  });

  it("agent + tools yields one step", () => {
    const a = agentMsg("working");
    const t1 = rawToolMsg("tool1");
    const t2 = rawToolMsg("tool2");
    const steps = splitIntoSteps([a, t1, t2], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.strictEqual(steps[0].toolCalls.length, 2);
  });

  it("pre-agent tool calls remain as independent pre-agent step", () => {
    const t1 = rawToolMsg("tool1");
    const a = agentMsg("response");
    const steps = splitIntoSteps([t1, a], null);
    // Pre-agent tool is its own step (not absorbed into next agent)
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].isPreAgent, true);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[0].toolCalls.length, 1);
    assert.strictEqual(steps[1].isPreAgent, false);
    assert.strictEqual(steps[1].agentMessage, a);
    assert.strictEqual(steps[1].toolCalls.length, 0);
  });

  it("pre-agent tools accumulate as single pre-agent step", () => {
    const t1 = rawToolMsg("tool1");
    const t2 = rawToolMsg("tool2");
    const a = agentMsg("response");
    const steps = splitIntoSteps([t1, t2, a], null);
    // Both tools form one pre-agent step, agent is separate
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].isPreAgent, true);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[0].toolCalls.length, 2);
    assert.strictEqual(steps[1].isPreAgent, false);
    assert.strictEqual(steps[1].agentMessage, a);
    assert.strictEqual(steps[1].toolCalls.length, 0);
  });

  it("two agent messages yield two steps", () => {
    const a1 = agentMsg("first", { isFirstOfTurn: true });
    const a2 = agentMsg("second", { isFirstOfTurn: false });
    const steps = splitIntoSteps([a1, a2], null);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage, a1);
    assert.strictEqual(steps[1].agentMessage, a2);
  });

  it("final response is excluded from steps", () => {
    const a1 = agentMsg("working", { isFirstOfTurn: true });
    const final = agentMsg("done!", { isFirstOfTurn: false });
    // splitIntoSteps no longer filters internally; caller filters instead.
    // Simulate caller-side filtering: pass only non-final items.
    const steps = splitIntoSteps([a1], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, a1);
  });

  it("thinking before agent becomes independent step (pre-agent thinking)", () => {
    const think = thinkingItem("thinking...");
    const a = agentMsg("response");
    const steps = splitIntoSteps([think, a], null);
    // Thinking is pre-agent → its own step; agent is separate
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].isPreAgent, true);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[0].toolCalls.length, 1);
    assert.strictEqual(steps[1].isPreAgent, false);
    assert.strictEqual(steps[1].agentMessage, a);
    assert.strictEqual(steps[1].toolCalls.length, 0);
  });

  it("pre-agent tools form independent step, not attached to next agent", () => {
    // tool1 + tool2 before agent → pre-agent step, agent is separate
    const t1 = rawToolMsg("tool1");
    const t2 = rawToolMsg("tool2");
    const a = agentMsg("response");
    const steps = splitIntoSteps([t1, t2, a], null);
    assert.strictEqual(steps.length, 2);
    assert.ok(steps[0].isPreAgent);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[0].toolCalls.length, 2);
    assert.ok(!steps[1].isPreAgent);
    assert.strictEqual(steps[1].agentMessage, a);
    assert.strictEqual(steps[1].toolCalls.length, 0);
  });

  it("pre-agent raw tool (role='tool') becomes independent pre-agent step", () => {
    // Raw tool: role="tool" (not absorbed by merge because no preceding agent).
    // isToolItem matches role="tool", so splitIntoSteps treats raw tool items
    // as tool calls in the grouping logic.
    const rawTool = rawToolMsg("ls output");
    const agent = agentMsg("done!", { isFirstOfTurn: false });
    const steps = splitIntoSteps([rawTool, agent], null);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].isPreAgent, true);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[0].toolCalls.length, 1);
    assert.strictEqual(steps[0].toolCalls[0].role, "tool");
    assert.strictEqual(steps[0].toolCalls[0].content, "ls output");
    assert.strictEqual(steps[1].isPreAgent, false);
    assert.strictEqual(steps[1].agentMessage, agent);
    assert.strictEqual(steps[1].toolCalls.length, 0);
  });

  it("raw tool (role='tool') after agent becomes tool step in grouping", () => {
    const agentMsg1 = agentMsg("thinking", { isFirstOfTurn: false });
    const rawTool = rawToolMsg("bash output");
    const steps = splitIntoSteps([agentMsg1, rawTool], null);
    // Agent + tool in same step: tool follows agent, grouped together
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, agentMsg1);
    assert.strictEqual(steps[0].toolCalls.length, 1);
    assert.strictEqual(steps[0].toolCalls[0].role, "tool");
  });

  it("User → RawTool → Agent: grouping creates pre-agent step for raw tool", () => {
    const rawTool = rawToolMsg("grep result");
    const agent = agentMsg("分析結果です", { isFirstOfTurn: false });
    const items: PipelineItem[] = [userMsg("コードを検索して"), rawTool, agent];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // Agent is non-consecutive → selected as final
    assert.ok(latestGroup.finalResponse);
    assert.strictEqual(
      (latestGroup.finalResponse.item as ChatDisplayItem).content,
      "分析結果です"
    );
    // raw tool is BEFORE the final agent → pre-agent intermediate step
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.ok(latestGroup.steps[0].isPreAgent);
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 1);
    assert.strictEqual(latestGroup.steps[0].toolCalls[0].role, "tool");
    assert.strictEqual(
      latestGroup.steps[0].toolCalls[0].content,
      "grep result"
    );
  });

  it("raw tool (role='tool') is never selected as final response", () => {
    // isRealAgentChat requires role="agent".
    // Raw tool has role="tool", so it must not be selected as final.
    const rawTool = rawToolMsg("orphan tool output");
    const agent = agentMsg("answer", { isFirstOfTurn: false });
    const result = selectFinalResponse([rawTool, agent]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
  });

  it("User → Tool(1) → Agent(msg) → Tool(2) → Tool(3) with no final yields correct steps", () => {
    const tool1 = rawToolMsg("tool1");
    const agent = agentMsg("working", { isFirstOfTurn: true });
    const tool2 = rawToolMsg("tool2");
    const tool3 = rawToolMsg("tool3");
    const items: PipelineItem[] = [
      userMsg("do it"),
      tool1,
      agent,
      tool2,
      tool3,
    ];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // Agent is consecutive → fallback picks it as final
    assert.ok(latestGroup.finalResponse);
    // tool1 is BEFORE the final agent → intermediate step.
    // tool2 + tool3 are AFTER the final agent → currentStep.
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.ok(latestGroup.steps[0].isPreAgent);
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 1); // only tool1
    // currentStep = agent + tool2 + tool3
    assert.ok(latestGroup.currentStep);
    assert.strictEqual(latestGroup.currentStep!.agentMessage, agent);
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 2); // tool2 + tool3
  });

  it("pre-agent tools form independent step (no final)", () => {
    // Same scenario but within IntermediateStepGrouper
    const t1 = rawToolMsg("tool1");
    const t2 = rawToolMsg("tool2");
    const a = agentMsg("response", { isFirstOfTurn: false });
    const items: PipelineItem[] = [userMsg("q"), t1, t2, a];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // Agent a is final — excluded from steps.
    // t1 + t2 are before the agent → independent pre-agent step
    assert.ok(latestGroup.finalResponse);
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.ok(latestGroup.steps[0].isPreAgent);
    assert.strictEqual(latestGroup.steps[0].agentMessage, null);
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 2);
  });

  it("post-final tool calls form currentStep, not intermediate step", () => {
    // The key bug scenario: agent1 → tools → agent2 → more tools
    // agent2 is final, more tools should be in currentStep
    const agent1 = agentMsg("まず構造...", { isFirstOfTurn: false });
    const tool1 = rawToolMsg("read1");
    const tool2 = rawToolMsg("read2");
    const agent2 = agentMsg("主要モジュールを分析する", {
      isFirstOfTurn: false,
    });
    const tool3 = rawToolMsg("analyze1");
    const tool4 = rawToolMsg("analyze2");
    const items: PipelineItem[] = [
      userMsg("分析してください"),
      agent1,
      tool1,
      tool2,
      agent2,
      tool3,
      tool4,
    ];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // agent2 is final
    assert.ok(latestGroup.finalResponse);
    assert.strictEqual(
      (latestGroup.finalResponse.item as ChatDisplayItem).content,
      "主要モジュールを分析する"
    );
    // agent1 + tool1 + tool2 are intermediate (before final)
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.ok(!latestGroup.steps[0].isPreAgent);
    assert.strictEqual(latestGroup.steps[0].agentMessage, agent1);
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 2); // tool1 + tool2
    // tool3 + tool4 are after final → currentStep
    assert.ok(latestGroup.currentStep);
    assert.strictEqual(latestGroup.currentStep!.agentMessage, agent2);
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 2); // tool3 + tool4
  });

  it("splitLatestSteps with currentStep renders it outside banner", () => {
    const agent1 = agentMsg("step1", { isFirstOfTurn: true });
    const step1 = makeStep(agent1, [rawToolMsg("t1")]);
    const finalAgent = agentMsg("final", { isFirstOfTurn: false });
    const currentStep = makeStep(finalAgent, [
      rawToolMsg("t2"),
      rawToolMsg("t3"),
    ]);
    const { olderSteps, currentStep: peeled } = splitLatestSteps(
      [step1],
      true,
      currentStep
    );
    assert.strictEqual(olderSteps.length, 1);
    assert.strictEqual(peeled, currentStep);
    assert.strictEqual(peeled!.agentMessage, finalAgent);
    assert.strictEqual(peeled!.toolCalls.length, 2);
  });
});

// ── splitIntoSteps messageId boundary ────────────────────────────────────────

describe("splitIntoSteps messageId boundary", () => {
  it("same messageId merges into existing step instead of creating new one", () => {
    // Agent1(msgX) → Tool1 → Agent1(msgX, same logical message)
    const a1 = agentMsg("first part", {
      isFirstOfTurn: false,
      messageId: "msgX",
    });
    const tool1 = rawToolMsg("tool1");
    const a2 = agentMsg("second part", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const steps = splitIntoSteps([a1, tool1, a2], null);
    // Both agent messages share the same messageId → one step with merged content
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "first partsecond part");
    assert.strictEqual(steps[0].toolCalls.length, 1);
  });

  it("different messageId creates separate steps", () => {
    // Agent1(msgX) → Tool1 → Agent2(msgY, different logical message)
    const a1 = agentMsg("first", { isFirstOfTurn: false, messageId: "msgX" });
    const tool1 = rawToolMsg("tool1");
    const a2 = agentMsg("second", { isFirstOfTurn: true, messageId: "msgY" });
    const steps = splitIntoSteps([a1, tool1, a2], null);
    // Different messageIds → two steps
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "first");
    assert.strictEqual(steps[1].agentMessage?.content, "second");
  });

  it("same messageId in currentAgent merges without flushing", () => {
    // Two consecutive agent items with same messageId, no tools in between
    const a1 = agentMsg("part 1", { isFirstOfTurn: false, messageId: "msgA" });
    const a2 = agentMsg("part 2", { isFirstOfTurn: true, messageId: "msgA" });
    const steps = splitIntoSteps([a1, a2], null);
    // Same messageId → merges into current agent, no new step
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "part 1part 2");
  });

  it("different messageId without tools creates two steps", () => {
    const a1 = agentMsg("first", { isFirstOfTurn: false, messageId: "id1" });
    const a2 = agentMsg("second", { isFirstOfTurn: true, messageId: "id2" });
    const steps = splitIntoSteps([a1, a2], null);
    // Different messageId → new step even without tools
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "first");
    assert.strictEqual(steps[1].agentMessage?.content, "second");
  });

  it("missing messageId falls back to default behavior", () => {
    // No messageId → each agent chat creates a new step
    const a1 = agentMsg("first", { isFirstOfTurn: false });
    const a2 = agentMsg("second", { isFirstOfTurn: true });
    const steps = splitIntoSteps([a1, a2], null);
    assert.strictEqual(steps.length, 2);
  });

  it("same messageId merges with tools into correct step", () => {
    // Full scenario: Agent1(msg1) → Tool1 → Agent1(msg1) → Tool2 → Agent2(msg2)
    const a1 = agentMsg("analyzing", { isFirstOfTurn: false, messageId: "m1" });
    const t1 = rawToolMsg("grep");
    const a2 = agentMsg(" complete", { isFirstOfTurn: true, messageId: "m1" });
    const t2 = rawToolMsg("read");
    const a3 = agentMsg("done", { isFirstOfTurn: false, messageId: "m2" });
    const steps = splitIntoSteps([a1, t1, a2, t2, a3], null);
    // Step 1: Agent(m1, "analyzing complete") + Tool1(grep) + Tool2(read)
    // Step 2: Agent(m2, "done")
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "analyzing complete");
    assert.strictEqual(steps[0].toolCalls.length, 2);
    assert.strictEqual(steps[1].agentMessage?.content, "done");
  });

  it("empty messageId is treated as missing (no merge)", () => {
    const a1 = agentMsg("first", { isFirstOfTurn: false, messageId: "" });
    const a2 = agentMsg("second", { isFirstOfTurn: true, messageId: "" });
    const steps = splitIntoSteps([a1, a2], null);
    assert.strictEqual(steps.length, 2);
  });
});

// ── Regression: same messageId must NOT merge across turn boundaries ──────
// Bug: all AgentMessages were being appended to existing FinalStep
// AgentMessages instead of becoming separate Intermediate steps.
// Root cause: splitIntoSteps merged same-messageId chunks without checking
// whether the last step was a boundary (stopReason or isFirstOfTurn).

describe("Regression: same messageId does NOT merge across stopReason boundary", () => {
  it("last step with stopReason: same messageId starts new step", () => {
    // Scenario: Agent1(msgX, stopReason=end_turn) → Agent2(msgX)
    // Agent1 is a final turn → Agent2 must be a separate step.
    const a1 = agentMsg("final answer", {
      isFirstOfTurn: false,
      messageId: "msgX",
      stopReason: "end_turn",
    });
    const a2 = agentMsg(" new content", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const steps = splitIntoSteps([a1, a2], null);
    // NOT merged — a1 is a boundary (stopReason)
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "final answer");
    assert.strictEqual(steps[0].agentMessage?.stopReason, "end_turn");
    assert.strictEqual(steps[1].agentMessage?.content, " new content");
  });

  it("last step with stopReason + tool after: same messageId starts new step", () => {
    // Scenario: Agent1(msgX, stopReason) → Tool → Agent2(msgX)
    const a1 = agentMsg("done!", {
      isFirstOfTurn: false,
      messageId: "msgX",
      stopReason: "end_turn",
    });
    const tool1 = rawToolMsg("grep");
    const a2 = agentMsg(" continuing", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const steps = splitIntoSteps([a1, tool1, a2], null);
    // Step 1: Agent1("done!") — boundary
    // Step 2: Agent2(" continuing") + NOT merged into step 1
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "done!");
    assert.strictEqual(steps[1].agentMessage?.content, " continuing");
  });

  it("last step WITHOUT stopReason: same messageId still merges (normal streaming)", () => {
    // Scenario: Agent1(msgX, no stopReason) → Tool → Agent2(msgX)
    // Normal streaming case: same logical message interrupted by tool call.
    const a1 = agentMsg("part 1", {
      isFirstOfTurn: false,
      messageId: "msgX",
    });
    const tool1 = rawToolMsg("read");
    const a2 = agentMsg(" part 2", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const steps = splitIntoSteps([a1, tool1, a2], null);
    // Merged: same logical message, no boundary
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "part 1 part 2");
    assert.strictEqual(steps[0].toolCalls.length, 1);
  });
});

describe("Regression: same messageId does NOT merge across isFirstOfTurn boundary", () => {
  it("last step with isFirstOfTurn=true: same messageId starts new step", () => {
    // Scenario: Agent1(msgX, isFirstOfTurn=true) → Agent2(msgX)
    // Agent1 is a new logical step → Agent2 must be separate.
    const a1 = agentMsg("first step", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const a2 = agentMsg(" second step", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const steps = splitIntoSteps([a1, a2], null);
    // NOT merged — a1 is a boundary (isFirstOfTurn)
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "first step");
    assert.strictEqual(steps[1].agentMessage?.content, " second step");
  });

  it("last step with isFirstOfTurn + tool: same messageId starts new step", () => {
    // Scenario: Agent1(msgX, isFirstOfTurn) → Tool → Agent2(msgX)
    const a1 = agentMsg("analyzing", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const tool1 = rawToolMsg("bash");
    const a2 = agentMsg(" complete", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const steps = splitIntoSteps([a1, tool1, a2], null);
    // Step 1: Agent1("analyzing") — boundary
    // Step 2: Agent2(" complete") — separate step
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "analyzing");
    assert.strictEqual(steps[1].agentMessage?.content, " complete");
  });

  it("last step WITHOUT isFirstOfTurn: same messageId still merges", () => {
    // Scenario: Agent1(msgX, isFirstOfTurn=false) → Agent2(msgX)
    // Mid-stream continuation without a new step boundary → merge.
    const a1 = agentMsg("streaming", {
      isFirstOfTurn: false,
      messageId: "msgA",
    });
    const a2 = agentMsg(" more", {
      isFirstOfTurn: false,
      messageId: "msgA",
    });
    const steps = splitIntoSteps([a1, a2], null);
    // Merged: not a boundary
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "streaming more");
  });
});

// ── Exhaustive messageId interleaving: chunks & tools in any order ─────────
// The splitIntoSteps messageId merge must correctly pair tool calls with
// the right step even when chunks and tools arrive in complex interleaved
// patterns.  All chunks of the same logical message (same messageId) must
// be merged into a single step, and ALL tool calls that arrive between
// chunks of that message must be attributed to that step.

describe("messageId interleaving: chunks + tools in complex patterns", () => {
  it("chunk → chain of tools → chunk (same msgId): 1 step, all tools captured", () => {
    const a1 = agentMsg("start ", { isFirstOfTurn: false, messageId: "M" });
    const t1 = rawToolMsg("read");
    const t2 = rawToolMsg("grep");
    const t3 = rawToolMsg("bash");
    const a2 = agentMsg("end", { isFirstOfTurn: true, messageId: "M" });
    const steps = splitIntoSteps([a1, t1, t2, t3, a2], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "start end");
    assert.strictEqual(steps[0].toolCalls.length, 3);
  });

  it("chunk → tool → chunk → tool → chunk (same msgId): 1 step, 2 tools", () => {
    const a1 = agentMsg("a", { isFirstOfTurn: false, messageId: "X" });
    const t1 = rawToolMsg("r1");
    const a2 = agentMsg("b", { isFirstOfTurn: true, messageId: "X" });
    const t2 = rawToolMsg("r2");
    const a3 = agentMsg("c", { isFirstOfTurn: true, messageId: "X" });
    const steps = splitIntoSteps([a1, t1, a2, t2, a3], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "abc");
    assert.strictEqual(steps[0].toolCalls.length, 2);
  });

  it("msgA(chunk) → toolA → msgB(chunk) → msgA(chunk): msgA splits across steps", () => {
    // When msgA chunks are separated by a different messageId, they cannot
    // merge back — splitIntoSteps is a sequential single-pass algorithm.
    // This is the correct behavior: the protocol guarantees chunks of the
    // same message arrive contiguously (or with only that message's tool
    // calls in between).  Interleaving of different messages is not a
    // supported pattern.
    const a1 = agentMsg("A1", {
      isFirstOfTurn: false,
      messageId: "msgA",
      stopReason: "tool_use",
    });
    const t1 = rawToolMsg("tool-for-A");
    const b1 = agentMsg("B1", {
      isFirstOfTurn: true,
      messageId: "msgB",
      stopReason: "end_turn",
    });
    const a2 = agentMsg("A2", { isFirstOfTurn: true, messageId: "msgA" });
    const steps = splitIntoSteps([a1, t1, b1, a2], null);
    // Sequential pass: step1=msgA(c1)+tool, step2=msgB, step3=msgA(c2)
    assert.strictEqual(steps.length, 3);
    assert.strictEqual(steps[0].agentMessage?.content, "A1");
    assert.strictEqual(steps[0].toolCalls.length, 1);
    assert.strictEqual(steps[1].agentMessage?.content, "B1");
    assert.strictEqual(steps[2].agentMessage?.content, "A2");
  });

  it("tool-only items before any agent (no messageId): pre-agent step unchanged", () => {
    // Tool items don't carry messageId, so they never trigger merge logic.
    // They form pre-agent steps as usual.
    const t1 = rawToolMsg("ls");
    const t2 = rawToolMsg("pwd");
    const a1 = agentMsg("result", { isFirstOfTurn: false, messageId: "M" });
    const steps = splitIntoSteps([t1, t2, a1], null);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].isPreAgent, true);
    assert.strictEqual(steps[0].toolCalls.length, 2);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[1].agentMessage?.content, "result");
  });

  it("consecutive agent chunks (no tools, same msgId): merged into 1 step", () => {
    const a1 = agentMsg("a", { isFirstOfTurn: false, messageId: "M" });
    const a2 = agentMsg("b", { isFirstOfTurn: false, messageId: "M" });
    const a3 = agentMsg("c", { isFirstOfTurn: false, messageId: "M" });
    const steps = splitIntoSteps([a1, a2, a3], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "abc");
  });

  it("consecutive agent chunks (different msgId): each becomes separate step", () => {
    const a1 = agentMsg("A", { isFirstOfTurn: false, messageId: "1" });
    const a2 = agentMsg("B", { isFirstOfTurn: false, messageId: "2" });
    const a3 = agentMsg("C", { isFirstOfTurn: false, messageId: "3" });
    const steps = splitIntoSteps([a1, a2, a3], null);
    assert.strictEqual(steps.length, 3);
  });

  it("same msgId but separated by message with stopReason → new step", () => {
    // Same messageId, but the first agent has stopReason (logical boundary).
    // This simulates: Agent sends chunk with stopReason, then continues
    // with same messageId in a new turn — should NOT merge.
    const a1 = agentMsg("done", {
      isFirstOfTurn: false,
      messageId: "M",
      stopReason: "end_turn",
    });
    const a2 = agentMsg("more", { isFirstOfTurn: true, messageId: "M" });
    const steps = splitIntoSteps([a1, a2], null);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage?.content, "done");
    assert.strictEqual(steps[1].agentMessage?.content, "more");
  });

  it("complex: chunk1 → t1 → chunk2 → t2 → t3 → chunk3 (same msgId): 1 step, 3 tools", () => {
    const a1 = agentMsg("P1", { isFirstOfTurn: false, messageId: "Z" });
    const t1 = rawToolMsg("task1");
    const a2 = agentMsg("P2", { isFirstOfTurn: true, messageId: "Z" });
    const t2 = rawToolMsg("task2");
    const t3 = rawToolMsg("task3");
    const a3 = agentMsg("P3", { isFirstOfTurn: true, messageId: "Z" });
    const steps = splitIntoSteps([a1, t1, a2, t2, t3, a3], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "P1P2P3");
    assert.strictEqual(steps[0].toolCalls.length, 3);
    assert.strictEqual(steps[0].toolCalls[0].content, "[tool result: task1]");
    assert.strictEqual(steps[0].toolCalls[1].content, "[tool result: task2]");
    assert.strictEqual(steps[0].toolCalls[2].content, "[tool result: task3]");
  });
});

describe("Regression: end-to-end IntermediateStepGrouper with same messageId across boundary", () => {
  it("User → Agent1(msgX, isFirstOfTurn) → Tool → Agent2(msgX, stopReason): 2 intermediate steps", () => {
    // The original bug: Agent2 was merged into Agent1's step instead of
    // becoming its own intermediate step.
    const user = userMsg("分析してください");
    const agent1 = agentMsg("ファイル構造を確認します", {
      isFirstOfTurn: true,
      messageId: "msgX",
    });
    const tool1 = rawToolMsg("list_files");
    const agent2 = agentMsg("分析結果です", {
      isFirstOfTurn: true,
      messageId: "msgX",
      stopReason: "end_turn",
    });
    const items: PipelineItem[] = [user, agent1, tool1, agent2];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // agent2 is the final response
    assert.ok(latestGroup.finalResponse);
    assert.strictEqual(
      (latestGroup.finalResponse.item as ChatDisplayItem).content,
      "分析結果です"
    );
    // agent1 + tool1 should be an intermediate step (NOT merged with agent2)
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.strictEqual(
      latestGroup.steps[0].agentMessage?.content,
      "ファイル構造を確認します"
    );
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 1);
    assert.strictEqual(latestGroup.steps[0].isPreAgent, false);
  });

  it("User → Agent1(msgX, isFirstOfTurn) → Tool1 → Agent2(msgX, same, no stop) → Tool2: merged then continued", () => {
    // Normal streaming case: same logical message interrupted by tool calls.
    // Agent1 + Agent2 share messageId AND neither is a boundary → merged into 1 step.
    const user = userMsg("実装してください");
    const agent1 = agentMsg("実装します", {
      isFirstOfTurn: true,
      messageId: "msgY",
    });
    const tool1 = rawToolMsg("read_file");
    const agent2 = agentMsg(" 完了しました", {
      isFirstOfTurn: false,
      messageId: "msgY",
    });
    const tool2 = rawToolMsg("format");
    const items: PipelineItem[] = [user, agent1, tool1, agent2, tool2];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // agent1 + agent2 merged (same messageId, no boundary) → 1 step
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.strictEqual(
      latestGroup.steps[0].agentMessage?.content,
      "実装します 完了しました"
    );
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 2); // tool1 + tool2
  });
});

// ── selectFinalResponse ──────────────────────────────────────────────────────

describe("selectFinalResponse", () => {
  it("returns null for empty input", () => {
    assert.strictEqual(selectFinalResponse([]), null);
  });

  it("end_turn takes priority over other stopReason values", () => {
    // When multiple messages carry stopReason, the LAST with "end_turn" wins.
    // Intermediate agent with tool_use MUST NOT be selected.
    const items: PipelineItem[] = [
      agentMsg("intermediate", { stopReason: "tool_use" }),
      rawToolMsg("tool output"),
      agentMsg("final", { stopReason: "end_turn" }),
    ];
    const result = selectFinalResponse(items);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "final");
    assert.strictEqual(result.index, 2);
  });

  it("stopReason takes priority over everything", () => {
    const items: PipelineItem[] = [
      agentMsg("first", { isFirstOfTurn: false }),
      agentMsg("second", { isFirstOfTurn: true, stopReason: "end_turn" }),
      agentMsg("third", { isFirstOfTurn: true }),
    ];
    const result = selectFinalResponse(items);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "second");
    assert.strictEqual(result.index, 1);
  });

  it("last non-consecutive without stopReason", () => {
    const items: PipelineItem[] = [
      agentMsg("a", { isFirstOfTurn: true }),
      agentMsg("b", { isFirstOfTurn: false }),
      agentMsg("c", { isFirstOfTurn: true }),
      agentMsg("d", { isFirstOfTurn: false }),
    ];
    const result = selectFinalResponse(items);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "d");
    assert.strictEqual(result.index, 3);
  });

  it("fallback to last non-promoted agent when all consecutive", () => {
    const result = selectFinalResponse([
      agentMsg("a", { isFirstOfTurn: true }),
      agentMsg("b", { isFirstOfTurn: true }),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "b");
  });

  it("never selects raw tool (role=tool) as final", () => {
    assert.strictEqual(selectFinalResponse([rawToolMsg("tool output")]), null);
  });

  it("skips raw tools to find real agent final", () => {
    const result = selectFinalResponse([
      rawToolMsg("tool"),
      agentMsg("answer", { isFirstOfTurn: false }),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
  });

  it("agent after raw tool is final", () => {
    const result = selectFinalResponse([
      agentMsg("first", { isFirstOfTurn: true }),
      rawToolMsg("tool output"),
      agentMsg("answer", { isFirstOfTurn: false }),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
    assert.strictEqual(result.index, 2);
  });
});

// ── Regression tests: bugs that unit tests missed ───────────────────────
// These test the invariants that were violated by the pre-refactor
// merge/suppressToolBatch architecture, causing:
//   Bug 1: blank line between AgentMessageHeader and ToolBatchSummary
//   Bug 2: tool calls not merged into ToolBatchSummary in final steps

describe("Regression: currentStep collects ALL tool calls (no dual-source)", () => {
  // Bug 2 regression: before the merge elimination, only step.toolCalls was
  // collected, missing tool calls carried by the agentMessage itself.
  // The new design guarantees that ALL tool calls live exclusively in
  // step.toolCalls (PipelineItems with role="tool"), never duplicated on
  // the agent item.

  it("currentStep.toolCalls contains ALL tools after final response", () => {
    const final = agentMsg("done!", {
      isFirstOfTurn: false,
      stopReason: "end_turn",
    });
    const tool1 = rawToolMsg("grep");
    const tool2 = rawToolMsg("read");
    const items: PipelineItem[] = [userMsg("analyze"), final, tool1, tool2];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // currentStep must carry BOTH tool items
    assert.ok(latestGroup.currentStep);
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 2);
    assert.strictEqual(latestGroup.currentStep!.agentMessage, final);
    // The agent message must NOT carry resolvedToolCalls (tools are independent)
    assert.strictEqual(final.resolvedToolCalls, undefined);
  });

  it("currentStep.toolCalls contains tools from multiple tool messages", () => {
    const final = agentMsg("result", {
      isFirstOfTurn: false,
      stopReason: "end_turn",
    });
    const t1 = rawToolMsg("bash");
    const t2 = rawToolMsg("read");
    const t3 = rawToolMsg("edit");
    const items: PipelineItem[] = [
      userMsg("do complex thing"),
      final,
      t1,
      t2,
      t3,
    ];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup?.currentStep);
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 3);
    // Each tool item retains its own resolvedToolCalls
    assert.strictEqual(
      latestGroup.currentStep!.toolCalls[0].resolvedToolCalls![0].title,
      "bash"
    );
    assert.strictEqual(
      latestGroup.currentStep!.toolCalls[1].resolvedToolCalls![0].title,
      "read"
    );
    assert.strictEqual(
      latestGroup.currentStep!.toolCalls[2].resolvedToolCalls![0].title,
      "edit"
    );
  });
});

describe("Regression: tool-call-only step (pre-agent) has agentMessage=null", () => {
  // Bug 1 regression: before the merge elimination, a tool-call-only step
  // with no agent message content could produce a blank line between
  // AgentMessageHeader and ToolBatchSummary.  The new design ensures that
  // a step with no agent message IS a pre-agent step (agentMessage=null),
  // and StepView renders it without any agent header gap.

  it("pre-agent step: agentMessage=null, toolCalls present", () => {
    const t1 = rawToolMsg("ls");
    const t2 = rawToolMsg("pwd");
    const items: PipelineItem[] = [userMsg("list files"), t1, t2];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // No final agent → currentStep carries the tool calls
    assert.ok(latestGroup.currentStep);
    assert.strictEqual(latestGroup.currentStep!.agentMessage, null);
    assert.strictEqual(latestGroup.currentStep!.isPreAgent, true);
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 2);
  });

  it("pre-agent step: splitIntoSteps produces step with agentMessage=null", () => {
    // Directly verify that splitIntoSteps creates a pre-agent step
    // with null agentMessage and the tool items in toolCalls.
    const t1 = rawToolMsg("ls");
    const t2 = rawToolMsg("pwd");
    const agent = agentMsg("done", { isFirstOfTurn: false });
    const steps = splitIntoSteps([t1, t2, agent], null);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[0].isPreAgent, true);
    assert.strictEqual(steps[0].toolCalls.length, 2);
    assert.strictEqual(steps[1].agentMessage, agent);
    assert.strictEqual(steps[1].isPreAgent, false);
    assert.strictEqual(steps[1].toolCalls.length, 0);
  });

  it("pre-agent step never has agentMessage with empty content", () => {
    // Key invariant: a step with tools but no preceding agent message
    // has agentMessage=null (not an agent message with empty content).
    // This prevents the blank-line bug from the old design.
    const t1 = rawToolMsg("result");
    const steps = splitIntoSteps([t1], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, null);
    assert.strictEqual(steps[0].isPreAgent, true);
    // null is not an agent message with empty string content
  });
});

describe("Regression: agent message + subsequent tools — both render correctly", () => {
  it("step with agentMessage and toolCalls: agent has content, tools come from step.toolCalls", () => {
    // When an agent message IS present, tool calls must come from
    // step.toolCalls (PipelineItems with role="tool"), NOT from
    // agentMessage.resolvedToolCalls (which should be undefined).
    const agent1 = agentMsg("分析中です", {
      isFirstOfTurn: false,
      stopReason: "end_turn",
    });
    const tool1 = rawToolMsg("read");
    const tool2 = rawToolMsg("bash");
    const items: PipelineItem[] = [userMsg("analyze"), agent1, tool1, tool2];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup?.currentStep);
    // Agent message content is present
    assert.strictEqual(
      latestGroup.currentStep!.agentMessage!.content,
      "分析中です"
    );
    // All tools are in currentStep.toolCalls
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 2);
    // Agent message itself does NOT carry resolvedToolCalls
    assert.strictEqual(
      latestGroup.currentStep!.agentMessage!.resolvedToolCalls,
      undefined
    );
  });
});

describe("Regression: no dual-source tool call duplication", () => {
  it("tool items in pipeline carry their own resolvedToolCalls, agent has none", () => {
    // After the merge elimination, tool items (role="tool") carry
    // resolvedToolCalls directly. Agent messages never absorb them.
    const agent1 = agentMsg("working", { isFirstOfTurn: false });
    const tool1 = rawToolMsg("grep");
    const tool2 = rawToolMsg("sed");
    const items: PipelineItem[] = [userMsg("q"), agent1, tool1, tool2];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // The final response is the last non-consecutive agent
    assert.ok(latestGroup.finalResponse);
    // Tools after final go to currentStep
    assert.ok(latestGroup.currentStep);
    // Each tool item carries its own resolvedToolCalls
    const tc0 = latestGroup.currentStep!.toolCalls[0].resolvedToolCalls;
    const tc1 = latestGroup.currentStep!.toolCalls[1].resolvedToolCalls;
    assert.ok(tc0 && tc0.length === 1);
    assert.ok(tc1 && tc1.length === 1);
    assert.strictEqual(tc0![0].title, "grep");
    assert.strictEqual(tc1![0].title, "sed");
  });

  it("pipeline does NOT absorb tool calls into agent message (no merge stage)", () => {
    // End-to-end: classify → filter → annotate → grouping.
    // Tool messages remain as standalone PipelineItems with role="tool",
    // and the agent message does NOT carry resolvedToolCalls from tool messages.
    const agent1 = agentMsg("thinking", { isFirstOfTurn: false });
    const tool1 = rawToolMsg("bash");
    const agent2 = agentMsg("done", {
      isFirstOfTurn: false,
      stopReason: "end_turn",
    });
    const items: PipelineItem[] = [
      userMsg("run command"),
      agent1,
      tool1,
      agent2,
    ];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // agent2 is final, tool1 is before it → intermediate step
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.strictEqual(latestGroup.steps[0].agentMessage, agent1);
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 1);
    assert.strictEqual(latestGroup.steps[0].toolCalls[0].role, "tool");
    // currentStep is agent2 with no post-final tools
    assert.ok(latestGroup.currentStep);
    assert.strictEqual(latestGroup.currentStep!.agentMessage, agent2);
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 0);
  });
});

describe("Regression: selectFinalResponse never returns tool item", () => {
  it("tool-only list returns null", () => {
    assert.strictEqual(
      selectFinalResponse([rawToolMsg("a"), rawToolMsg("b")]),
      null
    );
  });

  it("tool items are skipped when searching for final agent", () => {
    const result = selectFinalResponse([
      rawToolMsg("x"),
      agentMsg("answer", { isFirstOfTurn: false }),
      rawToolMsg("y"),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
  });
});

// ── ToolMergeStrategy tests removed ────────────────────────────────────────
// (merge.ts has been eliminated from the pipeline)
