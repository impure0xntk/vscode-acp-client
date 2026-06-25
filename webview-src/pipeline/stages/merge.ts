import type { ClassifiedMessage, MergeConfig } from "../types";
import type { ToolCall } from "../../types";

/**
 * Deduplicate tool calls by id, preserving latest status.
 */
function deduplicateToolCalls(calls: ToolCall[]): ToolCall[] {
  const seen = new Map<string, ToolCall>();
  for (const call of calls) {
    seen.set(call.id, call);
  }
  return Array.from(seen.values());
}

/**
 * Find the last non-tool message in the array, or null if none.
 */
function findLastNonTool(
  messages: ClassifiedMessage[]
): ClassifiedMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "tool") return messages[i];
  }
  return null;
}

/**
 * Merge tool messages into preceding agent messages.
 *
 * Rules:
 *  1. tool immediately after agent  → merge toolCalls into that agent message.
 *  2. tool after non-agent (e.g. user) → promote to "agent" role so it is
 *     rendered as an agent tool-call card with an agent header.
 *     The promoted message inherits the original tool message's agentId
 *     (when available) so that the annotate stage can group it correctly
 *     with subsequent agent messages from the same agent.
 *  3. agent after a promoted tool     → inherit toolCalls from the promoted
 *     tool so that the agent's content and tool calls appear together, and
 *     the annotate stage can group the promoted tool and this agent as
 *     consecutive (same groupKey).
 *
 * Only "info" classified messages participate in merging.
 * System-kind messages (compression, mode_change, etc.) pass through and
 * reset the merge state — they act as grouping boundaries.
 */
export function mergeToolBatches(
  messages: ClassifiedMessage[],
  _config: MergeConfig
): ClassifiedMessage[] {
  const result: ClassifiedMessage[] = [];
  /** The last promoted tool message that has not yet been consumed by an agent message. */
  let pendingTool: ClassifiedMessage | null = null;

  for (const msg of messages) {
    // Non-info messages pass through and reset merge state (grouping boundary).
    if (msg.systemKind !== "info") {
      if (pendingTool) {
        // Flush pending tool before the boundary so its card is rendered.
        result.push({ ...pendingTool, role: "agent" as const, originalRole: "tool" as const });
        pendingTool = null;
      }
      result.push(msg);
      continue;
    }

    if (msg.role === "tool") {
      const lastNonTool = findLastNonTool(result);
      if (
        lastNonTool &&
        lastNonTool.role === "agent" &&
        lastNonTool.systemKind === "info" &&
        !lastNonTool.stopReason
      ) {
        // Case 1: merge into preceding agent message in-place.
        // Do NOT set pendingTool — the tool calls are fully absorbed here,
        // and the following agent message must not inherit them again.
        const merged: ClassifiedMessage = {
          ...lastNonTool,
          toolCalls: deduplicateToolCalls([
            ...(lastNonTool.toolCalls ?? []),
            ...(msg.toolCalls ?? []),
          ]),
        };
        const idx = result.indexOf(lastNonTool);
        result[idx] = merged;
      } else {
        // Case 2: no preceding agent — hold as pending.
        // Don't push yet; if an agent follows, flush before it so the
        // promoted tool and the agent are separate items.
        if (pendingTool) {
          // Already holding a pending tool — flush the old one first,
          // promoted to "agent" role so it renders as a tool-call card.
          // Mark originalRole so annotate can keep it as intermediate (tool) group.
          result.push({ ...pendingTool, role: "agent" as const, originalRole: "tool" as const });
        }
        // Inherit agentId from the nearest preceding non-tool message so
        // that the annotate stage produces the same groupKey as subsequent
        // agent messages from the same agent.
        const lastNonTool = findLastNonTool(result);
        const inheritedAgentId = lastNonTool?.agentId ?? msg.agentId;
        pendingTool = {
          ...msg,
          agentId: inheritedAgentId,
        };
      }
    } else if (msg.role === "agent" && pendingTool) {
      // Case 3: agent after a pending tool — merge the pending tool's
      // toolCalls INTO the agent message instead of emitting them as a
      // separate promoted-tool item.  When tool_call notifications
      // arrive before agent_message_chunk (e.g. Goose structured JSON
      // responses), this keeps the tool-call cards rendering directly
      // below the agent text as part of the final response, rather than
      // being exiled to the intermediate-steps banner.
      const mergedAgent: ClassifiedMessage = {
        ...msg,
        toolCalls: deduplicateToolCalls([
          ...(pendingTool.toolCalls ?? []),
          ...(msg.toolCalls ?? []),
        ]),
      };
      result.push(mergedAgent);
      pendingTool = null;
    } else {
      // Any other message — pass through.
      result.push(msg);
      pendingTool = null;
    }
  }

  // Flush any remaining pending tool, promoted to "agent" role so it
  // renders as a tool-call card. Mark originalRole so annotate keeps it
  // in the "tool" group (intermediate), not the "agent" group (final).
  if (pendingTool) {
    result.push({ ...pendingTool, role: "agent" as const, originalRole: "tool" as const });
  }

  return result;
}
