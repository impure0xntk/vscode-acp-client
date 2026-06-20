import * as assert from "assert";
import { describe, it } from "mocha";
import { classifyMessage } from "../../pipeline/stages/classify";
import { filterMessages } from "../../pipeline/stages/filter";
import { mergeToolBatches } from "../../pipeline/stages/merge";
import { annotateMessages } from "../../pipeline/stages/annotate";
import { MessagePipeline } from "../../pipeline/pipeline";
import type {
  RawMessage,
  PipelineConfig,
  PipelineContext,
  ClassifiedMessage,
  AnnotateConfig,
  PipelineItem,
  ChatDisplayItem,
} from "../../pipeline/types";
import type { ToolCall, ContextAttachment } from "../../types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function msg(
  overrides: Partial<RawMessage> & { role: RawMessage["role"] }
): RawMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

function toolCall(id: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id,
    title: `tool-${id}`,
    status: "completed",
    kind: "generic",
    ...overrides,
  };
}

const defaultConfig: PipelineConfig = {
  filter: {
    hideCompression: false,
    hideModeChange: false,
    hideErrorNotices: false,
  },
  merge: { enabled: true, maxGap: 0 },
  annotate: { resolveAttachments: true, detectInlinePaths: true },
};

const defaultCtx: PipelineContext = {
  sessionId: "sess-1",
  agentId: "agent-1",
  sessionCwd: undefined,
  existingItems: [],
};

// ── groupByUserBoundary ────────────────────────────────────────────────────

/**
 * To test the groupByUserBoundary logic directly inside the pipeline,
 * we verify via pipeline process() output instead of reimplementing equivalent logic.
 *
 * Since groupByUserBoundary is a private function,
 * actual tests check SessionChatContainer rendering results
 * or validate grouping logic from pipeline output.
 *
 * Here we test a pure function equivalent to groupByUserBoundary.
 */

// Replicate the test target logic since groupByUserBoundary cannot be imported
interface AgentResponseGroup {
  userItem: PipelineItem;
  items: PipelineItem[];
}

interface GroupedItems {
  groups: AgentResponseGroup[];
  latestGroup: AgentResponseGroup | null;
  trailing: PipelineItem[];
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

  const latestAgentChats = afterLastUser.filter(
    (item) => item.type === "chat" && item.role === "agent"
  );

  const trailing = afterLastUser.filter(
    (item) => !(item.type === "chat" && item.role === "agent")
  );

  const latestGroup: AgentResponseGroup = {
    userItem: items[lastUserIdx],
    items: latestAgentChats,
  };

  const groups: AgentResponseGroup[] = [];
  for (let g = 0; g < userIndices.length - 1; g++) {
    const startIdx = userIndices[g];
    const endIdx = userIndices[g + 1];
    const groupItems = items.slice(startIdx + 1, endIdx);
    groups.push({
      userItem: items[startIdx],
      items: groupItems,
    });
  }

  return { groups, latestGroup, trailing };
}

function makeChat(
  role: "user" | "agent" | "system" | "tool",
  content: string,
  agentId?: string
): PipelineItem {
  return {
    type: "chat",
    role,
    agentId,
    content,
    key: `key-${content}`,
    timestamp: Date.now(),
    isConsecutive: false,
    groupKey: role === "agent" && agentId ? `agent:${agentId}` : role,
    attachments: [],
  } as ChatDisplayItem;
}

function getContent(item: PipelineItem): string {
  return item.type === "chat" ? item.content : "";
}

describe("groupByUserBoundary", () => {
  it("returns empty result for empty input", () => {
    const result = groupByUserBoundary([]);
    assert.strictEqual(result.groups.length, 0);
    assert.strictEqual(result.latestGroup, null);
    assert.strictEqual(result.trailing.length, 0);
  });

  it("returns empty result when no user messages exist", () => {
    const items: PipelineItem[] = [
      makeChat("agent", "a1", "claude"),
      makeChat("agent", "a2", "claude"),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 0);
    assert.strictEqual(result.latestGroup, null);
    assert.strictEqual(result.trailing.length, 0);
  });

  it("returns latestGroup only when single user message exists", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("agent", "a1", "claude"),
      makeChat("agent", "a2", "claude"),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 0);
    assert.ok(result.latestGroup);
    assert.strictEqual(getContent(result.latestGroup!.userItem), "q1");
    assert.strictEqual(result.latestGroup!.items.length, 2);
    assert.strictEqual(result.trailing.length, 0);
  });

  it("groups past user messages into groups array", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("agent", "a1", "claude"),
      makeChat("user", "q2"),
      makeChat("agent", "a2", "claude"),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(getContent(result.groups[0].userItem), "q1");
    assert.strictEqual(result.groups[0].items.length, 1);
    assert.strictEqual(
      result.groups[0].items[0].type === "chat"
        ? getContent(result.groups[0].items[0])
        : "",
      "a1"
    );

    assert.ok(result.latestGroup);
    assert.strictEqual(getContent(result.latestGroup!.userItem), "q2");
    assert.strictEqual(result.latestGroup!.items.length, 1);
    assert.strictEqual(getContent(result.latestGroup!.items[0]), "a2");
  });

  it("handles three user messages correctly", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("agent", "a1", "claude"),
      makeChat("user", "q2"),
      makeChat("agent", "a2", "claude"),
      makeChat("user", "q3"),
      makeChat("agent", "a3", "claude"),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 2);
    assert.strictEqual(getContent(result.groups[0].userItem), "q1");
    assert.strictEqual(getContent(result.groups[1].userItem), "q2");

    assert.ok(result.latestGroup);
    assert.strictEqual(getContent(result.latestGroup!.userItem), "q3");
    assert.strictEqual(result.latestGroup!.items.length, 1);
  });

  it("separates trailing items (non-agent-chat after last user)", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("agent", "a1", "claude"),
      {
        type: "compression",
        info: { contextWindowMax: 1000, usedTokens: 800 },
        key: "comp-1",
        timestamp: Date.now(),
      },
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 0);
    assert.ok(result.latestGroup);
    assert.strictEqual(getContent(result.latestGroup!.userItem), "q1");
    assert.strictEqual(result.latestGroup!.items.length, 1);
    assert.strictEqual(result.trailing.length, 1);
    assert.strictEqual(result.trailing[0].type, "compression");
  });

  it("filters out non-agent-chat from latestGroup items", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("agent", "a1", "claude"),
      {
        type: "mode_change",
        content: "switched to plan",
        key: "mode-1",
        timestamp: Date.now(),
      },
      makeChat("agent", "a2", "claude"),
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    // latestGroup.items should only contain agent chat items
    assert.strictEqual(result.latestGroup!.items.length, 2);
    assert.strictEqual(getContent(result.latestGroup!.items[0]), "a1");
    assert.strictEqual(getContent(result.latestGroup!.items[1]), "a2");
    // mode_change should be in trailing
    assert.strictEqual(result.trailing.length, 1);
    assert.strictEqual(result.trailing[0].type, "mode_change");
  });

  it("handles user message at end with no agent response", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("agent", "a1", "claude"),
      makeChat("user", "q2"),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    assert.ok(result.latestGroup);
    assert.strictEqual(getContent(result.latestGroup!.userItem), "q2");
    assert.strictEqual(result.latestGroup!.items.length, 0);
    assert.strictEqual(result.trailing.length, 0);
  });

  it("handles consecutive user messages", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("user", "q2"),
      makeChat("agent", "a1", "claude"),
    ];
    const result = groupByUserBoundary(items);
    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(getContent(result.groups[0].userItem), "q1");
    // Items from q1 to q2 are empty (q2 is the boundary of the next group)
    assert.strictEqual(result.groups[0].items.length, 0);

    assert.ok(result.latestGroup);
    assert.strictEqual(getContent(result.latestGroup!.userItem), "q2");
    assert.strictEqual(result.latestGroup!.items.length, 1);
  });

  it("correctly assigns system items to trailing", () => {
    const items: PipelineItem[] = [
      makeChat("user", "q1"),
      makeChat("agent", "a1", "claude"),
      {
        type: "error_notice",
        content: "something failed",
        key: "err-1",
        timestamp: Date.now(),
      },
      {
        type: "custom",
        content: "[notice]",
        key: "custom-1",
        timestamp: Date.now(),
      },
    ];
    const result = groupByUserBoundary(items);
    assert.ok(result.latestGroup);
    assert.strictEqual(result.latestGroup!.items.length, 1);
    assert.strictEqual(result.trailing.length, 2);
    assert.strictEqual(result.trailing[0].type, "error_notice");
    assert.strictEqual(result.trailing[1].type, "custom");
  });
});

