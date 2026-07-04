import * as assert from "assert";
import { describe, it } from "mocha";
import type {
  PipelineItem,
  ChatDisplayItem,
  ResolvedToolCall,
} from "../../../pipeline/types";

function resolvedTC(
  overrides: Partial<ResolvedToolCall> & { id: string; kind: string }
): ResolvedToolCall {
  return {
    title: overrides.title ?? `tool-${overrides.id}`,
    status: "completed",
    input: undefined,
    output: undefined,
    durationMs: undefined,
    locations: undefined,
    diffContent: undefined,
    ...overrides,
  };
}

// ── Pure functions from IntermediateStepsBanner ─────────────────────────────

function itemLabel(item: PipelineItem): string {
  switch (item.type) {
    case "chat": {
      if (item.thinking) return "Thinking";
      if (item.resolvedToolCalls && item.resolvedToolCalls.length > 0) {
        const kinds = new Set(item.resolvedToolCalls.map((tc) => tc.kind));
        return `${kinds.size > 1 ? "Tool calls" : (kinds.values().next().value ?? "Tool")} ×${item.resolvedToolCalls.length}`;
      }
      return "Message";
    }
    case "compression":
      return "Context compressed";
    case "mode_change":
      return "Mode changed";
    case "error_notice":
      return "Error";
    case "custom":
      return "System";
  }
}

