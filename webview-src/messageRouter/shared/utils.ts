/**
 * Shared utilities for safe JSON serialization, tool status
 * normalization, and diff content extraction.
 */

/**
 * Safe JSON.stringify — catches circular references, BigInt, and other
 * non-serializable values that would throw.  Falls back to String(value).
 */
export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/**
 * Normalize raw SDK toolCallStatus → webview ToolCall.status
 */
export function normalizeToolStatus(
  raw: string | null | undefined
): "in_progress" | "completed" | "failed" | "cancelled" {
  if (raw === "pending") return "in_progress";
  if (
    raw === "in_progress" ||
    raw === "completed" ||
    raw === "failed" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "in_progress";
}

/**
 * Extract diff content from a ToolCallContent array (SDK format).
 */
export function extractDiffFromContent(
  content: Array<{ type: string; [key: string]: unknown }> | undefined
): import("../../types").ToolCallDiffContent | undefined {
  if (!content) return undefined;
  for (const c of content) {
    if (c.type === "diff") {
      const oldText = (c.oldText as string | undefined) ?? "";
      const newText = (c.newText as string) ?? "";
      const filePath = (c.path as string) ?? "";
      // Build a minimal unified diff
      const diff =
        oldText === newText
          ? newText
          : `--- ${filePath}\n+++ ${filePath}\n-${oldText}\n+${newText}`;
      return {
        type: "diff",
        diff,
        oldPath: oldText ? filePath : undefined,
        newPath: filePath,
      };
    }
  }
  return undefined;
}
