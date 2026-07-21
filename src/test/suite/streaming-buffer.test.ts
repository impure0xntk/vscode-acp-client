import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AppSessionInfo } from "../../application/session/types";
import type { ChatMessage } from "../../domain/models/chat";
import { wireSessionEvents } from "../../application/handlers";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// Helpers
// ============================================================================

function createMockOrchestrator(): SessionOrchestrator {
  return new SessionOrchestrator({
    fs: {
      readFile: async () => "",
      writeFile: async () => {},
      exists: async () => false,
    } as any,
    ui: {
      showQuickPick: async () => null,
      showInputBox: async () => undefined,
      showErrorMessage: async () => {},
      showWarningMessage: async () => {},
      showInformationMessage: async () => {},
      withProgress: async (_opts: any, task: any) =>
        task(
          { report: () => {} } as any,
          { isCancellationRequested: false } as any
        ),
      createOutputChannel: () =>
        ({ appendLine: () => {}, dispose: () => {} }) as any,
      showOutputChannel: () => {},
      getConfiguration: () => false as any,
    } as any,
  });
}

/**
 * Inject a running session directly into the orchestrator's internal state.
 */
function injectRunningSession(
  orch: SessionOrchestrator,
  agentId: string,
  sessionId: string
): AppSessionInfo {
  const sessions = (orch as any).getInternalState().sessions as Map<
    string,
    Map<string, AppSessionInfo>
  >;
  const agentSessions =
    sessions.get(agentId) ?? new Map<string, AppSessionInfo>();
  const now = new Date();
  const info: AppSessionInfo = {
    sessionId,
    agentId,
    title: "test-session",
    cwd: "/tmp/test",
    status: "running",
    lastTurnOutcome: null,
    messages: [],
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
    lastResponseAt: null,
    tokenUsage: { input: 0, output: 0, total: 0 },
    pendingCancel: false,
  };
  agentSessions.set(sessionId, info);
  sessions.set(agentId, agentSessions);
  return info;
}

function makeAgentMessageChunkNotification(
  sessionId: string,
  text: string
): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  } as SessionNotification;
}

function makeAgentThoughtChunkNotification(
  sessionId: string,
  text: string
): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text },
    },
  } as SessionNotification;
}

// ============================================================================
// Streaming: each agent_message_chunk is delivered as a separate ChatMessage
// ============================================================================

describe("Streaming — agent_message_chunk creates per-chunk ChatMessage", () => {
  let orch: SessionOrchestrator;
  const agentId = "codex";
  const sessionId = "sess-codex-1";

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectRunningSession(orch, agentId, sessionId);
  });

  afterEach(() => {
    orch.dispose();
  });

  it("batches all chunks (no immediate first chunk)", () => {
    const chunks = ["こ", "ん", "に", "ち", "は"];
    const streamChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    // All chunks are batched — nothing emitted yet (timer not fired)
    assert.strictEqual(streamChunks.length, 0);

    // Flush the batch timer
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, all chunks are emitted as one combined chunk
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], "こんにちは");
  });

  it("batches all chunks — timer coalesces into single flush", () => {
    const chunks = ["Hello", " ", "World"];
    const sessionMessages: ChatMessage[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      const msg: ChatMessage = {
        id: `msg-${evt.chunk}-${Date.now()}-${Math.random()}`,
        role: "agent",
        content: evt.chunk,
        timestamp: Date.now(),
        agentId,
        sessionId: evt.sessionId,
      };
      sessionMessages.push(msg);
    });

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    // All chunks are batched — nothing emitted yet (timer not fired)
    assert.strictEqual(sessionMessages.length, 0);

    // Flush batch timer
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, all chunks are one combined message
    assert.strictEqual(sessionMessages.length, 1);
    assert.strictEqual(sessionMessages[0].content, "Hello World");
  });

  it("sets isStreaming on first chunk", () => {
    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.isStreaming, false);

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "first")
    );

    assert.strictEqual(info.isStreaming, true);
  });

  it("emits sessionStreamStart on first chunk", () => {
    let streamStartEmitted = false;
    orch.on("sessionStreamStart", () => {
      streamStartEmitted = true;
    });

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "hello")
    );

    assert.strictEqual(streamStartEmitted, true);
  });

  it("handles character-by-character streaming — all batched", () => {
    const text = "今日は良い天気ですね";
    const chars = Array.from(text);
    const streamChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });

    for (const ch of chars) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, ch)
      );
    }

    // All chars are batched — nothing emitted yet (timer not fired)
    assert.strictEqual(streamChunks.length, 0);

    // Flush the batch timer
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, all chars are emitted as one combined chunk
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], text);
  });

  it("handles mixed single-char and multi-char chunks — all batched", () => {
    const chunks = ["Hel", "lo", " ", "World", "!", "!", "!"];
    const streamChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    // All chunks are batched — nothing emitted yet (timer not fired)
    assert.strictEqual(streamChunks.length, 0);

    // Flush the batch timer
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, all chunks are combined into one
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], "Hello World!!!");
  });

  it("handles empty string chunks", () => {
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.isStreaming, true);
  });

  it("handles long streaming text — batched delivery", () => {
    // Use chunk count below TEXT_BATCH_MAX_CHUNKS so timer-based flush applies
    const chunkCount = 10;
    const longText = "a".repeat(chunkCount * 100);
    const chunkSize = 100;
    const streamChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });

    for (let i = 0; i < longText.length; i += chunkSize) {
      const chunk = longText.slice(i, i + chunkSize);
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    // All chunks are batched — nothing emitted yet (timer not fired)
    assert.strictEqual(streamChunks.length, 0);

    // Flush the batch timer
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, all chunks are emitted as one combined chunk
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], longText);
  });
});

