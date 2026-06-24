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
 * Reuses the existing agent session map so multiple sessions per agent work.
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
// codex-acp simulation: many small per-delta chunks
// ============================================================================

describe("Streaming Buffer — codex-acp (per-delta chunks)", () => {
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

  it("accumulates many small chunks into a single message", () => {
    const chunks = ["こ", "ん", "に", "ち", "は"];
    const receivedChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      receivedChunks.push(evt.chunk);
    });

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1, "should have exactly 1 message");
    assert.strictEqual(info.messages[0].content, "こんにちは");
    assert.strictEqual(info.messages[0].role, "agent");
  });

  it("emits sessionStreamChunk for every incoming chunk", () => {
    const chunks = ["Hello", " ", "World", "!"];
    const receivedChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      receivedChunks.push(evt.chunk);
    });

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    assert.deepStrictEqual(receivedChunks, ["Hello", " ", "World", "!"]);
  });

  it("does NOT emit sessionMessage for each chunk (only silent append)", () => {
    const sessionMessages: ChatMessage[] = [];
    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });

    const chunks = ["a", "b", "c"];
    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    assert.strictEqual(sessionMessages.length, 0);
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

  it("handles character-by-character streaming (Japanese text)", () => {
    const text = "今日は良い天気ですね";
    const chars = Array.from(text);
    const receivedChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      receivedChunks.push(evt.chunk);
    });

    for (const ch of chars) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, ch)
      );
    }

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1);
    assert.strictEqual(info.messages[0].content, text);
    assert.strictEqual(receivedChunks.length, chars.length);
  });

  it("handles mixed single-char and multi-char chunks", () => {
    const chunks = ["Hel", "lo", " ", "World", "!", "!", "!"];
    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1);
    assert.strictEqual(info.messages[0].content, "Hello World!!!");
  });
});

// ============================================================================
// goose simulation: fewer, larger chunks per Message event
// ============================================================================

describe("Streaming Buffer — goose (per-Message chunks)", () => {
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

  it("handles a single large chunk (whole message at once)", () => {
    const fullText =
      "Hello! I'm Goose, your AI assistant. How can I help you today?";
    const receivedChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      receivedChunks.push(evt.chunk);
    });

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, fullText)
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1);
    assert.strictEqual(info.messages[0].content, fullText);
    assert.deepStrictEqual(receivedChunks, [fullText]);
  });

  it("handles a few medium-sized chunks (sentence-by-sentence)", () => {
    const sentences = [
      "I'll help you with that. ",
      "Let me first read the file. ",
      "Then I'll make the necessary changes.",
    ];
    const receivedChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      receivedChunks.push(evt.chunk);
    });

    for (const s of sentences) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, s)
      );
    }

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1);
    assert.strictEqual(info.messages[0].content, sentences.join(""));
    assert.deepStrictEqual(receivedChunks, sentences);
  });

  it("handles two separate Message events (two turns)", () => {
    const receivedChunks: string[] = [];
    orch.on("sessionStreamChunk", (evt: any) => {
      receivedChunks.push(evt.chunk);
    });

    // First turn: single chunk
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "First response.")
    );

    // Simulate turn completion: clear buffer
    const sKey = `${agentId}:${sessionId}`;
    (orch as any).getInternalState().streamTextBuffer.delete(sKey);
    (orch as any).getInternalState().streamMsgRef.delete(sKey);

    // Second turn: another single chunk
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Second response.")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 2);
    assert.strictEqual(info.messages[0].content, "First response.");
    assert.strictEqual(info.messages[1].content, "Second response.");
  });
});

// ============================================================================
// copilot/junie simulation: standard ACP pattern
// ============================================================================

describe("Streaming Buffer — copilot/junie (standard ACP pattern)", () => {
  let orch: SessionOrchestrator;
  const agentId = "copilot";
  const sessionId = "sess-copilot-1";

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectRunningSession(orch, agentId, sessionId);
  });

  afterEach(() => {
    orch.dispose();
  });

  it("accumulates word-by-word chunks into one message", () => {
    const words = ["I", " can", " help", " with", " that."];
    const receivedChunks: string[] = [];

    orch.on("sessionStreamChunk", (evt: any) => {
      receivedChunks.push(evt.chunk);
    });

    for (const w of words) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, w)
      );
    }

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1);
    assert.strictEqual(info.messages[0].content, "I can help with that.");
  });

  it("handles code response with markdown", () => {
    const chunks = [
      "Here's the code:\n\n",
      "```typescript\n",
      "const x = 1;\n",
      "```\n\n",
      "Done!",
    ];

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1);
    assert.ok(info.messages[0].content.includes("```typescript"));
    assert.ok(info.messages[0].content.includes("const x = 1;"));
    assert.ok(info.messages[0].content.includes("Done!"));
  });
});