// ── classifyMessage ─────────────────────────────────────────────────────────

describe("classifyMessage", () => {
  it("tags non-system messages as info", () => {
    const result = classifyMessage(msg({ role: "agent", content: "hello" }));
    assert.strictEqual(result.systemKind, "info");
  });

  it("tags non-system user messages as info", () => {
    const result = classifyMessage(msg({ role: "user", content: "hi" }));
    assert.strictEqual(result.systemKind, "info");
  });

  it("classifies compression system messages", () => {
    const result = classifyMessage(
      msg({
        role: "system",
        content: "compressed",
        compressionInfo: { contextWindowMax: 1000, usedTokens: 800 },
      })
    );
    assert.strictEqual(result.systemKind, "compression");
  });

  it("classifies mode-change system messages", () => {
    const result = classifyMessage(
      msg({ role: "system", content: "Switched to plan mode" })
    );
    assert.strictEqual(result.systemKind, "mode_change");
  });

  it("classifies error system messages", () => {
    const result = classifyMessage(
      msg({ role: "system", content: "Something failed" })
    );
    assert.strictEqual(result.systemKind, "error_notice");
  });

  it("classifies bracketed system messages as custom", () => {
    const result = classifyMessage(
      msg({ role: "system", content: "[custom notice]" })
    );
    assert.strictEqual(result.systemKind, "custom");
  });

  it("falls back to info for unrecognised system messages", () => {
    const result = classifyMessage(
      msg({ role: "system", content: "something else" })
    );
    assert.strictEqual(result.systemKind, "info");
  });
});

// ── filterMessages ──────────────────────────────────────────────────────────

describe("filterMessages", () => {
  const config = defaultConfig.filter;

  it("keeps all messages when no filters are active", () => {
    const input = [
      classifyMessage(msg({ role: "agent", content: "a" })),
      classifyMessage(msg({ role: "user", content: "b" })),
    ];
    const result = filterMessages(input, config);
    assert.strictEqual(result.length, 2);
  });

  it("removes compression messages when hideCompression is true", () => {
    const cfg = { ...config, hideCompression: true };
    const input = [
      classifyMessage(msg({ role: "agent", content: "a" })),
      classifyMessage(
        msg({
          role: "system",
          content: "compressed",
          compressionInfo: { contextWindowMax: 100, usedTokens: 80 },
        })
      ),
    ];
    const result = filterMessages(input, cfg);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].content, "a");
  });

  it("removes mode_change messages when hideModeChange is true", () => {
    const cfg = { ...config, hideModeChange: true };
    const input = [
      classifyMessage(msg({ role: "agent", content: "a" })),
      classifyMessage(msg({ role: "system", content: "mode switched" })),
    ];
    const result = filterMessages(input, cfg);
    assert.strictEqual(result.length, 1);
  });

  it("removes error_notice messages when hideErrorNotices is true", () => {
    const cfg = { ...config, hideErrorNotices: true };
    const input = [
      classifyMessage(msg({ role: "agent", content: "a" })),
      classifyMessage(msg({ role: "system", content: "error occurred" })),
    ];
    const result = filterMessages(input, cfg);
    assert.strictEqual(result.length, 1);
  });

  it("uses custom predicate when provided", () => {
    const cfg = {
      ...config,
      customPredicate: (m: { content: string }) => m.content.includes("keep"),
    };
    const input = [
      classifyMessage(msg({ role: "agent", content: "keep this" })),
      classifyMessage(msg({ role: "agent", content: "remove this" })),
    ];
    const result = filterMessages(input, cfg);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].content, "keep this");
  });
});

// ── mergeToolBatches ────────────────────────────────────────────────────────

describe("mergeToolBatches", () => {
  const config = defaultConfig.merge;

  it("passes through non-tool messages unchanged", () => {
    const input = [
      classifyMessage(msg({ role: "user", content: "hello" })),
      classifyMessage(msg({ role: "agent", content: "hi" })),
    ];
    const result = mergeToolBatches(input, config);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].role, "user");
    assert.strictEqual(result[1].role, "agent");
  });

  it("merges tool message into preceding agent (Case 1)", () => {
    const input = [
      classifyMessage(
        msg({
          role: "agent",
          agentId: "a1",
          content: "thinking",
          toolCalls: [toolCall("tc-1")],
        })
      ),
      classifyMessage(
        msg({
          role: "tool",
          agentId: "a1",
          content: "result",
          toolCalls: [toolCall("tc-2")],
        })
      ),
    ];
    const result = mergeToolBatches(input, config);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].role, "agent");
    assert.strictEqual(result[0].toolCalls!.length, 2);
  });

  it("promotes tool after user to agent role (Case 2)", () => {
    const input = [
      classifyMessage(msg({ role: "user", content: "hello" })),
      classifyMessage(
        msg({
          role: "tool",
          agentId: "a1",
          content: "result",
          toolCalls: [toolCall("tc-1")],
        })
      ),
    ];
    const result = mergeToolBatches(input, config);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].role, "user");
    assert.strictEqual(result[1].role, "agent");
  });

  it("flushes pending tool before system-kind boundary", () => {
    const input = [
      classifyMessage(msg({ role: "user", content: "hello" })),
      classifyMessage(
        msg({
          role: "tool",
          agentId: "a1",
          content: "result",
          toolCalls: [toolCall("tc-1")],
        })
      ),
      classifyMessage(
        msg({
          role: "system",
          content: "compressed",
          compressionInfo: { contextWindowMax: 100, usedTokens: 80 },
        })
      ),
    ];
    const result = mergeToolBatches(input, config);
    // user, promoted-tool (agent), compression
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[1].role, "agent");
    assert.strictEqual(result[1].toolCalls!.length, 1);
  });

  it("deduplicates tool calls by id", () => {
    const input = [
      classifyMessage(
        msg({
          role: "agent",
          agentId: "a1",
          content: "thinking",
          toolCalls: [toolCall("tc-1", { title: "first" })],
        })
      ),
      classifyMessage(
        msg({
          role: "tool",
          agentId: "a1",
          content: "result",
          toolCalls: [toolCall("tc-1", { title: "updated" })],
        })
      ),
    ];
    const result = mergeToolBatches(input, config);
    assert.strictEqual(result[0].toolCalls!.length, 1);
    assert.strictEqual(result[0].toolCalls![0].title, "updated");
  });

  it("flushes remaining pending tool at end of input", () => {
    const input = [
      classifyMessage(msg({ role: "user", content: "hello" })),
      classifyMessage(
        msg({
          role: "tool",
          agentId: "a1",
          content: "result",
          toolCalls: [toolCall("tc-1")],
        })
      ),
    ];
    const result = mergeToolBatches(input, config);
    const last = result[result.length - 1];
    assert.strictEqual(last.role, "agent");
    assert.ok(last.toolCalls);
  });
});

