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

interface MockOrchestrator {
  promptCalls: Array<{ agentId: string; sessionId: string; text: string }>;
  prompt: (agentId: string, sessionId: string, text: string, context?: PromptContext) => Promise<QueuedPrompt | undefined>;
  getActiveSessionId: (agentId: string) => string | undefined;
  getAgentConfig: (agentId: string) => undefined;
  getSessionsForAgent: (agentId: string) => [];
}

function createMockOrchestrator(): MockOrchestrator {
  const calls: Array<{ agentId: string; sessionId: string; text: string }> = [];

  const mock: MockOrchestrator = {
    promptCalls: calls,
    prompt: async (agentId: string, sessionId: string, text: string, _context?: PromptContext) => {
      calls.push({ agentId, sessionId, text });
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
    orchestrator.prompt = async (agentId: string, sessionId: string, text: string, _context?: PromptContext) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
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
});
