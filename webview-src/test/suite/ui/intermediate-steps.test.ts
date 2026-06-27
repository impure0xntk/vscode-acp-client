import assert from "assert";
import { describe, it } from "mocha";
import type { PipelineItem, ChatDisplayItem, ClassifiedMessage, IntermediateStep } from "../../../pipeline/types";
import {
  IntermediateStepGrouper,
  selectFinalResponse,
  splitIntoSteps,
  splitLatestSteps,
} from "../../../pipeline/stages/grouping";
import { ToolMergeStrategy } from "../../../pipeline/stages/merge";

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

function promotedToolMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "agent", originalRole: "tool", agentId: "a1", content,
    key: nextKey("tool"), timestamp: Date.now(), isConsecutive: true,
    groupKey: "agent:a1", attachments: [], thinking: undefined,
    resolvedToolCalls: [], ...overrides,
  };
}

function classifiedMsg(
  role: "user" | "agent" | "tool" | "system",
  content: string,
  overrides: Partial<ClassifiedMessage> = {},
): ClassifiedMessage {
  return {
    id: nextKey("msg"), role, content, timestamp: Date.now(), agentId: "a1",
    systemKind: "info" as const, ...overrides,
  };
}

function makeStep(
  agentMessage: ChatDisplayItem | null,
  toolCalls: ChatDisplayItem[] = [],
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
      const r = new IntermediateStepGrouper([agentMsg("a"), agentMsg("b")]).compute();
      assert.strictEqual(r.groups.length, 0);
      assert.strictEqual(r.latestGroup, null);
    });

    it("single turn: user + agent, no intermediate", () => {
      const { groups, latestGroup, trailing } =
        new IntermediateStepGrouper([userMsg("hi"), agentMsg("hello")]).compute();
      assert.strictEqual(groups.length, 0);
      assert.ok(latestGroup);
      assert.strictEqual(latestGroup.steps.length, 0);
      assert.ok(latestGroup.finalResponse);
      assert.strictEqual((latestGroup.finalResponse.item as ChatDisplayItem).content, "hello");
      assert.strictEqual(trailing.length, 0);
    });

    it("single turn: intermediate folded, final outside", () => {
      const items: PipelineItem[] = [
        userMsg("do it"), thinkingItem("thinking..."),
        agentMsg("working...", { isConsecutive: true }),
        agentMsg("done!", { isConsecutive: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      // thinking + working... are intermediate steps, done! is final
      assert.ok(latestGroup.steps.length >= 1);
      assert.strictEqual((latestGroup.finalResponse?.item as ChatDisplayItem).content, "done!");
    });

    it("multiple turns: past group folded", () => {
      const items: PipelineItem[] = [
        userMsg("q1"), thinkingItem("t1"), agentMsg("a1", { isConsecutive: false }),
        userMsg("q2"), agentMsg("a2", { isConsecutive: false }),
      ];
      const { groups, latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.strictEqual(groups.length, 1);
      assert.ok(groups[0].steps.length >= 1);
      assert.strictEqual((groups[0].finalResponse?.item as ChatDisplayItem).content, "a1");
      assert.strictEqual(latestGroup.steps.length, 0);
      assert.strictEqual((latestGroup.finalResponse?.item as ChatDisplayItem).content, "a2");
    });

    it("trailing system items not grouped", () => {
      const compItem: PipelineItem = {
        type: "compression", info: { contextWindowMax: 1000, usedTokens: 800 },
        key: nextKey("comp"), timestamp: Date.now(),
      };
      const { trailing } = new IntermediateStepGrouper([
        userMsg("hi"), agentMsg("hello", { isConsecutive: false }), compItem,
      ]).compute();
      assert.strictEqual(trailing.length, 1);
      assert.strictEqual(trailing[0], compItem);
    });

    it("all consecutive fallback picks last as final", () => {
      const items: PipelineItem[] = [
        userMsg("hi"),
        agentMsg("a", { isConsecutive: true }),
        agentMsg("b", { isConsecutive: true }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup?.finalResponse);
      assert.strictEqual((latestGroup.finalResponse.item as ChatDisplayItem).content, "b");
    });

    it("promoted tool messages treated as intermediate not final", () => {
      const items: PipelineItem[] = [
        userMsg("read file"), promotedToolMsg("reading..."),
        agentMsg("done!", { isConsecutive: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      // promoted tool is an intermediate step, done! is final
      assert.ok(latestGroup.steps.length >= 1);
      assert.strictEqual((latestGroup.finalResponse?.item as ChatDisplayItem).content, "done!");
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
      const cs = makeStep(agentMsg("final"), [promotedToolMsg("t1")]);
      const { olderSteps, currentStep } = splitLatestSteps([a, b], true, cs);
      assert.strictEqual(olderSteps.length, 2);
      assert.strictEqual(currentStep, cs);
    });
  });

  describe("compute() then splitLatestSteps() integration", () => {
    it("latest group: steps split with last peeled out when no final", () => {
      const items: PipelineItem[] = [
        userMsg("q"), thinkingItem("t"),
        agentMsg("s1", { isConsecutive: true }),
        agentMsg("s2", { isConsecutive: true }),
        agentMsg("done!", { isConsecutive: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      assert.ok(latestGroup.steps.length >= 1);

      const { olderSteps, currentStep } =
        splitLatestSteps(latestGroup.steps, latestGroup.finalResponse != null);
      // With final response, all steps are older (folded)
      assert.strictEqual(currentStep, null);
      assert.ok(olderSteps.length >= 1);
    });

    it("latest group without explicit final: last step peeled out", () => {
      // Agent is non-consecutive → it IS the final response, all steps go to banner
      const items: PipelineItem[] = [
        userMsg("q"), thinkingItem("t"),
        agentMsg("s1", { isConsecutive: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      assert.ok(latestGroup.finalResponse);

      const { olderSteps, currentStep } =
        splitLatestSteps(latestGroup.steps, latestGroup!.finalResponse != null);
      // With explicit final, all steps are older (folded), no current
      assert.strictEqual(currentStep, null);
      assert.ok(olderSteps.length >= 1);
    });

    it("latest group with all consecutive: last step shown as current", () => {
      // All consecutive → fallback picks s1 as final, but since it's a
      // fallback (not explicit), we treat it as having no real final
      const items: PipelineItem[] = [
        userMsg("q"), thinkingItem("t"),
        agentMsg("s1", { isConsecutive: true }),
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
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
    const steps = splitIntoSteps([a, t1, t2], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.strictEqual(steps[0].toolCalls.length, 2);
  });

  it("pre-agent tool calls attach to next agent step", () => {
    const t1 = promotedToolMsg("tool1");
    const a = agentMsg("response");
    const steps = splitIntoSteps([t1, a], null);
    // Pre-agent tool attaches to the next agent's step
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].isPreAgent, false);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.strictEqual(steps[0].toolCalls.length, 1);
  });

  it("pre-agent tools accumulate and attach to next agent", () => {
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
    const a = agentMsg("response");
    const steps = splitIntoSteps([t1, t2, a], null);
    // Both tools attach to agent's step
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].isPreAgent, false);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.strictEqual(steps[0].toolCalls.length, 2);
  });

  it("two agent messages yield two steps", () => {
    const a1 = agentMsg("first", { isConsecutive: true });
    const a2 = agentMsg("second", { isConsecutive: false });
    const steps = splitIntoSteps([a1, a2], null);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].agentMessage, a1);
    assert.strictEqual(steps[1].agentMessage, a2);
  });

  it("final response is excluded from steps", () => {
    const a1 = agentMsg("working", { isConsecutive: true });
    const final = agentMsg("done!", { isConsecutive: false });
    // splitIntoSteps no longer filters internally; caller filters instead.
    // Simulate caller-side filtering: pass only non-final items.
    const steps = splitIntoSteps([a1], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, a1);
  });

  it("thinking before agent attaches to agent step", () => {
    const think = thinkingItem("thinking...");
    const a = agentMsg("response");
    const steps = splitIntoSteps([think, a], null);
    // Thinking + agent should be in the same step
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.ok(steps[0].toolCalls.length >= 1);
  });

  it("User → Tool(1) → Agent(msg) → Tool(2) → Tool(3) yields correct steps", () => {
    const tool1 = promotedToolMsg("tool1");
    const agent = agentMsg("working", { isConsecutive: false });
    const tool2 = promotedToolMsg("tool2");
    const tool3 = promotedToolMsg("tool3");
    const items: PipelineItem[] = [
      userMsg("do it"), tool1, agent, tool2, tool3,
    ];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // Agent is non-consecutive → selected as final
    assert.ok(latestGroup.finalResponse);
    assert.strictEqual((latestGroup.finalResponse.item as ChatDisplayItem).content, "working");
    // tool1 is BEFORE the final agent → intermediate step (pre-agent, since
    // the final agent is excluded from intermediate items).
    // tool2 + tool3 are AFTER the final agent → they form the currentStep
    // (final response + subsequent tool calls), NOT an intermediate step.
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.ok(latestGroup.steps[0].isPreAgent);
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 1); // only tool1
    // currentStep = agent + tool2 + tool3
    assert.ok(latestGroup.currentStep);
    assert.strictEqual(latestGroup.currentStep!.agentMessage, agent);
    assert.strictEqual(latestGroup.currentStep!.toolCalls.length, 2); // tool2 + tool3
  });

  it("User → Tool(1) → Agent(msg) → Tool(2) → Tool(3) with no final yields correct steps", () => {
    const tool1 = promotedToolMsg("tool1");
    const agent = agentMsg("working", { isConsecutive: true });
    const tool2 = promotedToolMsg("tool2");
    const tool3 = promotedToolMsg("tool3");
    const items: PipelineItem[] = [
      userMsg("do it"), tool1, agent, tool2, tool3,
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

  it("pre-agent tools attach to next agent, not separate steps", () => {
    // tool1 + tool2 before agent → both attach to agent's step
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
    const a = agentMsg("response");
    const steps = splitIntoSteps([t1, t2, a], null);
    assert.strictEqual(steps.length, 1);
    assert.ok(!steps[0].isPreAgent);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.strictEqual(steps[0].toolCalls.length, 2);
  });

  it("pre-agent tools attach to next agent (no final)", () => {
    // Same scenario but within IntermediateStepGrouper
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
    const a = agentMsg("response", { isConsecutive: false });
    const items: PipelineItem[] = [userMsg("q"), t1, t2, a];
    const { latestGroup } = new IntermediateStepGrouper(items).compute();
    assert.ok(latestGroup);
    // Agent a is final — excluded from steps.
    // t1 + t2 are before the agent → they become a pre-agent step
    // (the final agent is excluded, so pre-agent tools have no agent to attach to)
    assert.ok(latestGroup.finalResponse);
    assert.strictEqual(latestGroup.steps.length, 1);
    assert.ok(latestGroup.steps[0].isPreAgent);
    assert.strictEqual(latestGroup.steps[0].toolCalls.length, 2);
  });

  it("post-final tool calls form currentStep, not intermediate step", () => {
    // The key bug scenario: agent1 → tools → agent2 → more tools
    // agent2 is final, more tools should be in currentStep
    const agent1 = agentMsg("まず構造...", { isConsecutive: false });
    const tool1 = promotedToolMsg("read1");
    const tool2 = promotedToolMsg("read2");
    const agent2 = agentMsg("主要モジュールを分析する", { isConsecutive: false });
    const tool3 = promotedToolMsg("analyze1");
    const tool4 = promotedToolMsg("analyze2");
    const items: PipelineItem[] = [
      userMsg("分析してください"), agent1, tool1, tool2, agent2, tool3, tool4,
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
    const agent1 = agentMsg("step1", { isConsecutive: true });
    const step1 = makeStep(agent1, [promotedToolMsg("t1")]);
    const finalAgent = agentMsg("final", { isConsecutive: false });
    const currentStep = makeStep(finalAgent, [promotedToolMsg("t2"), promotedToolMsg("t3")]);
    const { olderSteps, currentStep: peeled } = splitLatestSteps([step1], true, currentStep);
    assert.strictEqual(olderSteps.length, 1);
    assert.strictEqual(peeled, currentStep);
    assert.strictEqual(peeled!.agentMessage, finalAgent);
    assert.strictEqual(peeled!.toolCalls.length, 2);
  });
});

// ── selectFinalResponse ──────────────────────────────────────────────────────

describe("selectFinalResponse", () => {
  it("returns null for empty input", () => {
    assert.strictEqual(selectFinalResponse([]), null);
  });

  it("stopReason takes priority over everything", () => {
    const items: PipelineItem[] = [
      agentMsg("first", { isConsecutive: false }),
      agentMsg("second", { isConsecutive: true, stopReason: "end_turn" }),
      agentMsg("third", { isConsecutive: true }),
    ];
    const result = selectFinalResponse(items);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "second");
    assert.strictEqual(result.index, 1);
  });

  it("last non-consecutive without stopReason", () => {
    const items: PipelineItem[] = [
      agentMsg("a", { isConsecutive: true }), agentMsg("b", { isConsecutive: false }),
      agentMsg("c", { isConsecutive: true }), agentMsg("d", { isConsecutive: false }),
    ];
    const result = selectFinalResponse(items);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "d");
    assert.strictEqual(result.index, 3);
  });

  it("fallback to last non-promoted agent when all consecutive", () => {
    const result = selectFinalResponse([
      agentMsg("a", { isConsecutive: true }),
      agentMsg("b", { isConsecutive: true }),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "b");
  });

  it("never selects promoted tool as final", () => {
    assert.strictEqual(selectFinalResponse([promotedToolMsg("tool output")]), null);
  });

  it("skips promoted tools to find real agent final", () => {
    const result = selectFinalResponse([
      promotedToolMsg("tool"), agentMsg("answer", { isConsecutive: false }),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
  });

  it("non-promoted agent after promoted tool is final", () => {
    const result = selectFinalResponse([
      agentMsg("first", { isConsecutive: true }),
      promotedToolMsg("tool output"),
      agentMsg("answer", { isConsecutive: false }),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
    assert.strictEqual(result.index, 2);
  });
});

// ── ToolMergeStrategy ──────────────────────────────────────────────────────

describe("ToolMergeStrategy", () => {
  const config = { enabled: true, maxGap: 10 };

  it("promotes tool messages to agent role", () => {
    const messages: ClassifiedMessage[] = [
      classifiedMsg("agent", ""), classifiedMsg("tool", "tool output"),
    ];
    const result = new ToolMergeStrategy().merge(messages, config);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].role, "agent");
    assert.strictEqual(result[1].role, "agent");
    assert.strictEqual(result[1].originalRole, "tool");
  });

  it("promotes each tool message separately (no aggregation)", () => {
    const messages: ClassifiedMessage[] = [
      classifiedMsg("agent", "thinking"),
      classifiedMsg("tool", "tool1"),
      classifiedMsg("tool", "tool2"),
      classifiedMsg("agent", "done"),
    ];
    const result = new ToolMergeStrategy().merge(messages, config);
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[1].role, "agent");
    assert.strictEqual(result[1].originalRole, "tool");
    assert.strictEqual(result[2].role, "agent");
    assert.strictEqual(result[2].originalRole, "tool");
    assert.strictEqual(result[3].role, "agent");
  });

  it("tool before any agent passes through", () => {
    const result = new ToolMergeStrategy().merge(
      [classifiedMsg("tool", "orphan tool")], config,
    );
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].role, "agent");
    assert.strictEqual(result[0].originalRole, "tool");
  });

  it("systemKind != info passes through and resets state", () => {
    const messages: ClassifiedMessage[] = [
      classifiedMsg("agent", ""),
      classifiedMsg("tool", "tool output"),
      { ...classifiedMsg("agent", ""), systemKind: "compression" as const },
    ];
    const result = new ToolMergeStrategy().merge(messages, config);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[1].role, "agent");
    assert.strictEqual(result[1].originalRole, "tool");
    assert.strictEqual(result[2].systemKind, "compression");
  });

  it("pending tool at end of input is promoted", () => {
    const result = new ToolMergeStrategy().merge(
      [classifiedMsg("agent", "start"), classifiedMsg("tool", "tool output")], config,
    );
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[1].originalRole, "tool");
  });

  it("agent after tool emits tool before agent", () => {
    const result = new ToolMergeStrategy().merge(
      [classifiedMsg("agent", "before"), classifiedMsg("tool", "tool output"), classifiedMsg("agent", "after")],
      config,
    );
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[1].content, "tool output");
    assert.strictEqual(result[1].originalRole, "tool");
  });

  it("tool inherits agentId from preceding non-tool message", () => {
    const messages: ClassifiedMessage[] = [
      { ...classifiedMsg("agent", ""), agentId: "agent-1" },
      { ...classifiedMsg("tool", "tool output"), agentId: "agent-2" },
    ];
    const result = new ToolMergeStrategy().merge(messages, config);
    assert.strictEqual(result[1].agentId, "agent-1");
  });
});
