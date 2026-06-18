// ============================================================================
// FanoutExecutor — parallel message delivery to multiple agents
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4
//
// Design notes:
//   - No dependency on @agentclientprotocol/sdk. All ACP ContentBlock
//     conversion happens in the caller (MeshOrchestrator).
//   - Depends only on SessionOrchestrator (prompt + pushUserMessage).
//   - Pure parallel sender: fire-and-forget per target, no response waiting.
// ============================================================================

import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { PromptContext } from "../../application/session/orchestrator";
import type { SendTarget, MultiSendResult } from "../models/mesh";
import type { ChatMessage } from "../../domain/models/chat";
import type { ContextAttachmentDTO } from "../../domain/models/chat";
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh.fanout");

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export type PushUserMessageFn = (
  agentId: string,
  sessionId: string,
  message: ChatMessage
) => void;

export interface FanoutExecutorDeps {
  sessionOrchestrator: SessionOrchestrator;
  /** Callback to push user message into the target session chat UI */
  pushUserMessage: PushUserMessageFn;
}

// ----------------------------------------------------------------------------
// Input — what the caller provides per fanout request
// ----------------------------------------------------------------------------

export interface FanoutRequest {
  text: string;
  /** Pre-built ACP context blocks (attachments already converted) */
  context: PromptContext;
  /** Original attachment DTOs for UI echo (passed through to pushUserMessage) */
  attachments?: ContextAttachmentDTO[];
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
  private pushUserMessage: PushUserMessageFn;

  constructor(deps: FanoutExecutorDeps) {
    this.sessionOrchestrator = deps.sessionOrchestrator;
    this.pushUserMessage = deps.pushUserMessage;
  }

  /**
   * Send a single message to multiple targets in parallel.
   * Each target is a (agentId, sessionId) pair.
   * Returns results for each target without waiting for agent responses.
   */
  async execute(
    targets: SendTarget[],
    request: FanoutRequest
  ): Promise<MultiSendResult> {
    const targetDesc = targets
      .map((t) => `${t.agentId}:${t.sessionId}`)
      .join(", ");
    log.info("fanout execute start", {
      targetCount: targets.length,
      targets: targetDesc,
    });

    const results = await Promise.all(
      targets.map((target) => this.sendToTarget(target, request))
    );

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    log.info("fanout execute complete", { sent, failed, targets: targetDesc });

    return { results };
  }

  /**
   * Send to a single target. Fire-and-forget: the agent response will
   * arrive via the normal streaming pipeline in SessionOrchestrator.
   */
  private async sendToTarget(
    target: SendTarget,
    request: FanoutRequest
  ): Promise<FanoutResult> {
    log.info("sending to target", {
      agentId: target.agentId,
      sessionId: target.sessionId,
    });

    try {
      this.pushUserMessage(target.agentId, target.sessionId, {
        id: crypto.randomUUID(),
        role: "user",
        content: request.text,
        timestamp: Date.now(),
        attachments: request.attachments,
        attachmentsJson: request.attachments?.length
          ? JSON.stringify(request.attachments)
          : undefined,
      });

      await this.sessionOrchestrator.prompt(
        target.agentId,
        target.sessionId,
        request.text,
        request.context
      );
      return { target, status: "sent" };
    } catch (e) {
      log.error(
        "fanout target failed",
        {
          agentId: target.agentId,
          sessionId: target.sessionId,
          error: e instanceof Error ? e.message : String(e),
        },
        e as Error
      );
      return {
        target,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
