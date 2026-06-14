// ============================================================================
// PipelineExecutor tests
// ============================================================================

import { describe, it, beforeEach } from "mocha";
import * as assert from "assert";
import { PipelineExecutor } from "../../domain/services/pipeline-executor";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget } from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Mock SessionOrchestrator
// ----------------------------------------------------------------------------

interface MockOrchestrator {
  promptCalls: Array<{ agentId: string; sessionId: string; text: string }>;
  prompt: SessionOrchestrator["prompt"];
  getActiveSessionId: SessionOrchestrator["getActiveSessionId"];
  getAgentConfig: SessionOrchestrator["getAgentConfig"];
  getSessionsForAgent: SessionOrchestrator["getSessionsForAgent"];
}

function createMockOrchestrator(): MockOrchestrator {
  const calls: Array<{ agentId: string; sessionId: string; text: string }> = [];

  return {
    promptCalls: calls,
    prompt: async (agentId: string, sessionId: string, text: string) => {
      calls.push({ agentId, sessionId, text });
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
    executor = new PipelineExecutor({ sessionOrchestrator: orchestrator as unknown as SessionOrchestrator });
  });

  it("sends to all targets sequentially", async () => {
    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
      { agentId: "agent-c", sessionId: "s3", label: "C" },
    ];

    const result = await executor.execute(targets, "pipeline task");

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
    orchestrator.prompt = async (agentId: string, sessionId: string, text: string) => {
      orchestrator.promptCalls.push({ agentId, sessionId, text });
      if (agentId === "agent-b") throw new Error("Agent B unavailable");
      return undefined;
    };

    // Recreate executor with updated mock
    executor = new PipelineExecutor({ sessionOrchestrator: orchestrator as unknown as SessionOrchestrator });

    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
      { agentId: "agent-c", sessionId: "s3", label: "C" },
    ];

    const result = await executor.execute(targets, "test");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].status, "sent");
    assert.strictEqual(result.steps[1].status, "failed");
    assert.match(result.steps[1].error!, /Agent B unavailable/);
  });

  it("uses transformFn when provided", async () => {
    orchestrator.promptCalls.length = 0;
    executor = new PipelineExecutor({ sessionOrchestrator: orchestrator as unknown as SessionOrchestrator });

    const targets: SendTarget[] = [
      { agentId: "agent-a", sessionId: "s1", label: "A" },
      { agentId: "agent-b", sessionId: "s2", label: "B" },
    ];

    // transformFn is applied to each target: transformFn(lastResponse, target)
    // 1st call: lastResponse="initial" -> "initial -> transformed"
    // 2nd call: lastResponse="initial -> transformed" -> "initial -> transformed -> transformed"
    await executor.execute(targets, "initial", (last, _target) => {
      return `${last} -> transformed`;
    });

    assert.strictEqual(orchestrator.promptCalls[0].text, "initial -> transformed");
    assert.strictEqual(orchestrator.promptCalls[1].text, "initial -> transformed -> transformed");
  });

  it("returns success for empty targets", async () => {
    const result = await executor.execute([], "test");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 0);
  });
});
