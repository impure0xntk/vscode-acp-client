// ============================================================================
// FanoutExecutor — parallel message delivery to multiple agents
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4
// ============================================================================

import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type {
  SendTarget,
  MultiSendResult,
  UserMessagePayload,
} from "../models/mesh";

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export interface FanoutExecutorDeps {
  sessionOrchestrator: SessionOrchestrator;
}

// ----------------------------------------------------------------------------
// Result types
// ----------------------------------------------------------------------------

export interface FanoutResult {
  target: SendTarget;
  status: "sent" | "failed";
  error?: string;
}

// ----------------------------------------------------------------------------
// FanoutExecutor
// ----------------------------------------------------------------------------

export class FanoutExecutor {
  private sessionOrchestrator: SessionOrchestrator;

  constructor(deps: FanoutExecutorDeps) {
    this.sessionOrchestrator = deps.sessionOrchestrator;
  }

  /**
   * Send a single message to multiple targets in parallel.
   * Each target is a (agentId, sessionId) pair.
   * Returns results for each target without waiting for agent responses.
   * Responses arrive via the normal streaming pipeline in SessionOrchestrator.
   */
  async execute(
    targets: SendTarget[],
    payload: UserMessagePayload
  ): Promise<MultiSendResult> {
    const results = await Promise.all(
      targets.map((target) => this.sendToTarget(target, payload))
    );
    return { results };
  }

  /**
   * Send to a single target. Fire-and-forget: the agent response will
   * arrive via the normal streaming pipeline in SessionOrchestrator.
   */
  private async sendToTarget(
    target: SendTarget,
    payload: UserMessagePayload
  ): Promise<FanoutResult> {
    try {
      // Await the prompt to catch synchronous errors (e.g. agent not connected).
      // The actual agent response arrives via streaming callbacks, but we need
      // to ensure the prompt was accepted before reporting success.
      await this.sessionOrchestrator.prompt(
        target.agentId,
        target.sessionId,
        payload.text
      );
      return { target, status: "sent" };
    } catch (e) {
      return {
        target,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
