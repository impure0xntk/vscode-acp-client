import type { RawMessage, ClassifiedMessage, SystemKind } from "../types";

/**
 * Classify system messages by inspecting content patterns.
 * Non-system messages are tagged as "info" and pass through unchanged.
 *
 * stopReason is preserved from the source message so downstream stages
 * (annotate, groupByUserBoundary) can use it as the authoritative signal
 * for final response boundary detection.
 */
export function classifyMessage(msg: RawMessage): ClassifiedMessage {
  const base: ClassifiedMessage = { ...msg, systemKind: "info" };

  if (msg.role !== "system") {
    return base;
  }

  if (msg.compressionInfo !== undefined) {
    return { ...base, systemKind: "compression" };
  }

  const lower = msg.content.toLowerCase();
  if (lower.includes("mode") || lower.includes("switched")) {
    return { ...base, systemKind: "mode_change" };
  }
  if (lower.includes("error") || lower.includes("failed")) {
    return { ...base, systemKind: "error_notice" };
  }
  if (msg.content.startsWith("[") && msg.content.endsWith("]")) {
    return { ...base, systemKind: "custom" };
  }

  return base;
}