// ============================================================================
// Buffer lifecycle: cancel, dispose
// ============================================================================

describe("Streaming Buffer — lifecycle cleanup", () => {
  let orch: SessionOrchestrator;
  const agentId = "test-agent";
  const sessionId = "sess-lifecycle-1";

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectRunningSession(orch, agentId, sessionId);
  });

  afterEach(() => {
    orch.dispose();
  });

  it("clears buffer on cancel", () => {
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Hello ")
    );
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "World")
    );

    const sKey = `${agentId}:${sessionId}`;
    assert.ok((orch as any).getInternalState().streamTextBuffer.has(sKey));
    assert.ok((orch as any).getInternalState().streamMsgRef.has(sKey));

    orch.cancel(agentId, sessionId);

    assert.strictEqual((orch as any).getInternalState().streamTextBuffer.has(sKey), false);
    assert.strictEqual((orch as any).getInternalState().streamMsgRef.has(sKey), false);
  });

  it("clears all buffers on dispose", () => {
    // Inject a second session for the same agent
    injectRunningSession(orch, agentId, "sess-lifecycle-2");

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "text1")
    );
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification("sess-lifecycle-2", "text2")
    );

    assert.ok((orch as any).getInternalState().streamTextBuffer.size > 0);

    orch.dispose();

    assert.strictEqual((orch as any).getInternalState().streamTextBuffer.size, 0);
    assert.strictEqual((orch as any).getInternalState().streamMsgRef.size, 0);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("Streaming Buffer — edge cases", () => {
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

    assert.strictEqual(info.messages.length, 0);
  });

  it("ignores chunks with no text content (image content)", () => {
    const notification: SessionNotification = {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", data: "abc", mimeType: "image/png" },
      },
    } as any;

    (orch as any).handleSessionUpdate(agentId, notification);

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0);
  });

  it("handles empty string chunks gracefully", () => {
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0);
  });

  it("handles agent_thought_chunk without creating a message", () => {
    let streamStartEmitted = false;
    orch.on("sessionStreamStart", () => {
      streamStartEmitted = true;
    });

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentThoughtChunkNotification(sessionId, "thinking...")
    );

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0);
    assert.strictEqual(info.isStreaming, true);
    assert.strictEqual(streamStartEmitted, true);
  });

  it("maintains separate buffers for different sessions", () => {
    const sessionId2 = "sess-edge-2";
    injectRunningSession(orch, agentId, sessionId2);

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Hello from session 1")
    );
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId2, "Hello from session 2")
    );

    const info1 = orch.getSessionInfo(agentId, sessionId)!;
    const info2 = orch.getSessionInfo(agentId, sessionId2)!;

    assert.strictEqual(info1.messages.length, 1);
    assert.strictEqual(info2.messages.length, 1);
    assert.strictEqual(info1.messages[0].content, "Hello from session 1");
    assert.strictEqual(info2.messages[0].content, "Hello from session 2");
  });

  it("maintains separate buffers for different agents", () => {
    const agentId2 = "edge-agent-2";
    injectRunningSession(orch, agentId2, sessionId);

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Agent 1 says hi")
    );
    (orch as any).handleSessionUpdate(
      agentId2,
      makeAgentMessageChunkNotification(sessionId, "Agent 2 says hi")
    );

    const info1 = orch.getSessionInfo(agentId, sessionId)!;
    const info2 = orch.getSessionInfo(agentId2, sessionId)!;

    assert.strictEqual(info1.messages[0].content, "Agent 1 says hi");
    assert.strictEqual(info2.messages[0].content, "Agent 2 says hi");
  });

  it("handles very long streaming text without issues", () => {
    const longText = "a".repeat(100_000);
    const chunkSize = 100;
    const chunks: string[] = [];
    for (let i = 0; i < longText.length; i += chunkSize) {
      chunks.push(longText.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 1);
    assert.strictEqual(info.messages[0].content.length, 100_000);
    assert.strictEqual(info.messages[0].content, longText);
  });
});

// ============================================================================
// Integration: streaming + tool calls
// ============================================================================

describe("Streaming Buffer — interaction with tool calls", () => {
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

    // Send tool call first — should be buffered
    (orch as any).handleSessionUpdate(agentId, toolCallNotification);

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0);

    // Now send agent text — this should flush the buffered tool call
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Here's the result.")
    );

    const updatedInfo = orch.getSessionInfo(agentId, sessionId)!;
    // 1 tool message + 1 agent message
    assert.strictEqual(updatedInfo.messages.length, 2);
    assert.strictEqual(updatedInfo.messages[0].role, "tool");
    assert.strictEqual(updatedInfo.messages[1].role, "agent");
  });
});
