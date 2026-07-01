/**
 * Integration tests: messageStore → pipeline → grouping → SessionChatContainer rendering pipeline.
 *
 * These tests verify the end-to-end flow from raw message arrival through
 * pipeline processing to the final grouping structure that SessionChatContainer
 * consumes. They guard against structural regressions in:
 *
 *   - Turn detection (user message boundaries)
 *   - Step splitting (agent message + tool calls → IntermediateStep)
 *   - Intermediate step grouping (older steps vs current step)
 *   - Final response selection (stopReason, isFirstOfTurn)
 *   - File edit summary attribution (writeSeq partitioning)
 *   - Streaming chunk accumulation (messageId-based merge)
 *   - Tool batch summary (tool calls after final response)
 */

import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useMessageStore } from "../../store/messageStore";
import { useFileWriteStore } from "../../store/fileWriteStore";
import { MessagePipeline } from "../../pipeline/pipeline";
import {
  IntermediateStepGrouper,
  selectFinalResponse,
  splitIntoSteps,
  splitLatestSteps,
  groupByUserBoundary,
  buildSummaryFromWrites,
  lowerBound,
} from "../../pipeline/stages/grouping";
import type {
  RawMessage,
  PipelineConfig,
  PipelineContext,
  PipelineItem,
  ChatDisplayItem,
  IntermediateStep,
} from "../../pipeline/types";
import type { FileWriteRecord } from "../../store/fileWriteStore";

// ── Helpers ─────────────────────────────────────────────────────────────────

let _msgCounter = 0;
function msg(
  overrides: Partial<RawMessage> & { role: RawMessage["role"] }
): RawMessage {
  _msgCounter++;
  return {
    id: `msg-${_msgCounter}-${Math.random().toString(36).slice(2, 6)}`,
    content: "",
    timestamp: 1700000000000 + _msgCounter,
    ...(overrides as Record<string, unknown>),
  } as RawMessage;
}

function resetCounters(): void {
  _msgCounter = 0;
}

const defaultConfig: PipelineConfig = {
  filter: {
    hideCompression: false,
    hideModeChange: false,
    hideErrorNotices: false,
  },
  annotate: { resolveAttachments: true, detectInlinePaths: false },
};

const defaultCtx: PipelineContext = {
  sessionId: "sess-1",
  agentId: "agent-1",
  sessionCwd: undefined,
  existingItems: [],
};

function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

