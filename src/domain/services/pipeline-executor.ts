// ============================================================================
// PipelineExecutor — sequential message delivery across agents
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4
//
// Design notes:
//   - No dependency on @agentclientprotocol/sdk.
//   - Receives pre-built PromptContext from the caller.
// ============================================================================

import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { PromptContext } from "../../application/session/orchestrator";
import type { SendTarget } from "../models/mesh";
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh.pipeline");

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export interface PipelineExecutorDeps {
  sessionOrchestrator: SessionOrchestrator;
}

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

export interface PipelineRequest {
  text: string;
  /** Pre-built ACP context blocks (attachments already converted) */
  context: PromptContext;
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
   * Execute a pipeline: send sequentially through a chain of targets.
   * Each agent receives the same text + context.
   */
  async execute(
    targets: SendTarget[],
    request: PipelineRequest,
    transformFn?: (lastResponse: string, nextTarget: SendTarget) => string
  ): Promise<PipelineResult> {
    const steps: PipelineStepResult[] = [];
    let lastResponse = request.text;

    log.info("pipeline execute start", { targetCount: targets.length });

    for (const target of targets) {
      const text = transformFn
        ? transformFn(lastResponse, target)
        : lastResponse;

      log.debug("pipeline step", {
        agentId: target.agentId,
        sessionId: target.sessionId,
      });

      try {
        await this.sessionOrchestrator.prompt(
          target.agentId,
          target.sessionId,
          text,
          request.context
        );
        steps.push({ target, status: "sent" });
        lastResponse = text;
      } catch (e) {
        log.error(
          "pipeline step failed",
          {
            agentId: target.agentId,
            sessionId: target.sessionId,
          },
          e as Error
        );
        steps.push({
          target,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
        log.warn("pipeline execute aborted", {
          completedSteps: steps.length - 1,
          totalTargets: targets.length,
        });
        return { steps, success: false };
      }
    }

    log.info("pipeline execute complete", { steps: steps.length });
    return { steps, success: true };
  }
}
