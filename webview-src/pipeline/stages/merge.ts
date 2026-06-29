import type { ClassifiedMessage, MergeConfig } from "../types";
import type { ToolCall } from "../../types";

/**
 * Merging strategy that absorbs tool messages into the preceding agent message.
 *
 * Tool messages are merged (absorbed) into the preceding agent message's
 * toolCalls array. This implements the desired step boundary semantics:
 * "once a tool call comes, merge tokens after it until interrupted; after
 * interruption, subsequent tokens form the next step."
 *
 * The step boundary is controlled by __stepBoundary in the message store:
 * - When a NEW tool_call arrives at the message store, closeCurrentAgentMessage()
 *   marks the preceding agent message with __stepBoundary=true.
 * - The merge stage sees __stepBoundary on agent messages and starts a new step.
 *
 * Only "info" classified messages participate in merging.
 * System-kind messages (compression, mode_change, etc.) pass through and
 * reset the merge state — they act as grouping boundaries.
 */
export class ToolMergeStrategy {
  /** The last agent message that tool calls should be absorbed into. */
  private pendingAgent: ClassifiedMessage | null = null;

  /**
   * Merge tool messages — absorb tool messages into the preceding agent message.
   */
  merge(messages: ClassifiedMessage[], _config: MergeConfig): ClassifiedMessage[] {
    const result: ClassifiedMessage[] = [];
    this.pendingAgent = null;

    for (const msg of messages) {
      // Non-info messages pass through and reset merge state (grouping boundary).
      if (msg.systemKind !== "info") {
        this.flushPending(result);
        result.push(msg);
        continue;
      }

      if (msg.role === "tool") {
        // Absorb tool calls into the pending agent message (or create a
        // standalone tool entry if no agent message precedes it).
        if (this.pendingAgent) {
          this.absorbToolCalls(this.pendingAgent, msg);
        } else {
          // No preceding agent message — emit as a standalone tool entry.
          result.push(msg);
        }
      } else if (msg.role === "agent") {
        this.flushPending(result);
        // If the preceding agent has __stepBoundary, this agent starts a new step.
        // We keep them as separate entries — the grouping stage handles step splitting.
        result.push(msg);
        // Always set as pending agent for subsequent tool absorption.
        // __stepBoundary controls whether the NEXT agent message is consecutive,
        // not whether tool calls are absorbed into this agent.
        this.pendingAgent = msg;
      } else {
        // Any other message — pass through.
        this.flushPending(result);
        result.push(msg);
      }
    }

    this.flushPending(result);
    return result;
  }

  /**
   * Absorb tool message's toolCalls into the pending agent message.
   */
  private absorbToolCalls(agent: ClassifiedMessage, toolMsg: ClassifiedMessage): void {
    const existingCalls = agent.toolCalls ?? [];
    const newCalls = toolMsg.toolCalls ?? [];
    agent.toolCalls = [...existingCalls, ...newCalls];
  }

  private flushPending(result: ClassifiedMessage[]): void {
    // No-op: tool calls are absorbed in-place into the agent message.
    this.pendingAgent = null;
  }
}

/**
 * Functional wrapper around ToolMergeStrategy.
 * Maintains backward compatibility with the existing pipeline.
 */
export function mergeToolBatches(
  messages: ClassifiedMessage[],
  config: MergeConfig
): ClassifiedMessage[] {
  return new ToolMergeStrategy().merge(messages, config);
}

/**
 * Deduplicate tool calls by id, preserving latest status.
 * Note: This is no longer called in the merge path (tools are absorbed,
 * not promoted). Kept for backward compatibility and tests.
 */
export function deduplicateToolCalls(calls: ToolCall[]): ToolCall[] {
  const seen = new Map<string, ToolCall>();
  for (const call of calls) {
    seen.set(call.id, call);
  }
  return Array.from(seen.values());
}