// ============================================================================
// Goose-style: single large chunk produces a single stream event
// ============================================================================

describe("Streaming — goose-style (single large chunk per turn)", () => {
  let orch: SessionOrchestrator;
  const agentId = "goose";
  const sessionId = "sess-goose-1";

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectRunningSession(orch, agentId, sessionId);
  });

  afterEach(() => {
    orch.dispose();
  });

  it("single large chunk — batched then flushed by timer", () => {
    const fullText =
      "Hello! I'm Goose, your AI assistant. How can I help you today?";
    const streamChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, fullText)
    );

    // Batched — not yet emitted (timer not fired)
    assert.strictEqual(streamChunks.length, 0);

    // Flush the batch timer
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);

    // Single chunk emitted after flush
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], fullText);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("Streaming — edge cases", () => {
  let orch: SessionOrchestrator;
  const agentId = "edge-agent";
  const sessionId = "sess-edge-1";

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectRunningSession(orch, agentId, sessionId);
  });

  afterEach(() => {
    orch.dispose();
  });

  it("ignores chunks for non-running sessions", () => {
    const info = orch.getSessionInfo(agentId, sessionId)!;
    info.status = "idle";

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "should be ignored")
    );

    const streamChunks: string[] = [];
    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });

    assert.strictEqual(streamChunks.length, 0);
  });

  it("ignores chunks with no text content (image content)", () => {
    const notification: SessionNotification = {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", data: "abc", mimeType: "image/png" },
      },
    } as any;

    const streamChunks: string[] = [];
    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });

    (orch as any).handleSessionUpdate(agentId, notification);

    assert.strictEqual(streamChunks.length, 0);
  });

  it("delivers agent_thought_chunk as a separate stream event from agent_message_chunk", () => {
    const sessionMessages: ChatMessage[] = [];
    const streamChunks: Array<{ chunk: string; sessionUpdate?: string }> = [];
    let streamStartEmitted = false;
    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });
    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push({ chunk: evt.chunk, sessionUpdate: evt.sessionUpdate });
    });
    orch.on("sessionStreamStart", () => {
      streamStartEmitted = true;
    });

    // Send thought chunk — buffered internally, but isStreaming + streamStart fire immediately
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentThoughtChunkNotification(sessionId, "thinking...")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.isStreaming, true);
    assert.strictEqual(streamStartEmitted, true);
    // Thoughts are buffered — not yet delivered as sessionStreamChunk
    assert.strictEqual(
      sessionMessages.length,
      0,
      "thought chunks should not create agent messages"
    );
    assert.strictEqual(
      streamChunks.length,
      0,
      "thoughts buffered, no stream chunks yet"
    );

    // Sending agent_message_chunk appends to the (separate) text batch
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "hello")
    );

    // Both are now buffered in distinct batches — flush required
    assert.strictEqual(streamChunks.length, 0);
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);
    // flushAllBatches flushes thoughts (agent_thought_chunk) then message text
    // (agent_message_chunk) as TWO distinct stream events. They must never be
    // concatenated into the same message body.
    assert.strictEqual(streamChunks.length, 2);
    assert.strictEqual(streamChunks[0].sessionUpdate, "agent_thought_chunk");
    assert.strictEqual(streamChunks[0].chunk, "thinking...");
    assert.strictEqual(streamChunks[1].sessionUpdate, "agent_message_chunk");
    assert.strictEqual(streamChunks[1].chunk, "hello");
  });

  it("handles different sessions independently", () => {
    const sessionId2 = "sess-edge-2";
    injectRunningSession(orch, agentId, sessionId2);

    const chunks1: string[] = [];
    const chunks2: string[] = [];
    orch.on("sessionStreamChunk", (evt: any) => {
      if (evt.sessionId === sessionId) chunks1.push(evt.chunk);
      if (evt.sessionId === sessionId2) chunks2.push(evt.chunk);
    });

    // Send first chunk to session 1 — starts streaming
    // Send first chunk to session 1 — batched (timer-based)
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Hello from session 1")
    );
    // Send second chunk to session 1 — appended to same batch
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, " continued")
    );
    // Send first chunk to session 2 — batched (separate timer)
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId2, "Hello from session 2")
    );

    // Both sessions: chunks are batched (timer not fired)
    assert.strictEqual(chunks1.length, 0);
    assert.strictEqual(chunks2.length, 0);

    // Flush both batches — each session emits combined text
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId2);

    assert.strictEqual(chunks1.length, 1);
    assert.strictEqual(chunks1[0], "Hello from session 1 continued");
    assert.strictEqual(chunks2.length, 1);
    assert.strictEqual(chunks2[0], "Hello from session 2");
  });

  it("handles different agents independently", () => {
    const agentId2 = "edge-agent-2";
    injectRunningSession(orch, agentId2, sessionId);

    const chunks1: string[] = [];
    const chunks2: string[] = [];
    orch.on("sessionStreamChunk", (evt: any) => {
      if (evt.agentId === agentId) chunks1.push(evt.chunk);
      if (evt.agentId === agentId2) chunks2.push(evt.chunk);
    });

    // First chunk to agent 1 — immediate
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Agent 1 says hi")
    );
    // First chunk to agent 2 — immediate
    (orch as any).handleSessionUpdate(
      agentId2,
      makeAgentMessageChunkNotification(sessionId, "Agent 2 says hi")
    );

    // Batched — flush both agents
    assert.strictEqual(chunks1.length, 0);
    assert.strictEqual(chunks2.length, 0);

    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId, sessionId);
    (orch as any)
      .getInternalState()
      .protocolHandler.flushAllBatches(agentId2, sessionId);

    assert.strictEqual(chunks1.length, 1);
    assert.strictEqual(chunks1[0], "Agent 1 says hi");
    assert.strictEqual(chunks2.length, 1);
    assert.strictEqual(chunks2[0], "Agent 2 says hi");
  });
});

