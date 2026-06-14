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
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh.fanout");

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
   */
  async execute(
    targets: SendTarget[],
    payload: UserMessagePayload
  ): Promise<MultiSendResult> {
    log.info("fanout execute start", { targetCount: targets.length });

    const results = await Promise.all(
      targets.map((target) => this.sendToTarget(target, payload))
    );

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    log.info("fanout execute complete", { sent, failed });

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
    log.debug("sending to target", { agentId: target.agentId, sessionId: target.sessionId });

    try {
      await this.sessionOrchestrator.prompt(
        target.agentId,
        target.sessionId,
        payload.text
      );
      return { target, status: "sent" };
    } catch (e) {
      log.error("fanout target failed", { agentId: target.agentId, sessionId: target.sessionId }, e as Error);
      return {
        target,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