function buildSummary(items: PipelineItem[]): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const label = itemLabel(item);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => `${count > 1 ? `${count}× ` : ""}${label}`)
    .join(", ");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function chatItem(overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    type: "chat",
    role: "agent",
    agentId: "a1",
    content: "",
    key: `key-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    isFirstOfTurn: false,
    attachments: [],
    thinking: undefined,
    ...overrides,
  };
}

// ── itemLabel ───────────────────────────────────────────────────────────────

describe("itemLabel", () => {
  it("returns 'Thinking' for chat with thinking", () => {
    const item = chatItem({
      thinking: { content: "let me think", isStreaming: false },
    });
    assert.strictEqual(itemLabel(item), "Thinking");
  });

  it("returns single tool label for one tool call", () => {
    const item = chatItem({
      resolvedToolCalls: [
        resolvedTC({ id: "tc-1", title: "Read", kind: "read" }),
      ],
    });
    assert.strictEqual(itemLabel(item), "Read ×1");
  });

  it("returns 'Tool calls' for multiple tool calls of different kinds", () => {
    const item = chatItem({
      resolvedToolCalls: [
        resolvedTC({ id: "tc-1", title: "Read", kind: "read" }),
        resolvedTC({ id: "tc-2", title: "Write", kind: "write" }),
      ],
    });
    assert.strictEqual(itemLabel(item), "Tool calls ×2");
  });

  it("returns single kind for multiple tool calls of same kind", () => {
    const item = chatItem({
      resolvedToolCalls: [
        resolvedTC({ id: "tc-1", title: "Read a", kind: "read" }),
        resolvedTC({ id: "tc-2", title: "Read b", kind: "read" }),
      ],
    });
    assert.strictEqual(itemLabel(item), "Read ×2");
  });

  it("returns 'Message' for chat without thinking or tool calls", () => {
    const item = chatItem({ content: "hello" });
    assert.strictEqual(itemLabel(item), "Message");
  });

  it("returns 'Message' for chat with empty resolvedToolCalls", () => {
    const item = chatItem({ resolvedToolCalls: [] });
    assert.strictEqual(itemLabel(item), "Message");
  });

  it("returns 'Context compressed' for compression items", () => {
    const item: PipelineItem = {
      type: "compression",
      info: { contextWindowMax: 1000, usedTokens: 800 },
      key: "comp-1",
      timestamp: Date.now(),
    };
    assert.strictEqual(itemLabel(item), "Context compressed");
  });

  it("returns 'Mode changed' for mode_change items", () => {
    const item: PipelineItem = {
      type: "mode_change",
      content: "switched to plan",
      key: "mode-1",
      timestamp: Date.now(),
    };
    assert.strictEqual(itemLabel(item), "Mode changed");
  });

  it("returns 'Error' for error_notice items", () => {
    const item: PipelineItem = {
      type: "error_notice",
      content: "something failed",
      key: "err-1",
      timestamp: Date.now(),
    };
    assert.strictEqual(itemLabel(item), "Error");
  });

  it("returns 'System' for custom items", () => {
    const item: PipelineItem = {
      type: "custom",
      content: "[notice]",
      key: "custom-1",
      timestamp: Date.now(),
    };
    assert.strictEqual(itemLabel(item), "System");
  });
});

// ── buildSummary ────────────────────────────────────────────────────────────

describe("buildSummary", () => {
  it("returns empty string for empty input", () => {
    assert.strictEqual(buildSummary([]), "");
  });

  it("returns single label for one item", () => {
    const items: PipelineItem[] = [chatItem({ content: "hello" })];
    assert.strictEqual(buildSummary(items), "Message");
  });

  it("counts duplicate labels", () => {
    const items: PipelineItem[] = [
      chatItem({ content: "a" }),
      chatItem({ content: "b" }),
    ];
    assert.strictEqual(buildSummary(items), "2× Message");
  });

  it("joins different labels with comma", () => {
    const items: PipelineItem[] = [
      chatItem({ content: "hello" }),
      {
        type: "compression",
        info: { contextWindowMax: 1000, usedTokens: 800 },
        key: "comp-1",
        timestamp: Date.now(),
      },
    ];
    assert.strictEqual(buildSummary(items), "Message, Context compressed");
  });

  it("counts mixed labels correctly", () => {
    const items: PipelineItem[] = [
      chatItem({ content: "a" }),
      chatItem({ content: "b" }),
      {
        type: "compression",
        info: { contextWindowMax: 1000, usedTokens: 800 },
        key: "comp-1",
        timestamp: Date.now(),
      },
      {
        type: "mode_change",
        content: "switched",
        key: "mode-1",
        timestamp: Date.now(),
      },
      {
        type: "mode_change",
        content: "switched again",
        key: "mode-2",
        timestamp: Date.now(),
      },
    ];
    assert.strictEqual(
      buildSummary(items),
      "2× Message, Context compressed, 2× Mode changed"
    );
  });

  it("handles tool call items in summary", () => {
    const items: PipelineItem[] = [
      chatItem({
        resolvedToolCalls: [
          resolvedTC({ id: "tc-1", title: "Read", kind: "read" }),
        ],
      }),
      chatItem({
        resolvedToolCalls: [
          resolvedTC({ id: "tc-2", title: "Write", kind: "write" }),
        ],
      }),
    ];
    assert.strictEqual(buildSummary(items), "Read, Write");
  });

  it("groups same tool kinds in summary", () => {
    const items: PipelineItem[] = [
      chatItem({
        resolvedToolCalls: [
          resolvedTC({ id: "tc-1", title: "Read a", kind: "read" }),
        ],
      }),
      chatItem({
        resolvedToolCalls: [
          resolvedTC({ id: "tc-2", title: "Read b", kind: "read" }),
        ],
      }),
    ];
    assert.strictEqual(buildSummary(items), "2× Read");
  });

  it("handles all system item types", () => {
    const items: PipelineItem[] = [
      {
        type: "compression",
        info: { contextWindowMax: 1000, usedTokens: 800 },
        key: "comp-1",
        timestamp: Date.now(),
      },
      {
        type: "mode_change",
        content: "switched",
        key: "mode-1",
        timestamp: Date.now(),
      },
      {
        type: "error_notice",
        content: "failed",
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
    assert.strictEqual(
      buildSummary(items),
      "Context compressed, Mode changed, Error, System"
    );
  });

  it("handles thinking items in summary", () => {
    const items: PipelineItem[] = [
      chatItem({
        thinking: { content: "thinking...", isStreaming: false },
      }),
      chatItem({
        thinking: { content: "still thinking...", isStreaming: false },
      }),
    ];
    assert.strictEqual(buildSummary(items), "2× Thinking");
  });

  it("handles mixed tool calls and thinking in summary", () => {
    const items: PipelineItem[] = [
      chatItem({
        thinking: { content: "thinking...", isStreaming: false },
      }),
      chatItem({
        resolvedToolCalls: [
          resolvedTC({ id: "tc-1", title: "Read", kind: "read" }),
        ],
      }),
    ];
    assert.strictEqual(buildSummary(items), "Thinking, Read");
  });
});

// ── ThinkingBlock getDisplayContent trailing newline logic ───────────────────

function getDisplayContent(content: string): string {
  return content.endsWith("\n") ? content : content + "\n";
}

describe("ThinkingBlock getDisplayContent", () => {
  it("adds trailing newline when content does not end with one", () => {
    assert.strictEqual(getDisplayContent("hello"), "hello\n");
  });

  it("preserves existing trailing newline", () => {
    assert.strictEqual(getDisplayContent("hello\n"), "hello\n");
  });

  it("preserves multiple trailing newlines", () => {
    assert.strictEqual(getDisplayContent("hello\n\n"), "hello\n\n");
  });

  it("handles empty content by adding newline", () => {
    assert.strictEqual(getDisplayContent(""), "\n");
  });

  it("handles whitespace-only content", () => {
    assert.strictEqual(getDisplayContent("   "), "   \n");
  });
});
