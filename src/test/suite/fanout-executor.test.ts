// ============================================================================
// FanoutExecutor tests
// ============================================================================

import { describe, it, beforeEach } from "mocha";
import * as assert from "assert";
import { FanoutExecutor } from "../../domain/services/fanout-executor";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget, UserMessagePayload } from "../../domain/models/mesh";
import type { PromptContext } from "../../application/session/orchestrator";
import type { QueuedPrompt } from "../../application/session/types";
import type { ChatMessage } from "../../domain/models/chat";

// ----------------------------------------------------------------------------
// Mock SessionOrchestrator
// ----------------------------------------------------------------------------

interface PromptCall {
  agentId: string;
  sessionId: string;
  text: string;
  context?: PromptContext;
}

interface MockOrchestrator {
  promptCalls: PromptCall[];
  prompt: (agentId: string, sessionId: string, text: string, context?: PromptContext) => Promise<QueuedPrompt | undefined>;
  getActiveSessionId: (agentId: string) => string | undefined;
  getAgentConfig: (agentId: string) => undefined;
  getSessionsForAgent: (agentId: string) => [];
}

function createMockOrchestrator(): MockOrchestrator {
  const calls: PromptCall[] = [];

  const mock: MockOrchestrator = {
    promptCalls: calls,
    prompt: async (agentId: string, sessionId: string, text: string, context?: PromptContext) => {
      calls.push({ agentId, sessionId, text, context });
      return undefined;
    },
    getActiveSessionId: (_agentId: string) => "session-1",
    getAgentConfig: (_agentId: string) => undefined,
    getSessionsForAgent: (_agentId: string) => [],
  };

  return mock;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("FanoutExecutor", () => {
  let orchestrator: MockOrchestrator;
  let executor: FanoutExecutor;
  let pushCalls: Array<{ agentId: string; sessionId: string; message: ChatMessage }>;

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
    pushCalls = [];
    executor = new FanoutExecutor({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
      pushUserMessage: (agentId: string, sessionId: string, message: ChatMessage) => {
        pushCalls.push({ agentId, sessionId, message });
      },
    });
  });

  it("sends to all targets in parallel", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "Agent A" },
      { agentId: "agent-b", sessionId: "s2", label: "Agent B" },
      { agentId: "agent-c", sessionId: "s3", label: "Agent C" },
    ];
    const payload: UserMessagePayload = { text: "Hello all" };

    const result = await executor.execute(targets, payload);

    assert.strictEqual(result.results.length, 3);
    assert.strictEqual(result.results[0].status, "sent");
    assert.strictEqual(result.results[1].status, "sent");
    assert.strictEqual(result.results[2].status, "sent");

    assert.strictEqual(orchestrator.promptCalls.length, 3);
    assert.strictEqual(orchestrator.promptCalls[0].agentId, "agent-a");
    assert.strictEqual(orchestrator.promptCalls[1].agentId, "agent-b");
    assert.strictEqual(orchestrator.promptCalls[2].agentId, "agent-c");
  });

  it("returns empty results for empty targets", async () => {
    const result = await executor.execute([], { text: "test" });
    assert.strictEqual(result.results.length, 0);
  });

  it("handles single target", async () => {
    const targets: SendTarget[] = [
      { agentId: "solo", sessionId: "s1", label: "Solo" },
    ];
    const result = await executor.execute(targets, { text: "Just you" });

    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].status, "sent");
    assert.strictEqual(orchestrator.promptCalls[0].text, "Just you");
  });

  it("calls pushUserMessage for each target before prompting", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
    ];
    const payload: UserMessagePayload = { text: "Hello" };

    await executor.execute(targets, payload);

    assert.strictEqual(pushCalls.length, 2);
    assert.strictEqual(pushCalls[0].agentId, "agent-a");
    assert.strictEqual(pushCalls[0].sessionId, "s1");
    assert.strictEqual(pushCalls[0].message.role, "user");
    assert.strictEqual(pushCalls[0].message.content, "Hello");
    assert.strictEqual(pushCalls[1].agentId, "agent-b");
    assert.strictEqual(pushCalls[1].sessionId, "s2");
    assert.strictEqual(pushCalls[1].message.role, "user");
  });

  it("captures errors per target without failing the batch", async () => {
    orchestrator.prompt = async (agentId: string, sessionId: string, text: string, context?: PromptContext) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text, context });
      if (agentId === "agent-b") throw new Error("Connection refused");
      return undefined;
    };

    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
    ];
    const result = await executor.execute(targets, { text: "test" });

    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.results[0].status, "sent");
    assert.strictEqual(result.results[1].status, "failed");
    assert.match(result.results[1].error!, /Connection refused/);
  });

  // --------------------------------------------------------------------------
  // Attachment tests
  // --------------------------------------------------------------------------

  it("passes file attachments as resource ContentBlocks in context", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
    ];
    const payload: UserMessagePayload = {
      text: "Review this file",
      attachments: [
        {
          id: "att-1",
          type: "file",
          path: "/workspace/src/foo.ts",
          label: "foo.ts",
          tokenCount: 100,
          content: "const x = 1;",
        },
      ],
    };

    await executor.execute(targets, payload);

    assert.strictEqual(orchestrator.promptCalls.length, 1);
    const ctx = orchestrator.promptCalls[0].context;
    assert.ok(ctx, "context should be present");
    assert.strictEqual(ctx!.length, 1);
    assert.strictEqual(ctx![0].type, "resource");
    const resource = (ctx![0] as { resource: { uri: string; text: string } }).resource;
    assert.strictEqual(resource.uri, "file:///workspace/src/foo.ts");
    assert.strictEqual(resource.text, "const x = 1;");
  });

  it("passes multiple attachments as multiple resource blocks", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
    ];
    const payload: UserMessagePayload = {
      text: "Review these",
      attachments: [
        {
          id: "att-1",
          type: "file",
          path: "/workspace/a.ts",
          label: "a.ts",
          tokenCount: 50,
          content: "file A",
        },
        {
          id: "att-2",
          type: "selection",
          path: "/workspace/b.ts",
          label: "b.ts:10-20",
          lineRange: [10, 20],
          tokenCount: 30,
          content: "selected text",
        },
      ],
    };

    await executor.execute(targets, payload);

    const ctx = orchestrator.promptCalls[0].context;
    assert.strictEqual(ctx!.length, 2);
    const r0 = (ctx![0] as { resource: { uri: string; text: string } }).resource;
    const r1 = (ctx![1] as { resource: { uri: string; text: string } }).resource;
    assert.strictEqual(r0.uri, "file:///workspace/a.ts");
    assert.strictEqual(r0.text, "file A");
    assert.strictEqual(r1.uri, "file:///workspace/b.ts");
    assert.strictEqual(r1.text, "selected text");
  });

  it("passes empty context when no attachments", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
    ];
    const payload: UserMessagePayload = { text: "Hello" };

    await executor.execute(targets, payload);

    const ctx = orchestrator.promptCalls[0].context;
    assert.ok(ctx);
    assert.strictEqual(ctx!.length, 0);
  });

  it("passes empty context when attachments is empty array", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
    ];
    const payload: UserMessagePayload = { text: "Hello", attachments: [] };

    await executor.execute(targets, payload);

    const ctx = orchestrator.promptCalls[0].context;
    assert.ok(ctx);
    assert.strictEqual(ctx!.length, 0);
  });

  it("propagates attachments to all targets in multi-target send", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
    ];
    const payload: UserMessagePayload = {
      text: "Review this",
      attachments: [
        {
          id: "att-1",
          type: "file",
          path: "/workspace/shared.ts",
          label: "shared.ts",
          tokenCount: 80,
          content: "shared content",
        },
      ],
    };

    await executor.execute(targets, payload);

    assert.strictEqual(orchestrator.promptCalls.length, 2);
    for (let i = 0; i < 2; i++) {
      const ctx = orchestrator.promptCalls[i].context;
      assert.ok(ctx, `context for call ${i} should be present`);
      assert.strictEqual(ctx!.length, 1);
      const resource = (ctx![0] as { resource: { uri: string; text: string } }).resource;
      assert.strictEqual(resource.uri, "file:///workspace/shared.ts");
      assert.strictEqual(resource.text, "shared content");
    }
  });

  it("skips attachments with empty path", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
    ];
    const payload: UserMessagePayload = {
      text: "Review",
      attachments: [
        {
          id: "att-1",
          type: "file",
          path: "",
          label: "empty-path",
          tokenCount: 0,
          content: "no path",
        },
        {
          id: "att-2",
          type: "file",
          path: "/workspace/valid.ts",
          label: "valid.ts",
          tokenCount: 40,
          content: "valid content",
        },
      ],
    };

    await executor.execute(targets, payload);

    const ctx = orchestrator.promptCalls[0].context;
    assert.strictEqual(ctx!.length, 1);
    const resource = (ctx![0] as { resource: { uri: string; text: string } }).resource;
    assert.strictEqual(resource.uri, "file:///workspace/valid.ts");
  });
});