// ============================================================================
// Integration: streaming + tool calls
// ============================================================================

describe("Streaming — interaction with tool calls", () => {
  let orch: SessionOrchestrator;
  const agentId = "tool-agent";
  const sessionId = "sess-tool-1";

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectRunningSession(orch, agentId, sessionId);
  });

  afterEach(() => {
    orch.dispose();
  });

  it("flushes buffered tool calls when agent text arrives", () => {
    const toolCallNotification: SessionNotification = {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Read file",
        kind: "read",
        status: "completed",
        rawInput: '{"path": "test.ts"}',
        rawOutput: "file content",
      },
    } as any;

    // Send tool call first — should be buffered by PromptExecution
    (orch as any).handleSessionUpdate(agentId, toolCallNotification);

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0, "tool calls are buffered");

    // Now send agent text — this flushes the buffered tool call
    const emitted: ChatMessage[] = [];
    orch.on("sessionMessage", (evt: any) => {
      emitted.push(evt.message);
    });

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Here's the result.")
    );

    const updatedInfo = orch.getSessionInfo(agentId, sessionId)!;
    // Tool message should have been flushed (via sessionMessage → appendMessage → sessionInfo.messages)
    // The agent chunk emits sessionStreamChunk (NOT sessionMessage)
    assert.ok(updatedInfo.messages.length >= 1);
    assert.strictEqual(updatedInfo.messages[0].role, "tool");
  });
});