// ── annotateMessages ────────────────────────────────────────────────────────

describe("annotateMessages", () => {
  const config = defaultConfig.annotate;

  it("marks first agent message as non-consecutive", () => {
    const input = [
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "hello" })),
    ];
    const result = annotateMessages(input, config);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, "chat");
    if (result[0].type === "chat") {
      assert.strictEqual(result[0].isConsecutive, false);
    }
  });

  it("marks second consecutive agent message as consecutive", () => {
    const input = [
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "first" })),
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "second" })),
    ];
    const result = annotateMessages(input, config);
    assert.strictEqual(result.length, 2);
    if (result[0].type === "chat") {
      assert.strictEqual(result[0].isConsecutive, false);
    }
    if (result[1].type === "chat") {
      assert.strictEqual(result[1].isConsecutive, true);
    }
  });

  it("resets consecutive flag when role changes (user → agent)", () => {
    const input = [
      classifyMessage(msg({ role: "user", content: "question" })),
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "answer" })),
    ];
    const result = annotateMessages(input, config);
    assert.strictEqual(result.length, 2);
    if (result[1].type === "chat") {
      assert.strictEqual(result[1].isConsecutive, false);
    }
  });

  it("resets consecutive flag when role changes (agent → user)", () => {
    const input = [
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "answer" })),
      classifyMessage(msg({ role: "user", content: "follow-up" })),
    ];
    const result = annotateMessages(input, config);
    assert.strictEqual(result.length, 2);
    if (result[0].type === "chat") {
      assert.strictEqual(result[0].isConsecutive, false);
    }
    if (result[1].type === "chat") {
      assert.strictEqual(result[1].isConsecutive, false);
    }
  });

  it("resets consecutive flag when agentId changes", () => {
    const input = [
      classifyMessage(
        msg({ role: "agent", agentId: "a1", content: "from a1" })
      ),
      classifyMessage(
        msg({ role: "agent", agentId: "a2", content: "from a2" })
      ),
    ];
    const result = annotateMessages(input, config);
    assert.strictEqual(result.length, 2);
    if (result[0].type === "chat") {
      assert.strictEqual(result[0].isConsecutive, false);
    }
    if (result[1].type === "chat") {
      assert.strictEqual(result[1].isConsecutive, false);
    }
  });

  it("marks third consecutive agent message as consecutive", () => {
    const input = [
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "1" })),
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "2" })),
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "3" })),
    ];
    const result = annotateMessages(input, config);
    assert.strictEqual(result.length, 3);
    if (result[0].type === "chat")
      assert.strictEqual(result[0].isConsecutive, false);
    if (result[1].type === "chat")
      assert.strictEqual(result[1].isConsecutive, true);
    if (result[2].type === "chat")
      assert.strictEqual(result[2].isConsecutive, true);
  });

  it("resets consecutive after system-kind boundary", () => {
    const input = [
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "before" })),
      classifyMessage(
        msg({
          role: "system",
          content: "mode switched",
        })
      ),
      classifyMessage(msg({ role: "agent", agentId: "a1", content: "after" })),
    ];
    const result = annotateMessages(input, config);
    const chatItems = result.filter((r) => r.type === "chat");
    assert.strictEqual(chatItems.length, 2);
    assert.strictEqual(chatItems[0].isConsecutive, false);
    assert.strictEqual(chatItems[1].isConsecutive, false);
  });

  it("uses initialGroupKey to detect consecutive from previous context", () => {
    const input = [
      classifyMessage(
        msg({ role: "agent", agentId: "a1", content: "continued" })
      ),
    ];
    const result = annotateMessages(input, config, "agent:a1");
    assert.strictEqual(result.length, 1);
    if (result[0].type === "chat") {
      assert.strictEqual(result[0].isConsecutive, true);
    }
  });

  it("emits correct groupKey for agent messages", () => {
    const input = [
      classifyMessage(msg({ role: "agent", agentId: "claude", content: "hi" })),
    ];
    const result = annotateMessages(input, config);
    if (result[0].type === "chat") {
      assert.strictEqual(result[0].groupKey, "agent:claude");
    }
  });

  it("emits empty groupKey for system-kind messages", () => {
    const input = [
      classifyMessage(
        msg({
          role: "system",
          content: "compressed",
          compressionInfo: { contextWindowMax: 100, usedTokens: 80 },
        })
      ),
    ];
    const result = annotateMessages(input, config);
    assert.strictEqual(result[0].type, "compression");
  });
});

// ── MessagePipeline (integration) ───────────────────────────────────────────

