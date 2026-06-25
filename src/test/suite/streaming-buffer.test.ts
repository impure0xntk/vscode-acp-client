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
// Batched delivery: text is buffered and flushed on turn completion
// ============================================================================

describe("Batched Delivery — agent_message_chunk buffered until turn end", () => {
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

  it("buffers many small chunks and flushes as single message on turn end", () => {
    const chunks = ["こ", "ん", "に", "ち", "は"];
    const sessionMessages: ChatMessage[] = [];

    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    // Before turn end: no messages emitted yet
    const infoBefore = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(infoBefore.messages.length, 0, "no messages before turn end");

    // Simulate turn completion by calling flushPendingAgentText
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    // After turn end: single message with all text
    assert.strictEqual(sessionMessages.length, 1);
    assert.strictEqual(sessionMessages[0].content, "こんにちは");
    assert.strictEqual(sessionMessages[0].role, "agent");
  });

  it("does NOT emit sessionMessage during streaming (only on flush)", () => {
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

    assert.strictEqual(sessionMessages.length, 0, "no messages emitted during streaming");
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
    const sessionMessages: ChatMessage[] = [];

    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });

    for (const ch of chars) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, ch)
      );
    }

    // Before flush: no messages
    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0);

    // Flush
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    assert.strictEqual(sessionMessages.length, 1);
    assert.strictEqual(sessionMessages[0].content, text);
  });

  it("handles mixed single-char and multi-char chunks", () => {
    const chunks = ["Hel", "lo", " ", "World", "!", "!", "!"];
    const sessionMessages: ChatMessage[] = [];

    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });

    for (const chunk of chunks) {
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    // Flush
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    assert.strictEqual(sessionMessages.length, 1);
    assert.strictEqual(sessionMessages[0].content, "Hello World!!!");
  });

  it("handles empty string chunks without creating a message", () => {
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "")
    );

    // Flush
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0);
  });

  it("handles very long streaming text without issues", () => {
    const longText = "a".repeat(100_000);
    const chunkSize = 100;
    const sessionMessages: ChatMessage[] = [];

    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });

    for (let i = 0; i < longText.length; i += chunkSize) {
      const chunk = longText.slice(i, i + chunkSize);
      (orch as any).handleSessionUpdate(
        agentId,
        makeAgentMessageChunkNotification(sessionId, chunk)
      );
    }

    // Flush
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    assert.strictEqual(sessionMessages.length, 1);
    assert.strictEqual(sessionMessages[0].content.length, 100_000);
    assert.strictEqual(sessionMessages[0].content, longText);
  });
});

// ============================================================================
// Goose-style: single large chunk per turn
// ============================================================================

describe("Batched Delivery — goose-style (single large chunk)", () => {
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
    const sessionMessages: ChatMessage[] = [];

    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });

    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, fullText)
    );

    // Flush
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    assert.strictEqual(sessionMessages.length, 1);
    assert.strictEqual(sessionMessages[0].content, fullText);
  });

  it("handles two separate turns", () => {
    const sessionMessages: ChatMessage[] = [];
    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });

    // First turn: single chunk
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "First response.")
    );
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    // Second turn: another single chunk
    (orch as any).handleSessionUpdate(
      agentId,
      makeAgentMessageChunkNotification(sessionId, "Second response.")
    );
    ph.flushPendingAgentText(agentId, sessionId);

    assert.strictEqual(sessionMessages.length, 2);
    assert.strictEqual(sessionMessages[0].content, "First response.");
    assert.strictEqual(sessionMessages[1].content, "Second response.");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("Batched Delivery — edge cases", () => {
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

    // Flush
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

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

    // Flush
    const ph = (orch as any).getInternalState().protocolHandler;
    ph.flushPendingAgentText(agentId, sessionId);

    const info = orch.getSessionInfo(agentId, sessionId)!;
    assert.strictEqual(info.messages.length, 0);
  });

  it("handles agent_thought_chunk without creating a message", () => {
    const sessionMessages: ChatMessage[] = [];
    let streamStartEmitted = false;
    orch.on("sessionMessage", (evt: any) => {
      sessionMessages.push(evt.message);
    });
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
    assert.strictEqual(sessionMessages.length, 0, "thought chunks should not create messages");
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

    // Flush both — collect emitted messages and append them
    const ph = (orch as any).getInternalState().protocolHandler;
    const emitted1: ChatMessage[] = [];
    const emitted2: ChatMessage[] = [];
    orch.on("sessionMessage", (evt: any) => {
      if (evt.sessionId === sessionId) emitted1.push(evt.message);
      if (evt.sessionId === sessionId2) emitted2.push(evt.message);
    });
    ph.flushPendingAgentText(agentId, sessionId);
    ph.flushPendingAgentText(agentId, sessionId2);

    // Append emitted messages to session info (simulating what the handler does)
    const info1 = orch.getSessionInfo(agentId, sessionId)!;
    const info2 = orch.getSessionInfo(agentId, sessionId2)!;
    for (const msg of emitted1) info1.messages.push(msg);
    for (const msg of emitted2) info2.messages.push(msg);

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

    // Flush both — collect emitted messages and append them
    const ph = (orch as any).getInternalState().protocolHandler;
    const emitted1: ChatMessage[] = [];
    const emitted2: ChatMessage[] = [];
    orch.on("sessionMessage", (evt: any) => {
      if (evt.agentId === agentId) emitted1.push(evt.message);
      if (evt.agentId === agentId2) emitted2.push(evt.message);
    });
    ph.flushPendingAgentText(agentId, sessionId);
    ph.flushPendingAgentText(agentId2, sessionId);

    // Append emitted messages to session info (simulating what the handler does)
    const info1 = orch.getSessionInfo(agentId, sessionId)!;
    const info2 = orch.getSessionInfo(agentId2, sessionId)!;
    for (const msg of emitted1) info1.messages.push(msg);
    for (const msg of emitted2) info2.messages.push(msg);

    assert.strictEqual(info1.messages[0].content, "Agent 1 says hi");
    assert.strictEqual(info2.messages[0].content, "Agent 2 says hi");
  });
});

// ============================================================================
// Integration: streaming + tool calls
// ============================================================================

describe("Batched Delivery — interaction with tool calls", () => {
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
    // 1 tool message + 0 agent message (not flushed yet)
    assert.strictEqual(updatedInfo.messages.length, 1);
    assert.strictEqual(updatedInfo.messages[0].role, "tool");

    // Flush agent text — collect emitted messages and append them
    const ph = (orch as any).getInternalState().protocolHandler;
    const emitted: ChatMessage[] = [];
    orch.on("sessionMessage", (evt: any) => {
      emitted.push(evt.message);
    });
    ph.flushPendingAgentText(agentId, sessionId);

    const finalInfo = orch.getSessionInfo(agentId, sessionId)!;
    for (const msg of emitted) finalInfo.messages.push(msg);

    assert.strictEqual(finalInfo.messages.length, 2);
    assert.strictEqual(finalInfo.messages[1].role, "agent");
  });
});
