// ============================================================================
// FanoutExecutor — parallel message delivery to multiple agents
//
// refs: docs/mesh-orchestrator-integration-design.md Section 4
// ============================================================================

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type {
  SendTarget,
  MultiSendResult,
  UserMessagePayload,
} from "../models/mesh";
import type { ChatMessage, ContextAttachmentDTO } from "../../domain/models/chat";
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh.fanout");

// ----------------------------------------------------------------------------
// PushUserMessage — callback to display user message in target chat
// ----------------------------------------------------------------------------

export type PushUserMessageFn = (
  agentId: string,
  sessionId: string,
  message: ChatMessage,
) => void;

// ----------------------------------------------------------------------------
// Dependencies
// ----------------------------------------------------------------------------

export interface FanoutExecutorDeps {
  sessionOrchestrator: SessionOrchestrator;
  /** Callback to push user message into the target session chat UI */
  pushUserMessage: PushUserMessageFn;
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
    payload: UserMessagePayload
  ): Promise<MultiSendResult> {
    const targetDesc = targets.map((t) => `${t.agentId}:${t.sessionId}`).join(", ");
    log.info("fanout execute start", {
      targetCount: targets.length,
      targets: targetDesc,
    });

    const results = await Promise.all(
      targets.map((target) => this.sendToTarget(target, payload))
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
    payload: UserMessagePayload
  ): Promise<FanoutResult> {
    log.info("sending to target", { agentId: target.agentId, sessionId: target.sessionId });

    try {
      const rawAttachments = payload.attachments ?? [];
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: payload.text,
        timestamp: Date.now(),
        attachmentsJson:
          rawAttachments.length > 0
            ? JSON.stringify(rawAttachments)
            : undefined,
      };
      this.pushUserMessage(target.agentId, target.sessionId, userMessage);

      // Convert attachments to ACP ContentBlock[] for the agent prompt
      const context: ContentBlock[] = [];
      for (const att of (payload.attachments ?? []) as ContextAttachmentDTO[]) {
        if (!att.path) continue;
        context.push({
          type: "resource",
          resource: {
            uri: `file://${att.path}`,
            mimeType: "text/plain",
            text: att.content,
          },
        });
      }

      await this.sessionOrchestrator.prompt(
        target.agentId,
        target.sessionId,
        payload.text,
        context
      );
      return { target, status: "sent" };
    } catch (e) {
      log.error("fanout target failed", {
        agentId: target.agentId,
        sessionId: target.sessionId,
        error: e instanceof Error ? e.message : String(e),
      }, e as Error);
      return {
        target,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
