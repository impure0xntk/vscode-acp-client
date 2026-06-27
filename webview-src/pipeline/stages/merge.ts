import type { ClassifiedMessage, MergeConfig } from "../types";
import type { ToolCall } from "../../types";

// ── ToolMergeStrategy ──────────────────────────────────────────────────────

/**
 * Merging strategy that always promotes tool messages to "agent" role.
 *
 * Tool messages are NEVER merged into preceding agent messages. Instead,
 * each tool message is promoted to role="agent" and emitted as a separate
 * item BEFORE the following agent message. This ensures that:
 *  1. Tool calls between two agent messages form their own step
 *     (grouped with the following agent message, not the preceding one).
 *  2. Each tool call is rendered as its own ToolCallCard within a
 *     ToolBatchSummary, rather than all calls being absorbed into a
 *     single agent message's resolvedToolCalls.
 *  3. The pipeline correctly produces separate intermediate steps for
 *     sequences like: User → Tool1 → Agent1 → Tool2 → Agent2.
 *
 * Only "info" classified messages participate in merging.
 * System-kind messages (compression, mode_change, etc.) pass through and
 * reset the merge state — they act as grouping boundaries.
 */
export class ToolMergeStrategy {
  /** The last tool message that has not yet been flushed. */
  private pendingTool: ClassifiedMessage | null = null;

  /**
   * Merge tool messages — always promote tool messages to "agent" role.
   */
  merge(messages: ClassifiedMessage[], _config: MergeConfig): ClassifiedMessage[] {
    const result: ClassifiedMessage[] = [];
    this.pendingTool = null;

    for (const msg of messages) {
      // Non-info messages pass through and reset merge state (grouping boundary).
      if (msg.systemKind !== "info") {
        this.flushPending(result, msg);
        result.push(msg);
        continue;
      }

      if (msg.role === "tool") {
        // Flush any existing pending tool first (each tool message is separate).
        if (this.pendingTool) {
          this.promoteAndPush(result, this.pendingTool);
        }
        // Inherit agentId from the nearest preceding non-tool message so
        // that the annotate stage produces the same groupKey as subsequent
        // agent messages from the same agent.
        const lastNonTool = this.findLastNonTool(result);
        const inheritedAgentId = lastNonTool?.agentId ?? msg.agentId;
        this.pendingTool = { ...msg, agentId: inheritedAgentId };
      } else if (msg.role === "agent" && this.pendingTool) {
        // Agent after a pending tool — emit the tool as a separate
        // promoted-tool item BEFORE the agent message.
        this.promoteAndPush(result, this.pendingTool);
        result.push(msg);
        this.pendingTool = null;
      } else {
        // Any other message — pass through.
        result.push(msg);
        this.pendingTool = null;
      }
    }

    // Flush any remaining pending tool
    if (this.pendingTool) {
      this.promoteAndPush(result, this.pendingTool);
    }

    return result;
  }

  // ── Private ───────────────────────────────────────────────────────────

  private promoteAndPush(result: ClassifiedMessage[], msg: ClassifiedMessage): void {
    result.push({
      ...msg,
      role: "agent" as const,
      originalRole: "tool" as const,
    });
  }

  private flushPending(result: ClassifiedMessage[], _next: ClassifiedMessage): void {
    if (this.pendingTool) {
      this.promoteAndPush(result, this.pendingTool);
      this.pendingTool = null;
    }
  }

  /**
   * Find the last non-tool message in the result array.
   * Skips promoted tool messages (role=agent, originalRole=tool) so that
   * tool calls are always associated with the following agent message,
   * not a preceding promoted tool.
   */
  private findLastNonTool(messages: ClassifiedMessage[]): ClassifiedMessage | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "tool" && m.originalRole !== "tool") return m;
    }
    return null;
  }
}

// ── Functional API (backward compatible) ───────────────────────────────────

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

// ── Utility: deduplicate tool calls by id (used by annotate) ───────────────

/**
 * Deduplicate tool calls by id, preserving latest status.
 */
export function deduplicateToolCalls(calls: ToolCall[]): ToolCall[] {
  const seen = new Map<string, ToolCall>();
  for (const call of calls) {
    seen.set(call.id, call);
  }
  return Array.from(seen.values());
}
