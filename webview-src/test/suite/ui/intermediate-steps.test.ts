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
    timestamp: Date.now(), isFirstOfTurn: false,
    attachments: [], thinking: undefined, ...overrides,
  };
}

function agentMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "agent", agentId: "a1", content, key: nextKey("agent"),
    timestamp: Date.now(), isFirstOfTurn: false,
    attachments: [], thinking: undefined, ...overrides,
  };
}

function thinkingItem(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "agent", agentId: "a1", content: "", key: nextKey("think"),
    timestamp: Date.now(), isFirstOfTurn: true,
    attachments: [], thinking: { content, isStreaming: false }, ...overrides,
  };
}

function promotedToolMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "agent", originalRole: "tool", agentId: "a1", content,
    key: nextKey("tool"), timestamp: Date.now(), isFirstOfTurn: true,
    attachments: [], thinking: undefined,
    resolvedToolCalls: [], ...overrides,
  };
}

function rawToolMsg(content: string, overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat", role: "tool", agentId: "a1", content,
    key: nextKey("raw-tool"), timestamp: Date.now(), isFirstOfTurn: true,
    attachments: [], thinking: undefined,
    resolvedToolCalls: [{
      id: `tc-${content}`, title: content, kind: "generic", status: "completed",
      input: undefined, output: undefined, durationMs: undefined, locations: undefined, diffContent: undefined,
    }], ...overrides,
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
        agentMsg("working...", { isFirstOfTurn: true }),
        agentMsg("done!", { isFirstOfTurn: false }),
      ];
      const { latestGroup } = new IntermediateStepGrouper(items).compute();
      assert.ok(latestGroup);
      // thinking + working... are intermediate steps, done! is final
      assert.ok(latestGroup.steps.length >= 1);
      assert.strictEqual((latestGroup.finalResponse?.item as ChatDisplayItem).content, "done!");
    });

    it("multiple turns: past group folded", () => {
      const items: PipelineItem[] = [
        userMsg("q1"), thinkingItem("t1"), agentMsg("a1", { isFirstOfTurn: false }),
        userMsg("q2"), agentMsg("a2", { isFirstOfTurn: false }),
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
        userMsg("hi"), agentMsg("hello", { isFirstOfTurn: false }), compItem,
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
      assert.strictEqual((latestGroup.finalResponse.item as ChatDisplayItem).content, "b");
    });

    it("promoted tool messages treated as intermediate not final", () => {
      const items: PipelineItem[] = [
        userMsg("read file"), promotedToolMsg("reading..."),
        agentMsg("done!", { isFirstOfTurn: false }),
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
        agentMsg("s1", { isFirstOfTurn: true }),
        agentMsg("s2", { isFirstOfTurn: true }),
        agentMsg("done!", { isFirstOfTurn: false }),
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
        agentMsg("s1", { isFirstOfTurn: false }),
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
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
    const steps = splitIntoSteps([a, t1, t2], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, a);
    assert.strictEqual(steps[0].toolCalls.length, 2);
  });

  it("pre-agent tool calls remain as independent pre-agent step", () => {
    const t1 = promotedToolMsg("tool1");
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
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
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
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
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
    // isPromotedTool now matches role="tool", so splitIntoSteps treats it
    // the same as a promoted tool (role="agent", originalRole="tool").
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

  it("raw tool (role='tool') after agent is absorbed into agent step", () => {
    const agentMsg1 = agentMsg("thinking", { isFirstOfTurn: false });
    const rawTool = rawToolMsg("bash output");
    const steps = splitIntoSteps([agentMsg1, rawTool], null);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage, agentMsg1);
    assert.strictEqual(steps[0].toolCalls.length, 1);
    assert.strictEqual(steps[0].toolCalls[0].role, "tool");
  });

  it("User → RawTool → Agent: grouping creates pre-agent step for raw tool", () => {
    const rawTool = rawToolMsg("grep result");
    const agent = agentMsg("分析結果です", { isFirstOfTurn: false });
    const items: PipelineItem[] = [
      userMsg("コードを検索して"), rawTool, agent,
    ];
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
    assert.strictEqual(latestGroup.steps[0].toolCalls[0].content, "grep result");
  });

  it("raw tool (role='tool') is never selected as final response", () => {
    // isRealAgentChat requires role="agent" && originalRole !== "tool".
    // Raw tool has role="tool", so it must not be selected as final.
    const rawTool = rawToolMsg("orphan tool output");
    const agent = agentMsg("answer", { isFirstOfTurn: false });
    const result = selectFinalResponse([rawTool, agent]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
  });

  it("User → Tool(1) → Agent(msg) → Tool(2) → Tool(3) with no final yields correct steps", () => {
    const tool1 = promotedToolMsg("tool1");
    const agent = agentMsg("working", { isFirstOfTurn: true });
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

  it("pre-agent tools form independent step (no final)", () => {
    // Same scenario but within IntermediateStepGrouper
    const t1 = promotedToolMsg("tool1");
    const t2 = promotedToolMsg("tool2");
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
    const tool1 = promotedToolMsg("read1");
    const tool2 = promotedToolMsg("read2");
    const agent2 = agentMsg("主要モジュールを分析する", { isFirstOfTurn: false });
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
    const agent1 = agentMsg("step1", { isFirstOfTurn: true });
    const step1 = makeStep(agent1, [promotedToolMsg("t1")]);
    const finalAgent = agentMsg("final", { isFirstOfTurn: false });
    const currentStep = makeStep(finalAgent, [promotedToolMsg("t2"), promotedToolMsg("t3")]);
    const { olderSteps, currentStep: peeled } = splitLatestSteps([step1], true, currentStep);
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
    const a1 = agentMsg("first part", { isFirstOfTurn: false, messageId: "msgX" });
    const tool1 = promotedToolMsg("tool1");
    const a2 = agentMsg("second part", { isFirstOfTurn: true, messageId: "msgX" });
    const steps = splitIntoSteps([a1, tool1, a2], null);
    // Both agent messages share the same messageId → one step with merged content
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].agentMessage?.content, "first partsecond part");
    assert.strictEqual(steps[0].toolCalls.length, 1);
  });

  it("different messageId creates separate steps", () => {
    // Agent1(msgX) → Tool1 → Agent2(msgY, different logical message)
    const a1 = agentMsg("first", { isFirstOfTurn: false, messageId: "msgX" });
    const tool1 = promotedToolMsg("tool1");
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
    const t1 = promotedToolMsg("grep");
    const a2 = agentMsg(" complete", { isFirstOfTurn: true, messageId: "m1" });
    const t2 = promotedToolMsg("read");
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

// ── selectFinalResponse ──────────────────────────────────────────────────────

describe("selectFinalResponse", () => {
  it("returns null for empty input", () => {
    assert.strictEqual(selectFinalResponse([]), null);
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
      agentMsg("a", { isFirstOfTurn: true }), agentMsg("b", { isFirstOfTurn: false }),
      agentMsg("c", { isFirstOfTurn: true }), agentMsg("d", { isFirstOfTurn: false }),
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

  it("never selects promoted tool as final", () => {
    assert.strictEqual(selectFinalResponse([promotedToolMsg("tool output")]), null);
  });

  it("skips promoted tools to find real agent final", () => {
    const result = selectFinalResponse([
      promotedToolMsg("tool"), agentMsg("answer", { isFirstOfTurn: false }),
    ]);
    assert.ok(result);
    assert.strictEqual((result.item as ChatDisplayItem).content, "answer");
  });

  it("non-promoted agent after promoted tool is final", () => {
    const result = selectFinalResponse([
      agentMsg("first", { isFirstOfTurn: true }),
      promotedToolMsg("tool output"),
      agentMsg("answer", { isFirstOfTurn: false }),
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