function chatItem(
  role: "user" | "agent" | "system" | "tool",
  content: string,
  overrides: Partial<ChatDisplayItem> = {}
): ChatDisplayItem {
  return {
    type: "chat",
    role,
    content,
    key: `chat-${role}-${content.slice(0, 20)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    attachments: [],
    thinking: undefined,
    isFirstOfTurn: false,
    ...overrides,
  };
}

// ── 1. messageStore → pipeline → grouping フルフロー ─────────────────────────

describe("integration: messageStore → pipeline → grouping full flow", () => {
  beforeEach(() => {
    resetCounters();
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({
      writes: {},
      nextSeq: 0,
    });
  });

  it("single turn: user → agent → tool → agent(final) produces one group with correct steps", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // Simulate message arrival sequence
    store.appendMessage(
      key,
      msg({ role: "user", content: "analyze this file" })
    );
    store.appendMessage(
      key,
      msg({
        id: "m1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "Let me read the file...",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "file content here",
        toolCalls: [
          { id: "tc-1", title: "Read", status: "completed", kind: "read" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        id: "m2",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "The analysis shows...",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    assert.strictEqual(rawMessages.length, 4); // user + agent + tool + agent(final)

    // Process through pipeline
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);

    // Verify pipeline output structure
    const chatItems = items.filter((i) => i.type === "chat");
    assert.strictEqual(chatItems.length, 4);

    // Group by user boundary
    const grouped = new IntermediateStepGrouper(items).compute();
    assert.strictEqual(grouped.groups.length, 0); // Only one turn → no past groups
    assert.ok(grouped.latestGroup, "latestGroup should exist");
    assert.strictEqual(grouped.latestGroup!.steps.length, 1); // One intermediate step (agent+tool before final)
    assert.ok(grouped.latestGroup!.finalResponse, "finalResponse should exist");
  });

  it("two turns: produces one past group and one latest group", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // Turn 1
    store.appendMessage(key, msg({ role: "user", content: "first question" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "first answer",
        stopReason: "end_turn",
      })
    );

    // Turn 2
    store.appendMessage(key, msg({ role: "user", content: "second question" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "second answer",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.strictEqual(grouped.groups.length, 1, "one past group");
    assert.ok(grouped.latestGroup, "latestGroup exists");
    assert.strictEqual(grouped.groups[0].finalResponse?.item.type, "chat");
    assert.strictEqual(
      (grouped.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "first answer"
    );
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem).content,
      "second answer"
    );
  });

  it("agent message with tool calls followed by final agent: tool calls attributed to intermediate step", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "run analysis" }));
    store.appendMessage(
      key,
      msg({
        id: "m1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "running tools...",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "grep result",
        toolCalls: [
          { id: "tc-1", title: "Grep", status: "completed", kind: "search" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "read result",
        toolCalls: [
          { id: "tc-2", title: "Read", status: "completed", kind: "read" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "done",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    // The intermediate step should have the tool calls
    assert.ok(grouped.latestGroup);
    const steps = grouped.latestGroup!.steps;
    assert.ok(steps.length >= 1, "at least one intermediate step");

    // Find the step with tool calls
    const stepWithTools = steps.find((s) => s.toolCalls.length > 0);
    assert.ok(stepWithTools, "a step should have tool calls");
    assert.strictEqual(
      stepWithTools!.toolCalls.length,
      2,
      "two tool calls in the step"
    );
  });
});

// ── 2. ストリーミングチャンク → パイプライン → Step/IntermediateStep 変換 ─────

describe("integration: streaming chunks → pipeline → Step conversion", () => {
  beforeEach(() => {
    resetCounters();
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({
      writes: {},
      nextSeq: 0,
    });
  });

  it("streaming chunks with same messageId merge into single agent message", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // User message first
    store.appendMessage(
      key,
      msg({ role: "user", content: "explain recursion" })
    );

    // Streaming chunks with same messageId
    store.appendStreamChunk(key, "agent-1", "sess-1", "Recursion is", "m1");
    store.appendStreamChunk(key, "agent-1", "sess-1", " a function", "m1");
    store.appendStreamChunk(key, "agent-1", "sess-1", " that calls", "m1");
    store.appendStreamChunk(key, "agent-1", "sess-1", " itself.", "m1");

    const rawMessages = useMessageStore.getState().perSession[key];
    // Should be 2 messages: user + 1 merged agent message
    assert.strictEqual(
      rawMessages.length,
      2,
      "chunks merge into single message"
    );
    assert.strictEqual(
      rawMessages[1].content,
      "Recursion is a function that calls itself."
    );
  });

  it("streaming chunks interrupted by tool call: same messageId merges back correctly", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "analyze code" }));

    // First chunk of agent message
    store.appendStreamChunk(key, "agent-1", "sess-1", "Let me read ", "m1");

    // Tool call arrives (separate message)
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "file content...",
        toolCalls: [
          { id: "tc-1", title: "Read", status: "completed", kind: "read" },
        ],
      })
    );

    // More chunks with same messageId m1 → should merge into the first agent message
    store.appendStreamChunk(key, "agent-1", "sess-1", "the file.", "m1");
    store.appendStreamChunk(
      key,
      "agent-1",
      "sess-1",
      " The analysis shows...",
      "m1"
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    // user + agent(m1 merged) + tool = 3 messages
    assert.strictEqual(
      rawMessages.length,
      3,
      "same messageId merges across tool boundary"
    );

    // The agent message should have all chunks merged
    const agentMsg = rawMessages.find((m) => m.role === "agent");
    assert.ok(agentMsg);
    assert.strictEqual(
      agentMsg!.content,
      "Let me read the file. The analysis shows..."
    );
  });

  it("streaming with stopReason stamp via updateLastAgentMessage", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "hello" }));
    store.appendStreamChunk(key, "agent-1", "sess-1", "Hi there!", "m1");

    // Turn ends — stamp stopReason
    store.updateLastAgentMessage(key, { stopReason: "end_turn" });

    const rawMessages = useMessageStore.getState().perSession[key];
    const agentMsg = rawMessages.find((m) => m.role === "agent");
    assert.ok(agentMsg);
    assert.strictEqual(agentMsg!.stopReason, "end_turn");

    // Process through pipeline — stopReason should be on the ChatDisplayItem
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const agentItem = items.find(
      (i) => i.type === "chat" && (i as ChatDisplayItem).role === "agent"
    ) as ChatDisplayItem;
    assert.strictEqual(agentItem.stopReason, "end_turn");

    // selectFinalResponse should pick it
    const agentChats = items.filter(
      (i) =>
        i.type === "chat" &&
        ((i as ChatDisplayItem).role === "agent" ||
          (i as ChatDisplayItem).role === "tool")
    ) as ChatDisplayItem[];
    const final = selectFinalResponse(agentChats);
    assert.ok(final);
    assert.strictEqual(final!.item.key, agentItem.key);
  });

  it("multiple streaming batches via appendStreamChunks", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(
      key,
      msg({ role: "user", content: "long explanation" })
    );
    store.appendStreamChunks(
      key,
      "agent-1",
      "sess-1",
      ["This ", "is ", "a "],
      "m1"
    );
    store.appendStreamChunks(
      key,
      "agent-1",
      "sess-1",
      ["long ", "explanation."],
      "m1"
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    assert.strictEqual(rawMessages.length, 2);
    assert.strictEqual(rawMessages[1].content, "This is a long explanation.");
  });
});

// ── 3. fileWriteStore → fileEditSummary → Step 割り当て ──────────────────────

describe("integration: fileWriteStore → fileEditSummary → Step attribution", () => {
  beforeEach(() => {
    resetCounters();
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({
      writes: {},
      nextSeq: 0,
    });
  });

  it("file writes are attributed to steps based on writeSeq", () => {
    const agentId = "agent-1";
    const sessionId = "sess-1";
    const key = sessionKey(agentId, sessionId);
    const store = useMessageStore.getState();

    // Turn: user → agent(writeSeq=0) → tool → agent(writeSeq=1, final)
    // File write happens between the two agent messages
    store.appendMessage(
      key,
      msg({ role: "user", content: "edit file", writeSeq: 0 })
    );
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId,
        sessionId,
        content: "editing...",
        writeSeq: 0,
      })
    );

    // File write arrives
    useFileWriteStore
      .getState()
      .addWrite(
        agentId,
        sessionId,
        "/src/foo.ts",
        "new content",
        "old content"
      );

    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId,
        sessionId,
        content: "done",
        stopReason: "end_turn",
        writeSeq: 1,
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    // The file write should be attributed to the step
    assert.ok(grouped.latestGroup);
    // Verify file write store has the write
    const writes = useFileWriteStore
      .getState()
      .getWritesForSession(agentId, sessionId);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].path, "/src/foo.ts");
  });

  it("buildSummaryFromWrites merges multiple writes to same path", () => {
    const writes: FileWriteRecord[] = [
      {
        path: "/a.ts",
        content: "v2",
        originalContent: "v1",
        seq: 0,
        contentHash: "h2",
      },
      {
        path: "/a.ts",
        content: "v3",
        originalContent: "v1",
        seq: 1,
        contentHash: "h3",
      },
      {
        path: "/b.ts",
        content: "new",
        originalContent: null,
        seq: 2,
        contentHash: "hb",
      },
    ];

    const summary = buildSummaryFromWrites(writes);
    assert.ok(summary);
    assert.strictEqual(summary!.length, 2); // a.ts (merged) + b.ts

    const aEntry = summary!.find((s) => s.path === "/a.ts");
    assert.ok(aEntry);
    assert.strictEqual(aEntry!.writtenContent, "v3"); // latest wins
    assert.strictEqual(aEntry!.originalContent, "v1"); // oldest original

    const bEntry = summary!.find((s) => s.path === "/b.ts");
    assert.ok(bEntry);
    assert.strictEqual(bEntry!.writtenContent, "new");
  });

  it("lowerBound finds correct insertion point", () => {
    const writes: FileWriteRecord[] = [
      {
        path: "/a.ts",
        content: "",
        originalContent: null,
        seq: 0,
        contentHash: "",
      },
      {
        path: "/b.ts",
        content: "",
        originalContent: null,
        seq: 5,
        contentHash: "",
      },
      {
        path: "/c.ts",
        content: "",
        originalContent: null,
        seq: 10,
        contentHash: "",
      },
      {
        path: "/d.ts",
        content: "",
        originalContent: null,
        seq: 15,
        contentHash: "",
      },
    ];

    assert.strictEqual(lowerBound(writes, 0), 0);
    assert.strictEqual(lowerBound(writes, 3), 1); // first seq >= 3 is at index 1 (seq=5)
    assert.strictEqual(lowerBound(writes, 5), 1);
    assert.strictEqual(lowerBound(writes, 10), 2);
    assert.strictEqual(lowerBound(writes, 100), 4); // past end
  });

  it("writeSeq boundaries partition writes correctly across steps", () => {
    const agentId = "agent-1";
    const sessionId = "sess-1";
    const key = sessionKey(agentId, sessionId);
    const store = useMessageStore.getState();

    // Simulate: agent1(writeSeq=0) → file write(seq=0) → agent2(writeSeq=1) → file write(seq=1)
    store.appendMessage(key, msg({ role: "user", content: "edit two files" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId,
        sessionId,
        content: "first edit",
        writeSeq: 0,
      })
    );

    useFileWriteStore
      .getState()
      .addWrite(agentId, sessionId, "/file1.ts", "content1", "old1");

    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId,
        sessionId,
        content: "second edit",
        writeSeq: 1,
      })
    );

    useFileWriteStore
      .getState()
      .addWrite(agentId, sessionId, "/file2.ts", "content2", "old2");

    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId,
        sessionId,
        content: "done",
        stopReason: "end_turn",
        writeSeq: 2,
      })
    );

    const writes = useFileWriteStore
      .getState()
      .getWritesForSession(agentId, sessionId);
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes[0].seq, 0);
    assert.strictEqual(writes[1].seq, 1);
  });
});

// ── 4. マルチターン（Turn）→ AgentResponseGroup 分割 ─────────────────────────

describe("integration: multi-turn → AgentResponseGroup splitting", () => {
  beforeEach(() => {
    resetCounters();
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({
      writes: {},
      nextSeq: 0,
    });
  });

  it("three turns produce two past groups and one latest group", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // Turn 1
    store.appendMessage(key, msg({ role: "user", content: "q1" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a1",
        stopReason: "end_turn",
      })
    );

    // Turn 2
    store.appendMessage(key, msg({ role: "user", content: "q2" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a2",
        stopReason: "end_turn",
      })
    );

    // Turn 3 (in progress)
    store.appendMessage(key, msg({ role: "user", content: "q3" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a3",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.strictEqual(grouped.groups.length, 2, "two past groups");
    assert.ok(grouped.latestGroup, "latestGroup exists");

    // Past groups have final responses
    assert.strictEqual(
      (grouped.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    assert.strictEqual(
      (grouped.groups[1].finalResponse?.item as ChatDisplayItem).content,
      "a2"
    );

    // Latest group is in progress (no stopReason)
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem).content,
      "a3"
    );
  });

  it("turn with intermediate steps: steps go into banner, final response outside", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "complex task" }));

    // Intermediate step 1: agent + tool
    store.appendMessage(
      key,
      msg({
        id: "s1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "step 1 thinking",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "tool result 1",
        toolCalls: [
          { id: "tc-1", title: "Search", status: "completed", kind: "search" },
        ],
      })
    );

    // Intermediate step 2: agent + tool
    store.appendMessage(
      key,
      msg({
        id: "s2",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "step 2 thinking",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "tool result 2",
        toolCalls: [
          { id: "tc-2", title: "Read", status: "completed", kind: "read" },
        ],
      })
    );

    // Final response
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "final answer",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    // Two intermediate steps (step 1 and step 2)
    assert.strictEqual(
      grouped.latestGroup!.steps.length,
      2,
      "two intermediate steps"
    );

    // Final response exists
    assert.ok(grouped.latestGroup!.finalResponse);
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem).content,
      "final answer"
    );

    // splitLatestSteps: olderSteps go to banner, currentStep is null (has final)
    const { olderSteps, currentStep } = splitLatestSteps(
      grouped.latestGroup!.steps,
      grouped.latestGroup!.finalResponse != null,
      grouped.latestGroup!.currentStep
    );
    assert.strictEqual(
      olderSteps.length,
      2,
      "both intermediate steps in banner"
    );
    assert.strictEqual(
      currentStep,
      null,
      "no currentStep when final exists without post-final tools"
    );
  });

  it("turn with tool calls after final response: currentStep captures them", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(
      key,
      msg({ role: "user", content: "task with follow-up tools" })
    );

    // Intermediate step
    store.appendMessage(
      key,
      msg({
        id: "s1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "thinking",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "result",
        toolCalls: [
          { id: "tc-1", title: "Bash", status: "completed", kind: "bash" },
        ],
      })
    );

    // Final response (with stopReason)
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "answer",
        stopReason: "end_turn",
      })
    );

    // Tool calls AFTER final response (edge case — some agents do this)
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "cleanup result",
        toolCalls: [
          { id: "tc-2", title: "Cleanup", status: "completed", kind: "bash" },
        ],
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    // currentStep should capture the final response + post-final tool calls
    assert.ok(
      grouped.latestGroup!.currentStep,
      "currentStep exists for post-final tools"
    );
    assert.strictEqual(
      grouped.latestGroup!.currentStep!.toolCalls.length,
      1,
      "one post-final tool call"
    );
  });

  it("empty session (no user messages) produces leading items only", () => {
    const items: PipelineItem[] = [chatItem("agent", "system notice")];
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.strictEqual(grouped.leading.length, 1);
    assert.strictEqual(grouped.groups.length, 0);
    assert.strictEqual(grouped.latestGroup, null);
  });

  it("user message with no agent response yet: empty latestGroup", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(
      key,
      msg({ role: "user", content: "just sent, no reply yet" })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    assert.strictEqual(grouped.latestGroup!.steps.length, 0);
    assert.strictEqual(grouped.latestGroup!.finalResponse, null);
    assert.strictEqual(
      (grouped.latestGroup!.userItem as ChatDisplayItem).content,
      "just sent, no reply yet"
    );
  });
});

// ── 5. toolBatchSummary を含む完全なセッショナリオ ────────────────────────────

describe("integration: full session scenario with toolBatchSummary", () => {
  beforeEach(() => {
    resetCounters();
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({
      writes: {},
      nextSeq: 0,
    });
  });

  it("complete session: streaming → tools → file writes → final answer with stopReason", () => {
    const agentId = "agent-1";
    const sessionId = "sess-1";
    const key = sessionKey(agentId, sessionId);
    const store = useMessageStore.getState();

    // Build a complete session scenario using discrete messages (simulating
    // the post-merge state that the pipeline receives).
    // 1. User sends a message
    store.appendMessage(
      key,
      msg({ role: "user", content: "refactor the auth module", writeSeq: 0 })
    );

    // 2. Agent message (already merged from streaming chunks with m1)
    store.appendMessage(
      key,
      msg({
        id: "m1",
        role: "agent",
        agentId,
        sessionId,
        content: "I'll analyze the auth module. The code needs refactoring.",
        writeSeq: 0,
      })
    );

    // 3. Tool call result (Read file)
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId,
        sessionId,
        content: "export function authenticate() { ... }",
        toolCalls: [
          {
            id: "tc-read",
            title: "Read auth.ts",
            status: "completed",
            kind: "read",
            locations: [{ path: "/src/auth.ts", line: 1 }],
          },
        ],
      })
    );

    // 4. Another tool call (test)
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId,
        sessionId,
        content: "All 12 tests passed",
        toolCalls: [
          {
            id: "tc-test",
            title: "Run tests",
            status: "completed",
            kind: "bash",
            output: "All 12 tests passed",
          },
        ],
      })
    );

    // 5. File write happens
    useFileWriteStore
      .getState()
      .addWrite(
        agentId,
        sessionId,
        "/src/auth.ts",
        "refactored code",
        "export function authenticate() { ... }"
      );

    // 6. Final agent answer (separate messageId m2)
    store.appendMessage(
      key,
      msg({
        id: "m2",
        role: "agent",
        agentId,
        sessionId,
        content: "Refactoring complete.",
        stopReason: "end_turn",
        writeSeq: 1,
      })
    );

    // ── Verify the full pipeline output ──

    const rawMessages = useMessageStore.getState().perSession[key];

    // Process through pipeline
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);

    // Group
    const grouped = new IntermediateStepGrouper(items).compute();

    // Assertions
    assert.ok(grouped.latestGroup, "latestGroup exists");

    // The intermediate step should have the agent message + tool calls
    const intermediateStep = grouped.latestGroup!.steps[0];
    assert.ok(intermediateStep, "at least one intermediate step");
    assert.strictEqual(
      intermediateStep.agentMessage?.content,
      "I'll analyze the auth module. The code needs refactoring.",
      "intermediate step has merged m1 content"
    );
    assert.strictEqual(
      intermediateStep.toolCalls.length,
      2,
      "intermediate step has 2 tool calls (Read + Run tests)"
    );
    assert.strictEqual(intermediateStep.toolCalls[0].role, "tool");

    // Final response
    assert.ok(grouped.latestGroup!.finalResponse, "finalResponse exists");
    const finalContent = (
      grouped.latestGroup!.finalResponse?.item as ChatDisplayItem
    ).content;
    assert.ok(
      finalContent.includes("Refactoring"),
      "final response contains streamed content"
    );

    // File write attribution
    const writes = useFileWriteStore
      .getState()
      .getWritesForSession(agentId, sessionId);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].path, "/src/auth.ts");
  });

  it("session with compression notice between turns", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // Turn 1
    store.appendMessage(key, msg({ role: "user", content: "q1" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a1",
        stopReason: "end_turn",
      })
    );

    // Compression notice
    store.appendMessage(
      key,
      msg({
        role: "system",
        content: "compressed",
        compressionInfo: { contextWindowMax: 100000, usedTokens: 80000 },
      })
    );

    // Turn 2
    store.appendMessage(key, msg({ role: "user", content: "q2" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a2",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    // Compression should be in the first group's passthrough or leading
    assert.strictEqual(grouped.groups.length, 1, "one past group");

    // The compression notice should appear somewhere in the output
    const hasCompression = items.some((i) => i.type === "compression");
    assert.ok(hasCompression, "compression notice exists in pipeline output");
  });

  it("rapid streaming then tool then more streaming: messageId merge across boundaries", () => {
    const agentId = "agent-1";
    const sessionId = "sess-1";
    const key = sessionKey(agentId, sessionId);
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "quick task" }));

    // Rapid streaming
    for (let i = 0; i < 10; i++) {
      store.appendStreamChunk(key, agentId, sessionId, `chunk${i} `, "m1");
    }

    // Tool interrupts
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId,
        sessionId,
        content: "done",
        toolCalls: [
          { id: "tc-1", title: "Bash", status: "completed", kind: "bash" },
        ],
      })
    );

    // More streaming with same messageId
    store.appendStreamChunks(
      key,
      agentId,
      sessionId,
      ["final ", "words."],
      "m1"
    );

    store.updateLastAgentMessage(key, { stopReason: "end_turn" });

    const rawMessages = useMessageStore.getState().perSession[key];

    // Should be: user + agent(m1) + tool = 3 messages
    assert.strictEqual(
      rawMessages.length,
      3,
      "streaming chunks merge into one agent message"
    );

    const agentMsg = rawMessages.find((m) => m.role === "agent");
    assert.ok(agentMsg);
    assert.ok(
      agentMsg!.content.startsWith("chunk0"),
      "content starts with first chunk"
    );
    assert.ok(
      agentMsg!.content.endsWith("words."),
      "content ends with last chunk"
    );
    assert.ok(agentMsg!.stopReason === "end_turn", "stopReason stamped");
  });
});

// ── 6. 自然なチャットビューのための追加テスト ─────────────────────────────────

describe("integration: natural chat view behaviors", () => {
  beforeEach(() => {
    resetCounters();
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({
      writes: {},
      nextSeq: 0,
    });
  });

  it("isFirstOfTurn=true only for the first agent message after user, not for subsequent ones", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // User → Agent(1) → Tool → Agent(2) → Tool → Agent(3, final)
    store.appendMessage(key, msg({ role: "user", content: "analyze this" }));
    store.appendMessage(
      key,
      msg({
        id: "a1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "step 1",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "tool1",
        toolCalls: [
          { id: "tc-1", title: "grep", status: "completed", kind: "search" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        id: "a2",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "step 2",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "tool2",
        toolCalls: [
          { id: "tc-2", title: "read", status: "completed", kind: "read" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        id: "a3",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "final",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);

    const agentItems = items.filter(
      (i) => i.type === "chat" && (i as ChatDisplayItem).role === "agent"
    ) as ChatDisplayItem[];
    assert.strictEqual(agentItems.length, 3);

    // First agent after user → isFirstOfTurn=true
    assert.strictEqual(
      agentItems[0].isFirstOfTurn,
      true,
      "first agent after user should be isFirstOfTurn"
    );
    // Subsequent agents in the same turn → isFirstOfTurn=false
    assert.strictEqual(
      agentItems[1].isFirstOfTurn,
      false,
      "second agent should not be isFirstOfTurn"
    );
    assert.strictEqual(
      agentItems[2].isFirstOfTurn,
      false,
      "third agent with stopReason should not be isFirstOfTurn"
    );
  });

  it("isFirstOfTurn=true for the first agent after a system message (system resets boundary)", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "q1" }));
    store.appendMessage(
      key,
      msg({
        id: "a1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a1",
        stopReason: "end_turn",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "system",
        content: "mode switched",
        compressionInfo: { contextWindowMax: 100000, usedTokens: 50000 },
      })
    );
    store.appendMessage(key, msg({ role: "user", content: "q2" }));
    store.appendMessage(
      key,
      msg({
        id: "a2",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a2",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);

    const agentItems = items.filter(
      (i) => i.type === "chat" && (i as ChatDisplayItem).role === "agent"
    ) as ChatDisplayItem[];
    assert.strictEqual(agentItems.length, 2);
    // First agent after q1 → isFirstOfTurn=true
    assert.strictEqual(agentItems[0].isFirstOfTurn, true);
    // First agent after q2 (which follows system boundary) → isFirstOfTurn=true
    assert.strictEqual(agentItems[1].isFirstOfTurn, true);
  });

  it("streaming updates via refreshLast do not toggle isFirstOfTurn incorrectly", () => {
    // This tests the fix: refreshLast must preserve isFirstOfTurn from
    // the full-batch annotation to prevent header flicker during streaming.
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "hello" }));
    store.appendMessage(
      key,
      msg({
        id: "a1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "Hi",
      })
    );

    // Full pipeline processing
    const rawMessages = useMessageStore.getState().perSession[key];
    let pipeline = new MessagePipeline(defaultConfig);
    let items = pipeline.process(rawMessages, defaultCtx);
    const initialAgent = items.find(
      (i) => i.type === "chat" && (i as ChatDisplayItem).role === "agent"
    ) as ChatDisplayItem;
    assert.strictEqual(
      initialAgent.isFirstOfTurn,
      true,
      "initial: first agent after user"
    );

    // Simulate streaming: append chunk to the last message (modifies in-place)
    const msgs = useMessageStore.getState().perSession[key];
    msgs[msgs.length - 1].content = "Hi there, how can I help?";

    // refreshLast should re-process the last message WITHOUT toggling isFirstOfTurn
    items = pipeline.refreshLast(rawMessages, defaultCtx);
    const updatedAgent = items.find(
      (i) => i.type === "chat" && (i as ChatDisplayItem).role === "agent"
    ) as ChatDisplayItem;
    assert.strictEqual(
      updatedAgent.isFirstOfTurn,
      true,
      "after refreshLast: isFirstOfTurn preserved"
    );
    assert.strictEqual(updatedAgent.content, "Hi there, how can I help?");
  });

  it("tool calls with failed status are still present in intermediate steps", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "run test" }));
    store.appendMessage(
      key,
      msg({
        id: "a1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "running...",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "Error: command not found",
        toolCalls: [
          { id: "tc-1", title: "Bash", status: "failed", kind: "bash" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        id: "a2",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "command failed",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    const steps = grouped.latestGroup!.steps;
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].toolCalls.length, 1);

    // Verify tool call has the failed status
    const toolItem = steps[0].toolCalls[0];
    assert.strictEqual(toolItem.role, "tool");
    assert.ok(toolItem.resolvedToolCalls);
    assert.strictEqual(toolItem.resolvedToolCalls![0].status, "failed");
  });

  it("compression notice between turns does not merge groups", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "q1" }));
    store.appendMessage(
      key,
      msg({
        id: "a1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a1",
        stopReason: "end_turn",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "system",
        content: "",
        compressionInfo: { contextWindowMax: 100000, usedTokens: 80000 },
      })
    );
    store.appendMessage(key, msg({ role: "user", content: "q2" }));
    store.appendMessage(
      key,
      msg({
        id: "a2",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a2",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    // Two turns → two groups
    assert.strictEqual(grouped.groups.length, 1, "q1→a1 is a past group");
    assert.ok(grouped.latestGroup, "q2→a2 is the latest group");
    assert.strictEqual(
      (grouped.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem).content,
      "a2"
    );

    // Compression notice should be in passthrough of the first group
    const compression = grouped.groups[0].passthrough.find(
      (i) => i.type === "compression"
    );
    assert.ok(compression, "compression notice in passthrough");
  });

  it("complete realistic session: multi-turn with streaming, tools, file writes, compression", () => {
    const agentId = "agent-1";
    const sessionId = "sess-1";
    const key = sessionKey(agentId, sessionId);
    const store = useMessageStore.getState();

    // Turn 1: Simple Q&A
    store.appendMessage(
      key,
      msg({ role: "user", content: "what does analyze() do?" })
    );
    store.appendMessage(
      key,
      msg({
        id: "a1",
        role: "agent",
        agentId,
        sessionId,
        content: "The analyze() function parses code structure.",
        stopReason: "end_turn",
      })
    );

    // Turn 2: Complex task with multiple steps
    store.appendMessage(
      key,
      msg({
        role: "user",
        content: "refactor analyze() to handle edge cases",
        writeSeq: 0,
      })
    );
    store.appendMessage(
      key,
      msg({
        id: "a2",
        role: "agent",
        agentId,
        sessionId,
        content: "Let me read the file first.",
        writeSeq: 0,
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId,
        sessionId,
        content: "export function analyze() { ... }",
        toolCalls: [
          {
            id: "tc-read",
            title: "Read src/analyze.ts",
            status: "completed",
            kind: "read",
            locations: [{ path: "src/analyze.ts", line: 1 }],
          },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        id: "a3",
        role: "agent",
        agentId,
        sessionId,
        content: "Now I'll check the edge cases.",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId,
        sessionId,
        content: "3 edge cases found",
        toolCalls: [
          {
            id: "tc-grep",
            title: "Grep edge case",
            status: "completed",
            kind: "search",
          },
        ],
      })
    );

    // File write between steps
    useFileWriteStore
      .getState()
      .addWrite(
        agentId,
        sessionId,
        "src/analyze.ts",
        "export function analyze(input: string) { ... }",
        "export function analyze() { ... }"
      );

    store.appendMessage(
      key,
      msg({
        id: "a4",
        role: "agent",
        agentId,
        sessionId,
        content: "Refactoring complete. Added input validation.",
        stopReason: "end_turn",
        writeSeq: 1,
      })
    );

    // Compression
    store.appendMessage(
      key,
      msg({
        role: "system",
        content: "",
        compressionInfo: { contextWindowMax: 100000, usedTokens: 90000 },
      })
    );

    // Turn 3: Follow-up
    store.appendMessage(key, msg({ role: "user", content: "add tests" }));
    store.appendMessage(
      key,
      msg({
        id: "a5",
        role: "agent",
        agentId,
        sessionId,
        content: "Writing tests...",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    // Structure verification
    assert.strictEqual(
      grouped.groups.length,
      2,
      "turns 1 and 2 are past groups"
    );
    assert.ok(grouped.latestGroup, "turn 3 is latest group");

    // Turn 1: simple, no steps
    assert.strictEqual(grouped.groups[0].steps.length, 0);
    assert.strictEqual(
      (grouped.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "The analyze() function parses code structure."
    );

    // Turn 2: complex, has intermediate steps
    const turn2 = grouped.groups[1];
    assert.ok(turn2.steps.length >= 1, "turn 2 has intermediate steps");
    assert.ok(turn2.finalResponse, "turn 2 has final response");
    assert.strictEqual(
      (turn2.finalResponse!.item as ChatDisplayItem).content,
      "Refactoring complete. Added input validation."
    );
    assert.strictEqual(
      (turn2.finalResponse!.item as ChatDisplayItem).stopReason,
      "end_turn"
    );

    // Turn 2 compression in passthrough
    const comp = turn2.passthrough.find((i) => i.type === "compression");
    assert.ok(comp, "compression notice in turn 2 passthrough");

    // Turn 3: in progress
    assert.ok(grouped.latestGroup);
    assert.strictEqual(grouped.latestGroup!.steps.length, 0, "no steps yet");
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem)?.content,
      "Writing tests..."
    );
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem)?.stopReason,
      undefined,
      "no stopReason yet"
    );

    // File writes verification
    const writes = useFileWriteStore
      .getState()
      .getWritesForSession(agentId, sessionId);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].path, "src/analyze.ts");
  });

  it("tool-only user request: pre-agent steps rendered separately", () => {
    // Some agents emit tool calls without any preceding agent message.
    // These should be captured as pre-agent steps (agentMessage=null).
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "list files" }));
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "file1.ts\nfile2.ts\nfile3.ts",
        toolCalls: [
          { id: "tc-1", title: "Bash ls", status: "completed", kind: "bash" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "README.md",
        toolCalls: [
          {
            id: "tc-2",
            title: "Find readme",
            status: "completed",
            kind: "search",
          },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "Found 4 files in the directory.",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    // Two pre-agent tool calls → one pre-agent step
    assert.strictEqual(grouped.latestGroup!.steps.length, 1);
    assert.strictEqual(grouped.latestGroup!.steps[0].isPreAgent, true);
    assert.strictEqual(grouped.latestGroup!.steps[0].agentMessage, null);
    assert.strictEqual(grouped.latestGroup!.steps[0].toolCalls.length, 2);
    assert.strictEqual(
      grouped.latestGroup!.steps[0].toolCalls[0].resolvedToolCalls![0].title,
      "Bash ls"
    );
    assert.strictEqual(
      grouped.latestGroup!.steps[0].toolCalls[1].resolvedToolCalls![0].title,
      "Find readme"
    );
    // Final response is the agent message
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem).content,
      "Found 4 files in the directory."
    );
  });

  it("cancelled turn: stopReason=cancelled marks turn boundary correctly", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "long analysis" }));
    store.appendMessage(
      key,
      msg({
        id: "a1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "analyzing...",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "partial result",
        toolCalls: [
          { id: "tc-1", title: "Read", status: "completed", kind: "read" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        id: "a2",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "(cancelled by user)",
        stopReason: "cancelled",
      })
    );

    // Next turn
    store.appendMessage(key, msg({ role: "user", content: "try again" }));
    store.appendMessage(
      key,
      msg({
        id: "a3",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "ok, let me try again",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    // Turn 1 should be a completed group with finalResponse (cancelled)
    assert.strictEqual(grouped.groups.length, 1);
    assert.ok(grouped.groups[0].finalResponse);
    assert.strictEqual(
      (grouped.groups[0].finalResponse!.item as ChatDisplayItem).stopReason,
      "cancelled"
    );
    assert.strictEqual(
      (grouped.groups[0].finalResponse!.item as ChatDisplayItem).content,
      "(cancelled by user)"
    );

    // Latest group has the new turn
    assert.ok(grouped.latestGroup);
    assert.strictEqual(
      (grouped.latestGroup!.userItem as ChatDisplayItem).content,
      "try again"
    );
  });
});

// ── 7. Edge cases and regression guards ─────────────────────────────────────

describe("integration: edge cases and regression guards", () => {
  beforeEach(() => {
    resetCounters();
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
    });
    useFileWriteStore.setState({
      writes: {},
      nextSeq: 0,
    });
  });

  it("tool message before any agent message (pre-agent step)", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "run ls" }));
    // Tool arrives before any agent message (some agents do this)
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "file1.ts\nfile2.ts",
        toolCalls: [
          { id: "tc-1", title: "Bash", status: "completed", kind: "bash" },
        ],
      })
    );
    // Then agent responds
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "I see two files",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    // Pre-agent step should exist
    const preAgentStep = grouped.latestGroup!.steps.find((s) => s.isPreAgent);
    assert.ok(preAgentStep, "pre-agent step exists");
    assert.strictEqual(preAgentStep!.toolCalls.length, 1);
    assert.strictEqual(preAgentStep!.agentMessage, null);
  });

  it("consecutive user messages: empty group between them", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "q1" }));
    store.appendMessage(key, msg({ role: "user", content: "q2" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "answer",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    // First user message creates an empty group
    assert.strictEqual(grouped.groups.length, 1);
    assert.strictEqual(
      grouped.groups[0].steps.length,
      0,
      "empty group between consecutive user messages"
    );
  });

  it("stopReason on intermediate agent does not break final selection", () => {
    // When an intermediate agent message has stopReason (e.g. "tool_use"),
    // selectFinalResponse MUST pick the final message with "end_turn",
    // NOT the intermediate one.
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "multi-step task" }));

    // Intermediate agent message with stopReason (some agents send stopReason on intermediate)
    store.appendMessage(
      key,
      msg({
        id: "int1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "intermediate",
        stopReason: "tool_use",
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "result",
        toolCalls: [
          { id: "tc-1", title: "Bash", status: "completed", kind: "bash" },
        ],
      })
    );

    // Final agent message (different id, with stopReason)
    store.appendMessage(
      key,
      msg({
        id: "fin1",
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "final answer",
        stopReason: "end_turn",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    assert.ok(grouped.latestGroup!.finalResponse);

    // "end_turn" message MUST be the final response, not the intermediate "tool_use"
    const finalContent = (
      grouped.latestGroup!.finalResponse?.item as ChatDisplayItem
    ).content;
    assert.strictEqual(
      finalContent,
      "final answer",
      "final response must be the end_turn message, not intermediate"
    );
    const finalStopReason = (
      grouped.latestGroup!.finalResponse?.item as ChatDisplayItem
    ).stopReason;
    assert.strictEqual(
      finalStopReason,
      "end_turn",
      "final response stopReason must be end_turn"
    );
  });

  it("pipeline incremental processing produces correct items", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // Batch 1: user + agent
    store.appendMessage(key, msg({ role: "user", content: "question" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "partial answer",
      })
    );

    const raw1 = useMessageStore.getState().perSession[key];

    // Batch 2: tool + final agent
    store.appendMessage(
      key,
      msg({
        role: "tool",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "tool result",
        toolCalls: [
          { id: "tc-1", title: "Bash", status: "completed", kind: "bash" },
        ],
      })
    );
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "final answer",
        stopReason: "end_turn",
      })
    );

    const raw2 = useMessageStore.getState().perSession[key];

    // Full re-process
    const pipeline2 = new MessagePipeline(defaultConfig);
    const result2Full = pipeline2.process(raw2, defaultCtx);

    // Incremental process
    const pipeline3 = new MessagePipeline(defaultConfig);
    pipeline3.process(raw1, defaultCtx);
    const result2Incremental = pipeline3.processIncremental(
      raw2.slice(raw1.length),
      defaultCtx
    );

    // Both should produce the same number of items
    assert.strictEqual(
      result2Full.length,
      result2Incremental.length,
      "incremental and full re-process produce same item count"
    );

    // Both should have the same content for each item
    for (let i = 0; i < result2Full.length; i++) {
      const fullItem = result2Full[i] as ChatDisplayItem;
      const incrItem = result2Incremental[i] as ChatDisplayItem;
      assert.strictEqual(
        fullItem.content,
        incrItem.content,
        `item ${i} content matches (full="${fullItem.content}" vs incr="${incrItem.content}")`
      );
    }
  });

  it("updateLastAgentMessage does not mutate previous turn's final response", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    // Turn 1 complete
    store.appendMessage(key, msg({ role: "user", content: "q1" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a1",
      })
    );
    store.updateLastAgentMessage(key, { stopReason: "end_turn" });

    // Turn 2 starts
    store.appendMessage(key, msg({ role: "user", content: "q2" }));
    store.appendStreamChunk(key, "agent-1", "sess-1", "thinking...", "m2");

    // updateLastAgentMessage should NOT touch turn 1's message
    store.updateLastAgentMessage(key, { writeSeq: 5 });

    const rawMessages = useMessageStore.getState().perSession[key];
    const turn1Agent = rawMessages.find((m) => m.content === "a1");
    const turn2Agent = rawMessages.find((m) => m.content === "thinking...");

    assert.ok(turn1Agent);
    assert.ok(turn2Agent);
    assert.strictEqual(
      turn1Agent!.stopReason,
      "end_turn",
      "turn 1 stopReason preserved"
    );
    assert.strictEqual(
      turn1Agent!.writeSeq,
      undefined,
      "turn 1 writeSeq NOT mutated"
    );
    assert.strictEqual(turn2Agent!.writeSeq, 5, "turn 2 writeSeq updated");
  });

  it("empty message store produces empty pipeline output", () => {
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process([], defaultCtx);
    assert.strictEqual(items.length, 0);

    const grouped = new IntermediateStepGrouper(items).compute();
    assert.strictEqual(grouped.leading.length, 0);
    assert.strictEqual(grouped.groups.length, 0);
    assert.strictEqual(grouped.latestGroup, null);
  });

  it("message with empty content does not break grouping", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "",
      })
    );

    const rawMessages = useMessageStore.getState().perSession[key];
    const pipeline = new MessagePipeline(defaultConfig);
    const items = pipeline.process(rawMessages, defaultCtx);
    const grouped = new IntermediateStepGrouper(items).compute();

    assert.ok(grouped.latestGroup);
    assert.strictEqual(
      (grouped.latestGroup!.userItem as ChatDisplayItem).content,
      ""
    );
  });

  it("after a turn finishes, new messages correctly extend the latestGroup", () => {
    const key = sessionKey("agent-1", "sess-1");
    const store = useMessageStore.getState();

    store.appendMessage(key, msg({ role: "user", content: "q1" }));
    store.appendMessage(
      key,
      msg({
        role: "agent",
        agentId: "agent-1",
        sessionId: "sess-1",
        content: "a1",
        stopReason: "end_turn",
      })
    );

    let rawMessages = useMessageStore.getState().perSession[key];
    let pipeline = new MessagePipeline(defaultConfig);
    let items = pipeline.process(rawMessages, defaultCtx);
    let grouped = new IntermediateStepGrouper(items).compute();

    assert.strictEqual(
      grouped.groups.length,
      0,
      "single turn → no past groups"
    );
    assert.ok(grouped.latestGroup);
    assert.strictEqual(
      (grouped.latestGroup!.finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );

    // Now user sends another message — this should push previous turn into past groups
    store.appendMessage(key, msg({ role: "user", content: "q2" }));

    rawMessages = useMessageStore.getState().perSession[key];
    pipeline = new MessagePipeline(defaultConfig);
    items = pipeline.process(rawMessages, defaultCtx);
    grouped = new IntermediateStepGrouper(items).compute();

    assert.strictEqual(
      grouped.groups.length,
      1,
      "previous turn moved to past groups"
    );
    assert.strictEqual(
      (grouped.groups[0].finalResponse?.item as ChatDisplayItem).content,
      "a1"
    );
    assert.ok(grouped.latestGroup, "latestGroup exists for pending turn");
    assert.strictEqual(
      grouped.latestGroup!.finalResponse,
      null,
      "no agent reply yet for latest turn"
    );
  });
});
