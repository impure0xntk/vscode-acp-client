import { createTwoFilesPatch } from "diff";
import type { ContextAttachment } from "../types";
import { useFileWriteStore } from "../store/fileWriteStore";
import { sessionKeyOf } from "../store/sessionStore";
import { getLogger } from "./logger";

const log = getLogger("webview.review");

const UNIFIED_DIFF_CONTEXT = 3;

/**
 * Build a single `ContextAttachment` aggregating every file the agent wrote
 * in the given session (the "Files changed" list shown above the chat).
 *
 * Each path is collapsed into one (original → final) diff so the reviewer
 * sees the full cumulative change rather than per-write fragments. A newly
 * created file (no known original content) renders as pure additions.
 *
 * Returns `null` when the session has no recorded writes.
 */
export function buildReviewAttachment(
  agentId: string,
  sessionId: string
): ContextAttachment | null {
  const writes = useFileWriteStore
    .getState()
    .getWritesForSession(agentId, sessionId);
  if (writes.length === 0) {
    log.debug("buildReviewAttachment: no writes", { agentId, sessionId });
    return null;
  }

  // Collapse per-path writes: original = content before the agent's first
  // write for that path; lastContent = content of the most recent write.
  const byPath = new Map<
    string,
    { original: string | null; lastContent: string }
  >();
  for (const w of writes) {
    const existing = byPath.get(w.path);
    if (!existing) {
      byPath.set(w.path, {
        original: w.originalContent,
        lastContent: w.content,
      });
    } else {
      existing.lastContent = w.content;
      // Preserve the earliest known original content.
      if (existing.original == null && w.originalContent != null) {
        existing.original = w.originalContent;
      }
    }
  }

  const parts: string[] = [];
  let fileCount = 0;
  for (const [path, { original, lastContent }] of byPath) {
    if (original == null && lastContent == null) continue;
    const diff = createTwoFilesPatch(
      path,
      path,
      original ?? "",
      lastContent ?? "",
      undefined,
      undefined,
      { context: UNIFIED_DIFF_CONTEXT }
    );
    parts.push(diff);
    fileCount++;
  }

  if (parts.length === 0) return null;

  const content = parts.join("\n");
  return {
    id: `review:${sessionKeyOf(agentId, sessionId)}:${Date.now()}`,
    type: "diff",
    path: "Files changed",
    label: `${fileCount} file${fileCount !== 1 ? "s" : ""} changed`,
    lineRange: undefined,
    tokenCount: Math.ceil(content.length / 4),
    content,
  };
}
