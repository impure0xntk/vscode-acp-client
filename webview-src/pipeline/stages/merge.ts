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
 * Tool messages that appear without a preceding agent are promoted to agent role.
 * Only processes "info" classified messages; system messages pass through.
 */
export function mergeToolBatches(
  messages: ClassifiedMessage[],
  _config: MergeConfig,
): ClassifiedMessage[] {
  const result: ClassifiedMessage[] = [];
  let pendingTool: ClassifiedMessage | null = null;

  for (const msg of messages) {
    // Non-info messages (compression, mode_change, etc.) pass through unchanged
    if (msg.systemKind !== "info") {
      result.push(msg);
      pendingTool = null;
      continue;
    }

    if (msg.role === "tool") {
      const lastNonTool = findLastNonTool(result);
      if (lastNonTool && lastNonTool.role === "agent" && lastNonTool.systemKind === "info") {
        // Merge tool calls into the preceding agent message
        const merged: ClassifiedMessage = {
          ...lastNonTool,
          toolCalls: deduplicateToolCalls([
            ...(lastNonTool.toolCalls ?? []),
            ...(msg.toolCalls ?? []),
          ]),
        };
        result[result.indexOf(lastNonTool)] = merged;
        pendingTool = { ...msg, toolCalls: merged.toolCalls };
      } else {
        // No preceding agent — promote to agent
        result.push({ ...msg, role: "agent" as const });
        pendingTool = null;
      }
    } else if (msg.role === "agent" && pendingTool) {
      // Carry over tool calls from the pending tool message
      result.push({
        ...msg,
        toolCalls: deduplicateToolCalls([
          ...(pendingTool.toolCalls ?? []),
          ...(msg.toolCalls ?? []),
        ]),
      });
      pendingTool = null;
    } else {
      result.push(msg);
      pendingTool = null;
    }
  }

  // Flush trailing pending tool as agent message
  if (pendingTool) {
    result.push({ ...pendingTool, role: "agent" as const });
  }

  return result;
}