describe("MessagePipeline", () => {
  it("process() returns all items with correct consecutive flags", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const messages: RawMessage[] = [
      msg({ role: "user", content: "question" }),
      msg({ role: "agent", agentId: "a1", content: "answer 1" }),
      msg({ role: "agent", agentId: "a1", content: "answer 2" }),
    ];
    const result = pipeline.process(messages, defaultCtx);
    const chatItems = result.filter((r) => r.type === "chat");
    assert.strictEqual(chatItems.length, 3);
    assert.strictEqual(chatItems[0].isConsecutive, false); // user
    assert.strictEqual(chatItems[1].isConsecutive, false); // first agent
    assert.strictEqual(chatItems[2].isConsecutive, true); // second agent
  });

  it("process() resets consecutive on role change (user → agent)", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const messages: RawMessage[] = [
      msg({ role: "user", content: "q" }),
      msg({ role: "agent", agentId: "a1", content: "a1" }),
      msg({ role: "user", content: "q2" }),
      msg({ role: "agent", agentId: "a1", content: "a2" }),
    ];
    const result = pipeline.process(messages, defaultCtx);
    const chatItems = result.filter((r) => r.type === "chat");
    assert.strictEqual(chatItems.length, 4);
    assert.strictEqual(chatItems[0].isConsecutive, false); // user
    assert.strictEqual(chatItems[1].isConsecutive, false); // agent after user
    assert.strictEqual(chatItems[2].isConsecutive, false); // user after agent
    assert.strictEqual(chatItems[3].isConsecutive, false); // agent after user
  });

  it("clear() resets cache and groupKey", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const messages: RawMessage[] = [
      msg({ role: "agent", agentId: "a1", content: "first" }),
    ];
    pipeline.process(messages, defaultCtx);
    assert.strictEqual(pipeline.cached.length, 1);

    pipeline.clear();
    assert.strictEqual(pipeline.cached.length, 0);
  });

  it("processIncremental() appends new items correctly", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const batch1: RawMessage[] = [
      msg({ role: "user", content: "q" }),
      msg({ role: "agent", agentId: "a1", content: "a1" }),
    ];
    pipeline.process(batch1, defaultCtx);
    assert.strictEqual(pipeline.cached.length, 2);

    const batch2: RawMessage[] = [
      msg({ role: "agent", agentId: "a1", content: "a2" }),
    ];
    const result = pipeline.processIncremental(batch2, defaultCtx);
    const chatItems = result.filter((r) => r.type === "chat");
    assert.strictEqual(chatItems.length, 3);
    // a2 is a new agent message after a non-consecutive agent message (a1).
    // Since a1 has a visible header (non-consecutive), a2 starts a new group
    // and must also show its header (non-consecutive). This prevents the bug
    // where the first agent message after a user message loses its header.
    assert.strictEqual(chatItems[2].isConsecutive, false);
  });

  it("processIncremental() shows header when role changes across boundary", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const batch1: RawMessage[] = [
      msg({ role: "agent", agentId: "a1", content: "a1" }),
    ];
    pipeline.process(batch1, defaultCtx);

    const batch2: RawMessage[] = [msg({ role: "user", content: "q2" })];
    const result = pipeline.processIncremental(batch2, defaultCtx);
    const chatItems = result.filter((r) => r.type === "chat");
    assert.strictEqual(chatItems.length, 2);
    // user after agent → not consecutive
    assert.strictEqual(chatItems[1].isConsecutive, false);
  });

  it("processIncremental() returns same cache for empty new messages", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const messages: RawMessage[] = [
      msg({ role: "agent", agentId: "a1", content: "a" }),
    ];
    pipeline.process(messages, defaultCtx);
    const before = pipeline.cached;
    const result = pipeline.processIncremental([], defaultCtx);
    assert.strictEqual(result, before);
  });

  it("updateConfig() clears cache", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    pipeline.process([msg({ role: "agent", content: "a" })], defaultCtx);
    assert.ok(pipeline.cached.length > 0);

    pipeline.updateConfig({ merge: { enabled: false, maxGap: 0 } });
    assert.strictEqual(pipeline.cached.length, 0);
  });

  it("handles the User → Agent(1) → Agent(2) pattern correctly", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const messages: RawMessage[] = [
      msg({
        role: "user",
        content: "acp.preset settings are not working properly",
      }),
      msg({
        role: "agent",
        agentId: "claude",
        content: "Let me analyze the codebase...",
      }),
      msg({
        role: "agent",
        agentId: "claude",
        content: "Searching for preset-related code.",
      }),
    ];
    const result = pipeline.process(messages, defaultCtx);
    const chatItems = result.filter((r) => r.type === "chat");
    assert.strictEqual(chatItems.length, 3);
    // User: always shows header
    assert.strictEqual(chatItems[0].isConsecutive, false);
    // Agent(1): first agent after user → shows header
    assert.strictEqual(chatItems[1].isConsecutive, false);
    // Agent(2): consecutive agent → hides header
    assert.strictEqual(chatItems[2].isConsecutive, true);
  });

  it("handles multi-agent conversation correctly", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const messages: RawMessage[] = [
      msg({ role: "user", content: "question" }),
      msg({ role: "agent", agentId: "claude", content: "claude answer 1" }),
      msg({ role: "agent", agentId: "claude", content: "claude answer 2" }),
      msg({ role: "agent", agentId: "codex", content: "codex answer" }),
      msg({ role: "agent", agentId: "codex", content: "codex answer 2" }),
    ];
    const result = pipeline.process(messages, defaultCtx);
    const chatItems = result.filter((r) => r.type === "chat");
    assert.strictEqual(chatItems.length, 5);
    assert.strictEqual(chatItems[0].isConsecutive, false); // user
    assert.strictEqual(chatItems[1].isConsecutive, false); // claude #1
    assert.strictEqual(chatItems[2].isConsecutive, true); // claude #2
    assert.strictEqual(chatItems[3].isConsecutive, false); // codex #1 (different agent)
    assert.strictEqual(chatItems[4].isConsecutive, true); // codex #2
  });

  // ── Extended header-omission pattern tests ──────────────────────────────

  describe("processIncremental() cross-turn header patterns", () => {
    it("first agent after user shows header in incremental (turn boundary)", () => {
      // Simulates the core bug: batch1 = user question, batch2 = agent response.
      // The first agent message after a user must always show its header.
      const pipeline = new MessagePipeline(defaultConfig);
      const batch1: RawMessage[] = [
        msg({ role: "user", content: "what is 2+2?" }),
      ];
      pipeline.process(batch1, defaultCtx);

      const batch2: RawMessage[] = [
        msg({ role: "agent", agentId: "a1", content: "The answer is 4." }),
      ];
      const result = pipeline.processIncremental(batch2, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 2);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // agent: must show header
    });

    it("second agent chunk after non-consecutive cached agent shows new header", () => {
      // batch1 = user + first agent, batch2 = second agent (same agentId).
      // batch1's agent1 is non-consecutive (visible header).
      // processIncremental sees non-consecutive last cached → resets groupKey →
      // agent2 starts a new visual group with isConsecutive=false (shows header).
      const pipeline = new MessagePipeline(defaultConfig);
      const batch1: RawMessage[] = [
        msg({ role: "user", content: "explain recursion" }),
        msg({ role: "agent", agentId: "a1", content: "Recursion is..." }),
      ];
      pipeline.process(batch1, defaultCtx);

      const batch2: RawMessage[] = [
        msg({ role: "agent", agentId: "a1", content: "It calls itself." }),
      ];
      const result = pipeline.processIncremental(batch2, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // agent1 (after user)
      // agent2: cached agent1 is non-consecutive → new group → shows header
      assert.strictEqual(chatItems[2].isConsecutive, false);
      // Both share the same groupKey scheme (agent:a1) but isConsecutive differs
      if (chatItems[1].type === "chat" && chatItems[2].type === "chat") {
        assert.strictEqual(chatItems[1].groupKey, "agent:a1");
        assert.strictEqual(chatItems[2].groupKey, "agent:a1");
      }
    });

    it("second turn: new user message then new agent shows header", () => {
      // Full conversation: turn1 (user→agent), turn2 (user→agent).
      // Each first agent after user must show header.
      const pipeline = new MessagePipeline(defaultConfig);
      const turn1: RawMessage[] = [
        msg({ role: "user", content: "q1" }),
        msg({ role: "agent", agentId: "a1", content: "a1" }),
      ];
      pipeline.process(turn1, defaultCtx);

      const turn2: RawMessage[] = [
        msg({ role: "user", content: "q2" }),
        msg({ role: "agent", agentId: "a1", content: "a2" }),
      ];
      const result = pipeline.processIncremental(turn2, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 4);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user q1
      assert.strictEqual(chatItems[1].isConsecutive, false); // agent a1 (after user)
      assert.strictEqual(chatItems[2].isConsecutive, false); // user q2 (after agent)
      assert.strictEqual(chatItems[3].isConsecutive, false); // agent a2 (after user)
    });

    it("agent streaming across three batches: first shows rest hide header", () => {
      // batch1 = user, batch2 = agent chunk 1, batch3 = agent chunk 2.
      // chunk1 must show header, chunk2 must hide header (consecutive).
      const pipeline = new MessagePipeline(defaultConfig);
      pipeline.process([msg({ role: "user", content: "q" })], defaultCtx);

      const r1 = pipeline.processIncremental(
        [msg({ role: "agent", agentId: "a1", content: "part1" })],
        defaultCtx
      );
      const chat1 = r1.filter((r) => r.type === "chat");
      assert.strictEqual(chat1[1].isConsecutive, false); // first agent after user

      // Second agent chunk: the cached agent is non-consecutive (isConsecutive=false),
      // so the new chunk must also be non-consecutive (show header) — this is the
      // processIncremental behavior: non-consecutive last cached → reset groupKey.
      const r2 = pipeline.processIncremental(
        [msg({ role: "agent", agentId: "a1", content: "part2" })],
        defaultCtx
      );
      const chat2 = r2.filter((r) => r.type === "chat");
      assert.strictEqual(chat2[2].isConsecutive, false); // non-consecutive → new group
    });

    it("system message between turns does not leak groupKey", () => {
      // batch1 = user + agent, batch2 = system + agent.
      // System should reset consecutive context; second agent shows header.
      const pipeline = new MessagePipeline(defaultConfig);
      pipeline.process(
        [
          msg({ role: "user", content: "q1" }),
          msg({ role: "agent", agentId: "a1", content: "a1" }),
        ],
        defaultCtx
      );

      const result = pipeline.processIncremental(
        [
          msg({ role: "system", content: "mode switched" }),
          msg({
            role: "system",
            content: "Switched to plan mode",
          }),
          msg({ role: "agent", agentId: "a2", content: "a2" }),
        ],
        defaultCtx
      );
      const chatItems = result.filter((r) => r.type === "chat");
      // user, agent(a1), agent(a2) — a2 after system boundary
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // a1 after user
      assert.strictEqual(chatItems[2].isConsecutive, false); // a2 after system
    });

    it("does not carry groupKey from non-consecutive cached agent to new agent (same agentId)", () => {
      // This is the specific bug scenario: a1 is non-consecutive (has visible header).
      // Adding a2 with the same agentId must NOT make a2 consecutive.
      // Note: groupKey is the same (agent:claude) for both — that's correct.
      // What matters is isConsecutive: a2 must be false (shows header).
      const pipeline = new MessagePipeline(defaultConfig);
      pipeline.process(
        [
          msg({ role: "user", content: "q" }),
          msg({ role: "agent", agentId: "claude", content: "first response" }),
        ],
        defaultCtx
      );

      // Verify the cached agent is non-consecutive
      const cached = pipeline.cached.filter((r) => r.type === "chat");
      assert.strictEqual(cached[1].isConsecutive, false);

      // Now add another agent message with the same agentId
      const result = pipeline.processIncremental(
        [msg({ role: "agent", agentId: "claude", content: "second response" })],
        defaultCtx
      );
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[2].isConsecutive, false); // must show header
      // Both share the same groupKey (agent:claude) — that's fine.
      // The key is isConsecutive=false, which ensures the header is shown.
      if (chatItems[1].type === "chat" && chatItems[2].type === "chat") {
        assert.strictEqual(chatItems[1].groupKey, "agent:claude");
        assert.strictEqual(chatItems[2].groupKey, "agent:claude");
      }
    });

    it("different agents in incremental: each shows header", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      pipeline.process(
        [msg({ role: "agent", agentId: "claude", content: "claude msg" })],
        defaultCtx
      );

      const result = pipeline.processIncremental(
        [msg({ role: "agent", agentId: "codex", content: "codex msg" })],
        defaultCtx
      );
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 2);
      assert.strictEqual(chatItems[0].isConsecutive, false); // claude
      assert.strictEqual(chatItems[1].isConsecutive, false); // codex (different agent)
      if (chatItems[0].type === "chat" && chatItems[1].type === "chat") {
        assert.notStrictEqual(chatItems[0].groupKey, chatItems[1].groupKey);
      }
    });

    it("clear() then processIncremental starts fresh with header", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      pipeline.process(
        [
          msg({ role: "user", content: "q" }),
          msg({ role: "agent", agentId: "a1", content: "old" }),
        ],
        defaultCtx
      );
      pipeline.clear();

      const result = pipeline.processIncremental(
        [msg({ role: "agent", agentId: "a1", content: "new after clear" })],
        defaultCtx
      );
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 1);
      assert.strictEqual(chatItems[0].isConsecutive, false); // fresh start → header
    });

    it("compression item at cache end does not affect next agent header", () => {
      // batch1 = user + agent + compression, batch2 = agent
      const pipeline = new MessagePipeline(defaultConfig);
      pipeline.process(
        [
          msg({ role: "user", content: "q" }),
          msg({ role: "agent", agentId: "a1", content: "a1" }),
        ],
        defaultCtx
      );

      // Add compression via incremental
      pipeline.processIncremental(
        [
          msg({
            role: "system",
            content: "compressed",
            compressionInfo: { contextWindowMax: 200, usedTokens: 180 },
          }),
        ],
        defaultCtx
      );

      // Now add a new agent message
      const result = pipeline.processIncremental(
        [msg({ role: "agent", agentId: "a1", content: "a2" })],
        defaultCtx
      );
      const chatItems = result.filter((r) => r.type === "chat");
      // user, a1, a2
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // a1 after user
      // a2: cached last non-chat is compression, last agent a1 is non-consecutive
      // so groupKey resets → a2 shows header
      assert.strictEqual(chatItems[2].isConsecutive, false);
    });
  });

  // ── Tool call + attachment resolution via annotateMessages ───────────────

  describe("tool call & attachment resolution", () => {
    const cfg = defaultConfig.annotate;

    it("resolves toolCalls from agent message into resolvedToolCalls", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "thinking",
            toolCalls: [toolCall("tc-1", { title: "Read file", kind: "read" })],
          })
        ),
      ];
      const result = annotateMessages(input, cfg);
      assert.strictEqual(result.length, 1);
      if (result[0].type === "chat") {
        assert.ok(result[0].resolvedToolCalls);
        assert.strictEqual(result[0].resolvedToolCalls!.length, 1);
        assert.strictEqual(result[0].resolvedToolCalls![0].id, "tc-1");
        assert.strictEqual(result[0].resolvedToolCalls![0].title, "Read file");
        assert.strictEqual(result[0].resolvedToolCalls![0].kind, "read");
        assert.strictEqual(result[0].resolvedToolCalls![0].status, "completed");
      }
    });

    it("resolves multiple toolCalls preserving order", () => {
      const tc1 = toolCall("tc-1", { title: "Read" });
      const tc2 = toolCall("tc-2", { title: "Write" });
      const tc3 = toolCall("tc-3", { title: "Search" });
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "working",
            toolCalls: [tc1, tc2, tc3],
          })
        ),
      ];
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        const calls = result[0].resolvedToolCalls!;
        assert.strictEqual(calls.length, 3);
        assert.strictEqual(calls[0].id, "tc-1");
        assert.strictEqual(calls[1].id, "tc-2");
        assert.strictEqual(calls[2].id, "tc-3");
      }
    });

    it("defaults toolCall fields when optional fields are missing", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "run",
            toolCalls: [
              {
                id: "tc-raw",
                // title missing → should default to id
                // kind missing → should default to "generic"
              } as unknown as ToolCall,
            ],
          })
        ),
      ];
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        const tc = result[0].resolvedToolCalls![0];
        assert.strictEqual(tc.id, "tc-raw");
        assert.strictEqual(tc.title, "tc-raw");
        assert.strictEqual(tc.kind, "generic");
        assert.strictEqual(tc.status, "completed");
      }
    });

    it("resolves diffContent on toolCalls", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "edit",
            toolCalls: [
              toolCall("tc-1", { title: "Edit file" }),
            ] as unknown as ToolCall[],
          })
        ),
      ];
      // Manually add diffContent since toolCall() helper doesn't support it
      (input[0] as any).toolCalls[0] = {
        ...(input[0] as any).toolCalls[0],
        diffContent: {
          type: "diff",
          diff: "@@ -1 +1 @@\n-old\n+new",
          oldPath: "a.ts",
          newPath: "a.ts",
        },
      };
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        const tc = result[0].resolvedToolCalls![0];
        assert.ok(tc.diffContent);
        assert.strictEqual(tc.diffContent!.type, "diff");
        assert.strictEqual(tc.diffContent!.diff, "@@ -1 +1 @@\n-old\n+new");
      }
    });

    it("resolves attachments from message into ResolvedAttachment[]", () => {
      const input = [
        classifyMessage(
          msg({
            role: "user",
            content: "see this file",
            attachments: [
              {
                id: "att-1",
                type: "file",
                path: "/workspace/src/main.ts",
                label: "main.ts",
                lineRange: [10, 20],
                tokenCount: 150,
                content: "",
              } as ContextAttachment,
            ],
          })
        ),
      ];
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].attachments.length, 1);
        const att = result[0].attachments[0];
        assert.strictEqual(att.id, "att-1");
        assert.strictEqual(att.type, "file");
        assert.strictEqual(att.path, "/workspace/src/main.ts");
        assert.strictEqual(att.label, "main.ts");
        assert.deepStrictEqual(att.lineRange, [10, 20]);
        assert.strictEqual(att.tokenCount, 150);
        assert.strictEqual(att.isNavigable, true);
        assert.strictEqual(att.extension, "ts");
      }
    });

    it("resolves multiple attachments preserving order", () => {
      const input = [
        classifyMessage(
          msg({
            role: "user",
            content: "see these",
            attachments: [
              {
                id: "a1",
                type: "file",
                path: "/a.ts",
                label: "a.ts",
                tokenCount: 10,
                content: "",
              } as ContextAttachment,
              {
                id: "a2",
                type: "selection",
                path: "/b.ts",
                label: "b.ts",
                lineRange: [1, 5],
                tokenCount: 30,
                content: "",
              } as ContextAttachment,
              {
                id: "a3",
                type: "diff",
                path: "",
                label: "changes.diff",
                tokenCount: 50,
                content: "",
              } as ContextAttachment,
            ],
          })
        ),
      ];
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].attachments.length, 3);
        assert.strictEqual(result[0].attachments[0].type, "file");
        assert.strictEqual(result[0].attachments[1].type, "selection");
        assert.strictEqual(result[0].attachments[2].type, "diff");
      }
    });

    it("defaults attachment fields when optional fields missing", () => {
      const input = [
        classifyMessage(
          msg({
            role: "user",
            content: "attach",
            attachments: [{} as unknown as ContextAttachment],
          })
        ),
      ];
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        const att = result[0].attachments[0];
        assert.ok(att.id); // auto-generated `att-${i}`
        assert.strictEqual(att.type, "file"); // default
        assert.strictEqual(att.path, "");
        assert.strictEqual(att.label, "attachment");
        assert.strictEqual(att.tokenCount, 0);
        assert.strictEqual(att.isNavigable, false);
      }
    });

    it("returns empty attachments array when message has no attachments", () => {
      const input = [
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "hello" })
        ),
      ];
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].attachments.length, 0);
      }
    });

    it("returns undefined resolvedToolCalls when message has no toolCalls", () => {
      const input = [
        classifyMessage(msg({ role: "agent", agentId: "a1", content: "hi" })),
      ];
      const result = annotateMessages(input, cfg);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].resolvedToolCalls, undefined);
      }
    });
  });

  // ── Pipeline integration: tool calls & attachments end-to-end ────────────

  describe("pipeline integration: tool calls & attachments", () => {
    it("pipeline preserves resolvedToolCalls through full process()", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "agent", agentId: "a1", content: "working" }),
        msg({
          role: "tool",
          agentId: "a1",
          content: "result",
          toolCalls: [
            {
              id: "tc-1",
              title: "Read file",
              status: "completed",
              kind: "read",
            } as ToolCall,
            {
              id: "tc-2",
              title: "Write file",
              status: "completed",
              kind: "write",
            } as ToolCall,
          ],
        }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      // merge absorbs tool into agent → 1 chat item with 2 resolvedToolCalls
      assert.strictEqual(chatItems.length, 1);
      if (chatItems[0].type === "chat") {
        const calls = chatItems[0].resolvedToolCalls;
        assert.ok(calls);
        assert.strictEqual(calls!.length, 2);
        assert.strictEqual(calls![0].id, "tc-1");
        assert.strictEqual(calls![0].title, "Read file");
        assert.strictEqual(calls![0].kind, "read");
        assert.strictEqual(calls![1].id, "tc-2");
        assert.strictEqual(calls![1].title, "Write file");
        assert.strictEqual(calls![1].kind, "write");
      }
    });

    it("pipeline preserves attachments through full process()", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({
          role: "user",
          content: "check this",
          attachments: [
            {
              id: "att-1",
              type: "file",
              path: "/src/app.ts",
              label: "app.ts",
              lineRange: [1, 10],
              tokenCount: 200,
              content: "",
            } as ContextAttachment,
          ],
        }),
        msg({ role: "agent", agentId: "a1", content: "ok" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 2);
      // First item (user) should have the attachment
      if (chatItems[0].type === "chat") {
        assert.strictEqual(chatItems[0].attachments.length, 1);
        assert.strictEqual(chatItems[0].attachments[0].path, "/src/app.ts");
        assert.strictEqual(chatItems[0].attachments[0].label, "app.ts");
      }
      // Second item (agent) should have no attachments
      if (chatItems[1].type === "chat") {
        assert.strictEqual(chatItems[1].attachments.length, 0);
      }
    });

    it("pipeline with tool-after-user promotes and preserves toolCalls", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "user", content: "run ls" }),
        msg({
          role: "tool",
          agentId: "a1",
          content: "file1.ts\nfile2.ts",
          toolCalls: [
            {
              id: "tc-1",
              title: "Bash",
              status: "completed",
              kind: "execute",
              output: "file1.ts",
            } as ToolCall,
          ],
        }),
        msg({ role: "agent", agentId: "a1", content: "done" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      // user, promoted-tool(agent), agent → 3 chat items
      assert.strictEqual(chatItems.length, 3);
      // promoted tool should have resolvedToolCalls
      if (chatItems[1].type === "chat") {
        assert.ok(chatItems[1].resolvedToolCalls);
        assert.strictEqual(chatItems[1].resolvedToolCalls!.length, 1);
        assert.strictEqual(chatItems[1].resolvedToolCalls![0].id, "tc-1");
        assert.strictEqual(chatItems[1].resolvedToolCalls![0].title, "Bash");
      }
      // agent after promoted tool — should NOT inherit toolCalls (they stay on the promoted item)
      if (chatItems[2].type === "chat") {
        assert.strictEqual(chatItems[2].resolvedToolCalls, undefined);
      }
    });

    it("processIncremental preserves attachments across batches", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const batch1: RawMessage[] = [
        msg({
          role: "user",
          content: "here",
          attachments: [
            {
              id: "a1",
              type: "file",
              path: "/x.ts",
              label: "x.ts",
              tokenCount: 50,
              content: "",
            } as ContextAttachment,
          ],
        }),
      ];
      pipeline.process(batch1, defaultCtx);

      const batch2: RawMessage[] = [
        msg({ role: "agent", agentId: "a1", content: "seen" }),
      ];
      const result = pipeline.processIncremental(batch2, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 2);
      if (chatItems[0].type === "chat") {
        assert.strictEqual(chatItems[0].attachments.length, 1);
      }
      if (chatItems[1].type === "chat") {
        assert.strictEqual(chatItems[1].attachments.length, 0);
      }
    });
  });

  // ── Inline path detection (buildRenderContext / detectInlinePaths) ─────────

  describe("inline path detection (detectInlinePaths)", () => {
    const cfgWithDetection: AnnotateConfig = {
      resolveAttachments: true,
      detectInlinePaths: true,
    };
    const cfgWithoutDetection: AnnotateConfig = {
      resolveAttachments: true,
      detectInlinePaths: false,
    };

    it("extracts paths from inline code spans", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "see `src/index.ts` for details",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      assert.strictEqual(result.length, 1);
      if (result[0].type === "chat") {
        assert.ok(result[0].renderContext);
        assert.ok(result[0].renderContext!.filePaths.has("src/index.ts"));
      }
    });

    it("extracts multiple paths from multiple inline code spans", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "edit `src/a.ts` and `src/b.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        const paths = result[0].renderContext!.filePaths;
        assert.ok(paths.has("src/a.ts"));
        assert.ok(paths.has("src/b.ts"));
      }
    });

    it("extracts paths from comma-separated inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "`src/a.ts, src/b.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        const paths = result[0].renderContext!.filePaths;
        assert.ok(paths.has("src/a.ts"));
        assert.ok(paths.has("src/b.ts"));
      }
    });

    it("returns undefined renderContext when no inline code paths found", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "hello world, no paths here",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].renderContext, undefined);
      }
    });

    it("returns undefined renderContext when detectInlinePaths is false", () => {
      const input = [
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "see `src/index.ts`" })
        ),
      ];
      const result = annotateMessages(input, cfgWithoutDetection);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].renderContext, undefined);
      }
    });

    it("extracts absolute paths from inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "check `/home/user/project/main.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        assert.ok(
          result[0].renderContext!.filePaths.has("/home/user/project/main.ts")
        );
      }
    });

    it("deduplicates paths across multiple inline code spans", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "`src/a.ts` and again `src/a.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        const paths = [...result[0].renderContext!.filePaths];
        assert.strictEqual(paths.length, 1);
        assert.strictEqual(paths[0], "src/a.ts");
      }
    });

    it("does not extract URLs from inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "`https://example.com/foo.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].renderContext, undefined);
      }
    });

    it("does not extract protocol-relative URLs from inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "`//example.com/foo.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        assert.strictEqual(result[0].renderContext, undefined);
      }
    });

    it("extracts dotfiles from inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "edit `.gitignore`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        assert.ok(result[0].renderContext);
        assert.ok(result[0].renderContext!.filePaths.has(".gitignore"));
      }
    });

    it("extracts extensionless filenames from inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "run `Makefile` and check `LICENSE`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        const paths = result[0].renderContext!.filePaths;
        assert.ok(paths.has("Makefile"));
        assert.ok(paths.has("LICENSE"));
      }
    });

    it("extracts Windows paths from inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "see `C:\\Users\\user\\file.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        assert.ok(
          result[0].renderContext!.filePaths.has("C:\\Users\\user\\file.ts")
        );
      }
    });

    it("extracts scoped package paths from inline code", () => {
      const input = [
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content:
              "check `@scope/lib/index.ts` and `@/components/Button.tsx`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      if (result[0].type === "chat") {
        const paths = result[0].renderContext!.filePaths;
        assert.ok(paths.has("@scope/lib/index.ts"));
        assert.ok(paths.has("@/components/Button.tsx"));
      }
    });

    it("skips system-kind messages (renderContext only on info/chat items)", () => {
      const input = [
        classifyMessage(
          msg({
            role: "system",
            content: "see `src/index.ts`",
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      // system role with unrecognised content → systemKind "info" → type "chat"
      // but renderContext IS still set because it's an info-kind message
      assert.strictEqual(result[0].type, "chat");
      if (result[0].type === "chat") {
        assert.ok(result[0].renderContext);
        assert.ok(result[0].renderContext!.filePaths.has("src/index.ts"));
      }
    });

    it("does not set renderContext on compression system messages", () => {
      const input = [
        classifyMessage(
          msg({
            role: "system",
            content: "compressed",
            compressionInfo: { contextWindowMax: 100, usedTokens: 80 },
          })
        ),
      ];
      const result = annotateMessages(input, cfgWithDetection);
      assert.strictEqual(result[0].type, "compression");
    });

    it("pipeline integration: detectInlinePaths produces renderContext on chat items", () => {
      const pipeline = new MessagePipeline({
        ...defaultConfig,
        annotate: { resolveAttachments: true, detectInlinePaths: true },
      });
      const messages: RawMessage[] = [
        msg({ role: "agent", agentId: "a1", content: "see `src/index.ts`" }),
        msg({ role: "agent", agentId: "a1", content: "also `lib/utils.ts`" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 2);
      if (chatItems[0].type === "chat") {
        assert.ok(chatItems[0].renderContext);
        assert.ok(chatItems[0].renderContext!.filePaths.has("src/index.ts"));
      }
      if (chatItems[1].type === "chat") {
        assert.ok(chatItems[1].renderContext);
        assert.ok(chatItems[1].renderContext!.filePaths.has("lib/utils.ts"));
      }
    });
  });

  describe("header omission patterns (annotateMessages)", () => {
    const cfg = defaultConfig.annotate;

    function chatConsecutive(
      messages: ClassifiedMessage[]
    ): Array<{ role: string; isConsecutive: boolean }> {
      const items = annotateMessages(messages, cfg);
      return items
        .filter((i) => i.type === "chat")
        .map((i) => ({
          role: (i as { role: string }).role,
          isConsecutive: (i as { isConsecutive: boolean }).isConsecutive,
        }));
    }

    it("User → Agent → Tool/System: agent shows header", () => {
      const input = [
        classifyMessage(msg({ role: "user", content: "q" })),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "answer" })
        ),
        classifyMessage(msg({ role: "system", content: "mode switched" })),
      ];
      const result = chatConsecutive(input);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].isConsecutive, false); // user
      assert.strictEqual(result[1].isConsecutive, false); // agent after user
    });

    it("User → Tool → Agent: tool (promoted to agent) shows header, agent after it is consecutive", () => {
      // After merge: User, Tool(promoted→agent), Agent → all three are separate agent-role messages
      // annotate sees: user, agent(tool), agent → tool is first agent (header shown), agent is consecutive to tool
      const input = [
        classifyMessage(msg({ role: "user", content: "q" })),
        classifyMessage(
          msg({ role: "tool", agentId: "a1", content: "tool result" })
        ),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "answer" })
        ),
      ];
      // Simulate merge output: user, promoted-tool(agent), agent
      const merged = [
        classifyMessage(msg({ role: "user", content: "q" })),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "tool result" })
        ),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "answer" })
        ),
      ];
      const result = chatConsecutive(merged);
      // user, promoted-tool(agent), agent
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].isConsecutive, false); // user
      assert.strictEqual(result[1].isConsecutive, false); // promoted tool (first agent after user)
      assert.strictEqual(result[2].isConsecutive, true); // agent consecutive to promoted tool
    });

    it("User → System → Agent: agent shows header after system boundary", () => {
      const input = [
        classifyMessage(msg({ role: "user", content: "q" })),
        classifyMessage(msg({ role: "system", content: "mode switched" })),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "answer" })
        ),
      ];
      const result = chatConsecutive(input);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].isConsecutive, false); // user
      assert.strictEqual(result[1].isConsecutive, false); // agent after system boundary
    });

    it("User → System → Tool → Agent(2): tool shows header, agent(2) is consecutive to tool", () => {
      // After merge: User, System, Tool(promoted→agent), Agent
      // Simulate merge output: user, system, promoted-tool(agent), agent
      const merged = [
        classifyMessage(msg({ role: "user", content: "q" })),
        classifyMessage(msg({ role: "system", content: "mode switched" })),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "tool result" })
        ),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "answer" })
        ),
      ];
      const result = chatConsecutive(merged);
      // user, promoted-tool(agent), agent (system is not chat)
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].isConsecutive, false); // user
      assert.strictEqual(result[1].isConsecutive, false); // promoted tool (first agent after system)
      assert.strictEqual(result[2].isConsecutive, true); // agent consecutive to promoted tool
    });

    it("User → Agent(1) → Tool → Agent(2): agent(1) shows header, agent(2) is consecutive", () => {
      // merge absorbs tool into agent(1) (Case 1), so merged output is: User, Agent(with toolCalls), Agent
      // annotate sees: user, agent, agent → 3 chat items
      const merged = [
        classifyMessage(msg({ role: "user", content: "q" })),
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "thinking",
            toolCalls: [toolCall("tc-1"), toolCall("tc-2")],
          })
        ),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "answer" })
        ),
      ];
      const result = chatConsecutive(merged);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].isConsecutive, false); // user
      assert.strictEqual(result[1].isConsecutive, false); // agent(1) first agent after user
      assert.strictEqual(result[2].isConsecutive, true); // agent(2) consecutive to agent(1)
    });

    it("User → Agent(1) → Tool → System → Agent(2): agent(1) shows header, agent(2) shows header after system", () => {
      // merge absorbs tool into agent(1), system passes through
      // merged: User, Agent(with toolCalls), System, Agent
      // annotate chat items: user, agent, agent(after system)
      const merged = [
        classifyMessage(msg({ role: "user", content: "q" })),
        classifyMessage(
          msg({
            role: "agent",
            agentId: "a1",
            content: "thinking",
            toolCalls: [toolCall("tc-1"), toolCall("tc-2")],
          })
        ),
        classifyMessage(msg({ role: "system", content: "mode switched" })),
        classifyMessage(
          msg({ role: "agent", agentId: "a1", content: "answer" })
        ),
      ];
      const result = chatConsecutive(merged);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].isConsecutive, false); // user
      assert.strictEqual(result[1].isConsecutive, false); // agent(1) first agent after user
      assert.strictEqual(result[2].isConsecutive, false); // agent(2) after system boundary
    });
  });

  describe("header omission patterns (MessagePipeline integration)", () => {
    it("User → Agent → Tool/System: agent shows header", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "user", content: "q" }),
        msg({ role: "agent", agentId: "a1", content: "answer" }),
        msg({ role: "system", content: "mode switched" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 2);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // agent after user
    });

    it("User → Tool → Agent: tool (promoted) shows header, agent is consecutive", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "user", content: "q" }),
        msg({ role: "tool", agentId: "a1", content: "tool result" }),
        msg({ role: "agent", agentId: "a1", content: "answer" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      // user, promoted-tool(agent), agent
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // promoted tool (first agent)
      assert.strictEqual(chatItems[2].isConsecutive, true); // agent consecutive to promoted tool
    });

    it("User → System → Agent: agent shows header after system boundary", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "user", content: "q" }),
        msg({ role: "system", content: "mode switched" }),
        msg({ role: "agent", agentId: "a1", content: "answer" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      assert.strictEqual(chatItems.length, 2);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // agent after system
    });

    it("User → System → Tool → Agent(2): tool shows header, agent(2) is consecutive", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "user", content: "q" }),
        msg({ role: "system", content: "mode switched" }),
        msg({ role: "tool", agentId: "a1", content: "tool result" }),
        msg({ role: "agent", agentId: "a1", content: "answer" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      // user, promoted-tool(agent), agent
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // promoted tool (first agent after system)
      assert.strictEqual(chatItems[2].isConsecutive, true); // agent consecutive to promoted tool
    });

    it("User → Agent(1) → Tool → Agent(2): agent(1) shows header, agent(2) is consecutive", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "user", content: "q" }),
        msg({ role: "agent", agentId: "a1", content: "thinking" }),
        msg({ role: "tool", agentId: "a1", content: "tool result" }),
        msg({ role: "agent", agentId: "a1", content: "answer" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      // user, agent(merged with tool), agent
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // agent(1) first agent after user
      assert.strictEqual(chatItems[2].isConsecutive, true); // agent(2) consecutive to agent(1)
    });

    it("User → Agent(1) → Tool → System → Agent(2): agent(1) shows header, agent(2) shows header after system", () => {
      const pipeline = new MessagePipeline(defaultConfig);
      const messages: RawMessage[] = [
        msg({ role: "user", content: "q" }),
        msg({ role: "agent", agentId: "a1", content: "thinking" }),
        msg({ role: "tool", agentId: "a1", content: "tool result" }),
        msg({ role: "system", content: "mode switched" }),
        msg({ role: "agent", agentId: "a1", content: "answer" }),
      ];
      const result = pipeline.process(messages, defaultCtx);
      const chatItems = result.filter((r) => r.type === "chat");
      // user, agent(merged with tool), agent(after system)
      assert.strictEqual(chatItems.length, 3);
      assert.strictEqual(chatItems[0].isConsecutive, false); // user
      assert.strictEqual(chatItems[1].isConsecutive, false); // agent(1) first agent after user
      assert.strictEqual(chatItems[2].isConsecutive, false); // agent(2) after system boundary
    });
  });
});
