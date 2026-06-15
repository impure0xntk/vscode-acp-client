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
function findLastNonTool(messages: ClassifiedMessage[]): ClassifiedMessage | null {
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
  _config: MergeConfig,
): ClassifiedMessage[] {
  const result: ClassifiedMessage[] = [];
  /** The last promoted tool message that has not yet been consumed by an agent message. */
  let pendingTool: ClassifiedMessage | null = null;

  for (const msg of messages) {
    // Non-info messages pass through and reset merge state (grouping boundary).
    if (msg.systemKind !== "info") {
      if (pendingTool) {
        // Flush pending tool before the boundary so its card is rendered.
        result.push({ ...pendingTool, role: "agent" as const });
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
        lastNonTool.systemKind === "info"
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
        // Don't push yet; if an agent follows, we merge into it.
        // Only flush at boundary or end if no agent follows.
        if (pendingTool) {
          // Already holding a pending tool — flush the old one first.
          result.push({ ...pendingTool, role: "agent" as const });
        }
        pendingTool = { ...msg, role: "agent" as const };
      }
    } else if (msg.role === "agent" && pendingTool) {
      // Case 3: agent after a promoted tool — inherit carried-over toolCalls.
      result.push({
        ...msg,
        toolCalls: deduplicateToolCalls([
          ...(pendingTool.toolCalls ?? []),
          ...(msg.toolCalls ?? []),
        ]),
      });
      pendingTool = null;
    } else {
      // Any other message — pass through.
      result.push(msg);
      pendingTool = null;
    }
  }

  // Flush any remaining pending tool as its own agent message.
  if (pendingTool) {
    result.push({ ...pendingTool, role: "agent" as const });
  }

  return result;
}
