import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AppSessionInfo } from "../../application/session/types";
import type { ChatMessage } from "../../domain/models/chat";

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
  const agentSessions = sessions.get(agentId) ?? new Map<string, AppSessionInfo>();
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

  it("emits first chunk immediately, batches subsequent chunks", () => {
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

    // First chunk emitted immediately, rest are batched (timer not yet fired)
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], "こ");

    // Flush the batch timer
    (orch as any).getInternalState().protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, the remaining 4 chunks are emitted as one combined chunk
    assert.strictEqual(streamChunks.length, 2);
    assert.strictEqual(streamChunks[1], "んにちは");
  });

  it("first chunk is immediate, subsequent are batched", () => {
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

    // First chunk emitted immediately
    assert.strictEqual(sessionMessages.length, 1);
    assert.strictEqual(sessionMessages[0].content, "Hello");

    // Flush batch timer
    (orch as any).getInternalState().protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, remaining chunks are one combined message
    assert.strictEqual(sessionMessages.length, 2);
    assert.strictEqual(sessionMessages[1].content, " World");
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

  it("handles character-by-character streaming — first immediate, rest batched", () => {
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

    // First char emitted immediately, rest are in the batch (timer not fired)
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], chars[0]);

    // Flush the batch timer
    (orch as any).getInternalState().protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, all remaining chars are emitted as one combined chunk
    assert.strictEqual(streamChunks.length, 2);
    assert.strictEqual(streamChunks[1], chars.slice(1).join(""));
  });

  it("handles mixed single-char and multi-char chunks", () => {
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

    // First chunk emitted immediately, rest are in the batch (timer not fired)
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], "Hel");

    // Flush the batch timer
    (orch as any).getInternalState().protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, remaining chunks are combined into one
    assert.strictEqual(streamChunks.length, 2);
    assert.strictEqual(streamChunks[1], "lo World!!!");
  });

  it("handles empty string chunks", () => {
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.isStreaming, true);
  });

  it("handles very long streaming text — batched delivery", () => {
    const longText = "a".repeat(100_000);
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

    // First chunk emitted immediately, rest are in the batch (timer not fired)
    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], longText.slice(0, chunkSize));

    // Flush the batch timer
    (orch as any).getInternalState().protocolHandler.flushAllBatches(agentId, sessionId);

    // After flush, all remaining chunks are emitted as one combined chunk
    assert.strictEqual(streamChunks.length, 2);
    assert.strictEqual(streamChunks[1], longText.slice(chunkSize));
    assert.strictEqual(streamChunks.join(""), longText);
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

  it("single large chunk produces one streamChunk event", () => {
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

    assert.strictEqual(streamChunks.length, 1);
    assert.strictEqual(streamChunks[0], fullText);
  });

  it("single large chunk produces one streamChunk event (goose-style)", () => {
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

    // Single chunk emitted immediately (first chunk of stream)
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

  it("handles agent_thought_chunk without creating a sessionMessage", () => {
    const sessionMessages: ChatMessage[] = [];
    const streamChunks: string[] = [];
    let streamStartEmitted = false;
    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });
    orch.on("sessionStreamChunk", (evt: any) => {
      streamChunks.push(evt.chunk);
    });
    orch.on("sessionStreamStart", () => {
      streamStartEmitted = true;
    });

    // Send thought chunk — buffered internally
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentThoughtChunkNotification(sessionId, "thinking...")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.isStreaming, true);
    assert.strictEqual(streamStartEmitted, true);
    // Thoughts are buffered — not yet delivered as sessionStreamChunk
    assert.strictEqual(sessionMessages.length, 0, "thought chunks should not create agent messages");
    assert.strictEqual(streamChunks.length, 0, "thoughts buffered, no stream chunks yet");

    // Sending agent_message_chunk flushes buffered thoughts + emits text
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "hello")
    );

    // Thoughts flushed as one chunk, then "hello" emitted immediately
    assert.strictEqual(streamChunks.length, 2);
    assert.strictEqual(streamChunks[0], "thinking...");
    assert.strictEqual(streamChunks[1], "hello");
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
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Hello from session 1")
    );
    // Send second chunk to session 1 — batched
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, " continued")
    );
    // Send first chunk to session 2 — starts streaming
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId2, "Hello from session 2")
    );

    // Session 1: first chunk immediate, second in batch
    assert.strictEqual(chunks1.length, 1);
    assert.strictEqual(chunks1[0], "Hello from session 1");
    // Session 2: first chunk immediate
    assert.strictEqual(chunks2.length, 1);
    assert.strictEqual(chunks2[0], "Hello from session 2");

    // Flush batch for session 1
    (orch as any).getInternalState().protocolHandler.flushAllBatches(agentId, sessionId);
    assert.strictEqual(chunks1.length, 2);
    assert.strictEqual(chunks1[1], " continued");
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

    assert.strictEqual(chunks1[0], "Agent 1 says hi");
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
