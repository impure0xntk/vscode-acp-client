import type { ChatMessage } from "../types";
import { useSessionStore } from "../store/sessionStore";

/**
 * A single agent turn within a session: the user message that opened it plus
 * the final agent response produced before the next user message arrived.
 */
export interface SessionTurn {
  agentId: string;
  sessionId: string;
  /** Index of the user message that begins this turn (stable identifier). */
  turnIndex: number;
  /** Text of the user message that started the turn. */
  userPrompt: string;
  /** Final natural-language agent output of the turn. */
  output: string;
  /** Timestamp of the last message in the turn (for recency sorting). */
  timestamp: number;
  sessionTitle: string;
}

/** Index of the next user message after `from`, or end-of-array. */
function nextUserIndex(messages: ChatMessage[], from: number): number {
  for (let i = from + 1; i < messages.length; i++) {
    if (messages[i].role === "user") return i;
  }
  return messages.length;
}

/**
 * Return the final natural-language response of the turn that begins at
 * `userMsgIndex`. The "turn end" is the last real agent message (non-thinking)
 * before the next user message. A message carrying `stopReason` is treated as
 * the authoritative end-of-turn output; otherwise the last agent text wins.
 *
 * Pure function of `messages` — safe to unit test without any store.
 */
export function getTurnOutput(
  messages: ChatMessage[],
  userMsgIndex: number
): string | null {
  if (userMsgIndex < 0 || userMsgIndex >= messages.length) return null;
  if (messages[userMsgIndex].role !== "user") return null;

  const end = nextUserIndex(messages, userMsgIndex);
  let fallback: string | null = null;
  for (let i = end - 1; i > userMsgIndex; i--) {
    const m = messages[i];
    if (m.role !== "agent" || m.thinking) continue;
    const text = m.content.trim();
    if (!text) continue;
    if (m.stopReason) return text;
    if (fallback === null) fallback = text;
  }
  return fallback;
}

/**
 * Collect every turn across all loaded sessions that produced a final agent
 * response. Sorted most-recent first so the picker surfaces the latest output.
 */
export function collectTurns(
  perSession: Record<string, ChatMessage[]>
): SessionTurn[] {
  const sessionStore = useSessionStore.getState();
  const turns: SessionTurn[] = [];

  for (const [key, messages] of Object.entries(perSession)) {
    if (!messages || messages.length === 0) continue;

    const colon = key.indexOf(":");
    const agentId = colon >= 0 ? key.slice(0, colon) : "";
    const sessionId = colon >= 0 ? key.slice(colon + 1) : key;
    const sessionTitle =
      sessionStore.tabTitles[key] ?? sessionId.slice(0, 8);

    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "user") continue;
      const output = getTurnOutput(messages, i);
      if (output == null || output.length === 0) continue;

      const end = nextUserIndex(messages, i);
      let ts = messages[i].timestamp;
      for (let j = i + 1; j < end; j++) {
        if (messages[j].timestamp > ts) ts = messages[j].timestamp;
      }

      turns.push({
        agentId,
        sessionId,
        turnIndex: i,
        userPrompt: messages[i].content.trim(),
        output,
        timestamp: ts,
        sessionTitle,
      });
    }
  }

  turns.sort((a, b) => b.timestamp - a.timestamp);
  return turns;
}