// ============================================================================
// Regression: prompt send during/after a turn must not get stuck in "ready"
// ============================================================================

/**
 * Regression coverage for the "message stuck in ready / stacked forever" bug.
 *
 * Root cause: send() routed a prompt to a direct execute() whenever
 * sessionInfo.status was NOT "running", even if the previous turn was still
 * in flight (status lagged behind isStreaming). That misrouted prompt never
 * transitioned the session to "waiting for", so every later message piled
 * onto the queue and was never processed.
 *
 * Fix: send() now also queues when isStreaming is true, and protocol-handler
 * forces status="running" while isStreaming is true so concurrent sends are
 * queued instead of misrouted.
 */

function injectStreamingSession(
  orch: SessionOrchestrator,
  agentId: string,
  sessionId: string,
  opts: { status: AppSessionInfo["status"]; isStreaming: boolean }
): AppSessionInfo {
  const sessions = (orch as any).getInternalState().sessions as Map<
    string,
    Map<string, AppSessionInfo>
  >;
  const agentSessions =
    sessions.get(agentId) ?? new Map<string, AppSessionInfo>();
  const now = new Date();
  const info: AppSessionInfo = {
    sessionId,
    agentId,
    title: "test-session",
    cwd: "/tmp/test",
    status: opts.status,
    lastTurnOutcome: null,
    messages: [],
    isStreaming: opts.isStreaming,
    createdAt: now,
    updatedAt: now,
    lastResponseAt: null,
    tokenUsage: { input: 0, output: 0, total: 0 },
    pendingCancel: false,
  };
  agentSessions.set(sessionId, info);
  sessions.set(agentId, agentSessions);
  return info;
}

describe("Regression — prompt send while a turn is still in flight", () => {
  let orch: SessionOrchestrator;
  const agentId = "reg-send-agent";
  const sessionId = "reg-send-sess";

  beforeEach(() => {
    orch = createMockOrchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("queues the prompt when isStreaming is true even if status lagged to idle", async () => {
    // Final turn still streaming, but status was reset to "idle" (the bug's
    // exact precondition).
    injectStreamingSession(orch, agentId, sessionId, {
      status: "idle",
      isStreaming: true,
    });
    // No connection wired → if send() misrouted to execute(), it would throw.
    (orch as any).agentConnectionRef.value = {
      getConnection: () => undefined,
    };

    const result = await orch.prompt(agentId, sessionId, "続けて");

    // Must be queued (a QueuedPrompt is returned), not executed directly.
    assert.ok(result, "prompt should be queued, not executed directly");
    assert.strictEqual(result!.status, "pending");
    assert.strictEqual(result!.mode, "stack");
  });

  it("queues the prompt when status is running and isStreaming is false", async () => {
    injectStreamingSession(orch, agentId, sessionId, {
      status: "running",
      isStreaming: false,
    });
    (orch as any).agentConnectionRef.value = {
      getConnection: () => undefined,
    };

    const result = await orch.prompt(agentId, sessionId, "続けて");

    assert.ok(result, "prompt should be queued while status is running");
    assert.strictEqual(result!.status, "pending");
  });

  it("executes directly (returns undefined) when the turn is fully idle", async () => {
    injectStreamingSession(orch, agentId, sessionId, {
      status: "idle",
      isStreaming: false,
    });
    // Wire a connection so execute() can run without throwing.
    (orch as any).agentConnectionRef.value = {
      getConnection: (_agentId: string) => ({
        prompt: async () => ({ stopReason: "end_turn", usage: undefined }),
      }),
    };

    const result = await orch.prompt(agentId, sessionId, "こんにちは");

    assert.strictEqual(
      result,
      undefined,
      "prompt should execute directly when session is idle and not streaming"
    );
  });

  it("protocol-handler keeps status running when a late chunk arrives while streaming", () => {
    // status lagged to "idle" but a chunk still arrives for an in-flight turn.
    injectStreamingSession(orch, agentId, sessionId, {
      status: "idle",
      isStreaming: true,
    });

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "late chunk")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    // Status must be normalized back to "running" so concurrent sends queue.
    assert.strictEqual(info.status, "running");
    assert.strictEqual(info.isStreaming, true);
  });

  it("late notification after turn fully ended is drained, not treated as running", () => {
    // Turn ended: isStreaming false, turnEndedAt set within DRAIN_WINDOW.
    injectStreamingSession(orch, agentId, sessionId, {
      status: "idle",
      isStreaming: false,
    });
    const sKey = `${agentId}:${sessionId}`;
    (orch as any)
      .getInternalState()
      .protocolHandler.turnEndedAt.set(sKey, Date.now());

    const emitted: unknown[] = [];
    orch.on("sessionUpdate", (evt: any) => emitted.push(evt));

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "late chunk")
    );

    // Late notification is drained (emitted) but status stays idle.
    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.status, "idle");
    assert.ok(emitted.length >= 1, "late notification should be drained");
  });
});

