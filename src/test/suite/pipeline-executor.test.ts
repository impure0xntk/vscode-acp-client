// ============================================================================
// PipelineExecutor tests
// ============================================================================

import { describe, it, beforeEach } from "mocha";
import * as assert from "assert";
import { PipelineExecutor } from "../../domain/services/pipeline-executor";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget } from "../../domain/models/mesh";
import type { PromptContext } from "../../application/session/orchestrator";

// ----------------------------------------------------------------------------
// Mock SessionOrchestrator
// ----------------------------------------------------------------------------

interface MockOrchestrator {
  promptCalls: Array<{
    agentId: string;
    sessionId: string;
    text: string;
    context?: PromptContext;
  }>;
  prompt: SessionOrchestrator["prompt"];
  getActiveSessionId: SessionOrchestrator["getActiveSessionId"];
  getAgentConfig: SessionOrchestrator["getAgentConfig"];
  getSessionsForAgent: SessionOrchestrator["getSessionsForAgent"];
}

function createMockOrchestrator(): MockOrchestrator {
  const calls: Array<{
    agentId: string;
    sessionId: string;
    text: string;
    context?: PromptContext;
  }> = [];

  return {
    promptCalls: calls,
    prompt: async (
      agentId: string,
      sessionId: string,
      text: string,
      context?: PromptContext
    ) => {
      calls.push({ agentId, sessionId, text, context });
      return undefined;
    },
    getActiveSessionId: (_agentId: string) => "session-1",
    getAgentConfig: (_agentId: string) => undefined,
    getSessionsForAgent: (_agentId: string) => [],
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("PipelineExecutor", () => {
  let orchestrator: MockOrchestrator;
  let executor: PipelineExecutor;

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
    executor = new PipelineExecutor({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
    });
  });

  it("sends to all targets sequentially", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
      { agentId: "agent-c", sessionId: "s3", label: "C" },
    ];

    const result = await executor.execute(targets, {
      text: "pipeline task",
      context: [],
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 3);
    assert.strictEqual(result.steps[0].status, "sent");
    assert.strictEqual(result.steps[1].status, "sent");
    assert.strictEqual(result.steps[2].status, "sent");

    assert.strictEqual(orchestrator.promptCalls[0].agentId, "agent-a");
    assert.strictEqual(orchestrator.promptCalls[1].agentId, "agent-b");
    assert.strictEqual(orchestrator.promptCalls[2].agentId, "agent-c");
  });

  it("stops on first failure", async () => {
    orchestrator.promptCalls.length = 0;
    orchestrator.prompt = async (
      agentId: string,
      sessionId: string,
      text: string,
      context?: PromptContext
    ) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text, context });
      if (agentId === "agent-b") throw new Error("Agent B unavailable");
      return undefined;
    };

    // Recreate executor with updated mock
    executor = new PipelineExecutor({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
    });

    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
      { agentId: "agent-c", sessionId: "s3", label: "C" },
    ];

    const result = await executor.execute(targets, {
      text: "test",
      context: [],
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].status, "sent");
    assert.strictEqual(result.steps[1].status, "failed");
    assert.match(result.steps[1].error!, /Agent B unavailable/);
  });

  it("uses transformFn when provided", async () => {
    orchestrator.promptCalls.length = 0;
    executor = new PipelineExecutor({
      sessionOrchestrator: orchestrator as unknown as SessionOrchestrator,
    });

    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
    ];

    await executor.execute(
      targets,
      { text: "initial", context: [] },
      (last, _target) => {
        return `${last} -> transformed`;
      }
    );

    assert.strictEqual(
      orchestrator.promptCalls[0].text,
      "initial -> transformed"
    );
    assert.strictEqual(
      orchestrator.promptCalls[1].text,
      "initial -> transformed -> transformed"
    );
  });

  it("returns success for empty targets", async () => {
    const result = await executor.execute([], { text: "test", context: [] });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 0);
  });

  it("passes context to each target", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
    ];
    const context: PromptContext = [
      {
        type: "resource",
        resource: {
          uri: "file:///workspace/shared.ts",
          mimeType: "text/plain",
          text: "shared content",
        },
      },
    ];

    await executor.execute(targets, { text: "Review", context });

    assert.strictEqual(orchestrator.promptCalls.length, 2);
    for (let i = 0; i < 2; i++) {
      const ctx = orchestrator.promptCalls[i].context;
      assert.ok(ctx, `context for call ${i} should be present`);
      assert.strictEqual(ctx!.length, 1);
    }
  });
});
