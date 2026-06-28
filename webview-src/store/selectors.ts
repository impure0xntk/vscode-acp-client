import type { MessageState } from "./messageStore";
import { sessionKeyOf } from "./sessionStore";

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