// ============================================================================
// Regression: queued stack prompts are auto-sent after a turn completes
// ============================================================================

/**
 * After a turn finishes (status idle + streaming ended), any prompts that were
 * stacked in the queue must be drained automatically. This is driven by
 * execute()'s finally block calling processNextInQueue().
 */

function wireCountingConnection(orch: SessionOrchestrator): {
  promptCalls: string[];
} {
  const promptCalls: string[] = [];
  // Replace the connection ref so execute() can run without a real agent
  // process. Each call resolves immediately.
  (orch as any).agentConnectionRef.value = {
    getConnection: (_agentId: string) => ({
      prompt: async (req: {
        prompt: Array<{ type: string; text?: string }>;
      }) => {
        const text = req.prompt
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        promptCalls.push(text);
        return { stopReason: "end_turn" as const, usage: undefined };
      },
      cancel: async () => {},
    }),
  };
  return { promptCalls };
}

describe("Regression — queued prompts auto-send when a turn ends", () => {
  let orch: SessionOrchestrator;
  const agentId = "auto-drain-agent";
  const sessionId = "auto-drain-sess";

  beforeEach(() => {
    orch = createMockOrchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("drains all queued stack prompts after the first turn completes", async () => {
    injectStreamingSession(orch, agentId, sessionId, {
      status: "idle",
      isStreaming: false,
    });
    const { promptCalls } = wireCountingConnection(orch);

    // Simulate a turn already in progress: status is running, so prompts
    // sent now are stacked in the queue instead of executing directly.
    const info = orch.getSessionInfo(agentId, sessionId)!;
    info.status = "running";

    const qB = await orch.prompt(agentId, sessionId, "B");
    const qC = await orch.prompt(agentId, sessionId, "C");
    assert.ok(qB, "B must be queued while a turn is running");
    assert.ok(qC, "C must be queued while a turn is running");
    assert.strictEqual(
      orch.getQueuedPrompts(agentId, sessionId).length,
      2,
      "two prompts stacked"
    );

    // Turn ends → status back to idle. The real code path triggers
    // processNextInQueue from execute()'s finally block; replicate that
    // boundary here to assert the auto-drain behaviour.
    info.status = "idle";
    (orch as any).promptExecution.processNextInQueue(agentId, sessionId);
    // Allow the recursive execute() chain (B then C) to run to completion.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.deepStrictEqual(
      promptCalls,
      ["B", "C"],
      "queued prompts auto-sent in FIFO order after turn ends"
    );

    const after = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(after.status, "idle", "session returns to idle");
    assert.strictEqual(after.isStreaming, false);
    assert.strictEqual(
      orch.getQueuedPrompts(agentId, sessionId).length,
      0,
      "queue fully drained"
    );
  });

  it("does not auto-send when the queue is empty (single prompt only)", async () => {
    injectStreamingSession(orch, agentId, sessionId, {
      status: "idle",
      isStreaming: false,
    });
    const { promptCalls } = wireCountingConnection(orch);

    const result = await orch.prompt(agentId, sessionId, "単発");
    assert.strictEqual(result, undefined, "single prompt executes directly");

    assert.strictEqual(promptCalls.length, 1, "no extra auto-send");
    assert.strictEqual(promptCalls[0], "単発");
  });

  it("processes the queue FIFO across multiple sequential turns", async () => {
    injectStreamingSession(orch, agentId, sessionId, {
      status: "idle",
      isStreaming: false,
    });
    const { promptCalls } = wireCountingConnection(orch);

    // Turn in progress: stack three prompts.
    const info = orch.getSessionInfo(agentId, sessionId)!;
    info.status = "running";

    const qA = await orch.prompt(agentId, sessionId, "A");
    const qB = await orch.prompt(agentId, sessionId, "B");
    const qC = await orch.prompt(agentId, sessionId, "C");
    assert.ok(qA);
    assert.ok(qB);
    assert.ok(qC);

    info.status = "idle";
    (orch as any).promptExecution.processNextInQueue(agentId, sessionId);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // A, B, C auto-drained in FIFO order.
    assert.deepStrictEqual(promptCalls, ["A", "B", "C"]);
  });
});

// ============================================================================
// Regression: wireSessionEvents must forward sessionUpdate to pushStreamChunk
// ============================================================================

describe("wireSessionEvents — sessionStreamChunk forwards sessionUpdate", () => {
  let orch: SessionOrchestrator;

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectRunningSession(orch, "reg-agent", "reg-sess");
  });

  afterEach(() => {
    orch.dispose();
  });

  it("forwards agent_thought_chunk sessionUpdate so the webview routes it to a ThinkingBlock", () => {
    const pushed: Array<{
      chunk: string;
      messageId?: string;
      sessionUpdate?: string;
    }> = [];
    const chatPanel = {
      pushStreamChunk: (
        _agentId: string,
        _sessionId: string,
        chunk: string,
        messageId?: string,
        sessionUpdate?: string
      ) => {
        pushed.push({ chunk, messageId, sessionUpdate });
      },
      pushStreamEnd: () => {},
      postMessage: () => {},
    } as any;

    wireSessionEvents({
      orchestrator: orch,
      getChatPanel: () => chatPanel,
      presenter: {} as any,
      statusTracker: {} as any,
      historyStore: { addEntry: () => {} } as any,
      updateContext: () => {},
      sendTabs: () => {},
    });

    // Exactly how ProtocolHandler.flushThoughts emits a thought chunk.
    (orch as any).emit("sessionStreamChunk", {
      agentId: "reg-agent",
      sessionId: "reg-sess",
      chunk: "内部で考え中…",
      messageId: "m-thought",
      sessionUpdate: "agent_thought_chunk",
    });

    assert.strictEqual(pushed.length, 1);
    assert.strictEqual(pushed[0].sessionUpdate, "agent_thought_chunk");
    assert.strictEqual(pushed[0].chunk, "内部で考え中…");
    assert.strictEqual(pushed[0].messageId, "m-thought");
  });

  it("forwards agent_message_chunk sessionUpdate untouched", () => {
    const pushed: Array<{ chunk: string; sessionUpdate?: string }> = [];
    const chatPanel = {
      pushStreamChunk: (
        _agentId: string,
        _sessionId: string,
        chunk: string,
        _messageId?: string,
        sessionUpdate?: string
      ) => {
        pushed.push({ chunk, sessionUpdate });
      },
      pushStreamEnd: () => {},
      postMessage: () => {},
    } as any;

    wireSessionEvents({
      orchestrator: orch,
      getChatPanel: () => chatPanel,
      presenter: {} as any,
      statusTracker: {} as any,
      historyStore: { addEntry: () => {} } as any,
      updateContext: () => {},
      sendTabs: () => {},
    });

    (orch as any).emit("sessionStreamChunk", {
      agentId: "reg-agent",
      sessionId: "reg-sess",
      chunk: "こんにちは。",
      messageId: "m-msg",
      sessionUpdate: "agent_message_chunk",
    });

    assert.strictEqual(pushed.length, 1);
    assert.strictEqual(pushed[0].sessionUpdate, "agent_message_chunk");
    assert.strictEqual(pushed[0].chunk, "こんにちは。");
  });
});
