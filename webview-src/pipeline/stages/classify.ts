import type { RawMessage, ClassifiedMessage, SystemKind } from "../types";

/**
 * Classify system messages by inspecting content patterns.
 * Non-system messages are tagged as "info" and pass through unchanged.
 */
export function classifyMessage(msg: RawMessage): ClassifiedMessage {
  if (msg.role !== "system") {
    return { ...msg, systemKind: "info" };
  }

  if (msg.compressionInfo !== undefined) {
    return { ...msg, systemKind: "compression" };
  }

  const lower = msg.content.toLowerCase();
  if (lower.includes("mode") || lower.includes("switched")) {
    return { ...msg, systemKind: "mode_change" };
  }
  if (lower.includes("error") || lower.includes("failed")) {
    return { ...msg, systemKind: "error_notice" };
  }
  if (msg.content.startsWith("[") && msg.content.endsWith("]")) {
    return { ...msg, systemKind: "custom" };
  }

  return { ...msg, systemKind: "info" };
}
