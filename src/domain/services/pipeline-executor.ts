// ============================================================================
// PipelineExecutor — sequential message delivery across agents
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4
// ============================================================================

import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SendTarget } from "../models/mesh";

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export interface PipelineExecutorDeps {
  sessionOrchestrator: SessionOrchestrator;
}

// ----------------------------------------------------------------------------
// Result types
// ----------------------------------------------------------------------------

export interface PipelineStepResult {
  target: SendTarget;
  status: "sent" | "completed" | "failed";
  error?: string;
}

export interface PipelineResult {
  steps: PipelineStepResult[];
  /** Overall pipeline succeeded (all steps at least sent) */
  success: boolean;
}

// ----------------------------------------------------------------------------
// PipelineExecutor
// ----------------------------------------------------------------------------

export class PipelineExecutor {
  private sessionOrchestrator: SessionOrchestrator;

  constructor(deps: PipelineExecutorDeps) {
    this.sessionOrchestrator = deps.sessionOrchestrator;
  }

  /**
   * Execute a pipeline: send initial prompt to first agent, wait for
   * completion, then forward the response to the next agent, etc.
   *
   * Note: This is a simplified version. Full implementation would
   * intercept responses between stages. Current implementation sends
   * sequentially and returns send confirmation (not full responses).
   */
  async execute(
    targets: SendTarget[],
    initialText: string,
    transformFn?: (lastResponse: string, nextTarget: SendTarget) => string
  ): Promise<PipelineResult> {
    const steps: PipelineStepResult[] = [];
    let lastResponse = initialText;

    for (const target of targets) {
      const text = transformFn
        ? transformFn(lastResponse, target)
        : lastResponse;

      try {
        // Await each prompt to ensure it was accepted and maintain ordering.
        // Responses arrive via streaming pipeline; await only catches errors.
        await this.sessionOrchestrator.prompt(
          target.agentId,
          target.sessionId,
          text
        );
        steps.push({ target, status: "sent" });
        // Update lastResponse for next iteration's transformFn
        lastResponse = text;
      } catch (e) {
        steps.push({
          target,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
        return { steps, success: false };
      }
    }

    return { steps, success: true };
  }
}
