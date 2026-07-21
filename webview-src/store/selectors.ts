import type { MessageState } from "./messageStore";
import { sessionKeyOf } from "./sessionStore";
import type { ResponsePreview } from "../types";

/**
 * Select the message count for a specific session from messageStore.
 * This replaces the redundant `messageCount` field previously stored in
 * SessionInfoSnapshot.
 */
export function selectMessageCount(
  state: MessageState,
  agentId: string,
  sessionId: string
): number {
  const key = sessionKeyOf(agentId, sessionId);
  return state.perSession[key]?.length ?? 0;
}

/**
 * Select the total number of tool calls for a specific session.
 */
export function selectToolCallCount(
  state: MessageState,
  agentId: string,
  sessionId: string
): number {
  const key = sessionKeyOf(agentId, sessionId);
  const msgs = state.perSession[key];
  if (!msgs) return 0;
  return msgs.reduce((count, msg) => count + (msg.toolCalls?.length ?? 0), 0);
}

/**
 * Select the number of completed tool calls for a specific session.
 */
export function selectToolCallsCompleted(
  state: MessageState,
  agentId: string,
  sessionId: string
): number {
  const key = sessionKeyOf(agentId, sessionId);
  const msgs = state.perSession[key];
  if (!msgs) return 0;
  return msgs.reduce(
    (count, msg) =>
      count +
      (msg.toolCalls?.filter((tc) => tc.status === "completed").length ?? 0),
    0
  );
}

/**
 * Derive recent response previews from messageStore for a session.
 * Walks messages backward (newest first) and collects agent text responses
 * and tool calls up to `maxResponses`, then reverses for chronological order.
 */
export function selectRecentResponses(
  state: MessageState,
  agentId: string,
  sessionId: string,
  maxResponses: number = 10
): ResponsePreview[] {
  const key = sessionKeyOf(agentId, sessionId);
  const msgs = state.perSession[key];
  if (!msgs || msgs.length === 0) return [];

  const previews: ResponsePreview[] = [];

  // Walk backward so we get the most recent items first, then reverse
  for (let i = msgs.length - 1; i >= 0 && previews.length < maxResponses; i--) {
    const msg = msgs[i];

    // Agent response messages (skip thinking-only messages)
    if (
      msg.role === "agent" &&
      msg.content.trim().length > 0 &&
      msg.thinking == null
    ) {
      previews.push({
        messageId: msg.id,
        role: "agent",
        preview: msg.content.substring(0, 120),
        status: msg.stopReason != null ? "completed" : "running",
        timestamp: new Date(msg.timestamp).toISOString(),
      });
    }

    // Tool call messages
    if (msg.role === "tool" && msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        if (previews.length >= maxResponses) break;
        const status: ResponsePreview["status"] =
          tc.status === "in_progress"
            ? "running"
            : tc.status === "completed"
              ? "completed"
              : tc.status === "failed"
                ? "failed"
                : undefined;
        previews.push({
          messageId: msg.id,
          role: "tool",
          preview: tc.title || tc.kind,
          toolName: tc.kind,
          status,
          timestamp: new Date(msg.timestamp).toISOString(),
        });
      }
    }
  }

  // Reverse so display order is chronological (oldest first)
  previews.reverse();
  return previews;
}
