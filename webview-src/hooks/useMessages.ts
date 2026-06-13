import { useMessageStore } from "../store/messageStore";
import { useSessionStore } from "../store/sessionStore";
import type { ChatMessage } from "../types";

// ── Message hooks ───────────────────────────────────────────────────────────

/**
 * Subscribe to messages and streaming state for a given session key.
 * Returns messages, isStreaming, and action functions scoped to the key.
 */
export function useMessages(sessionKey: string | null) {
  const perSession = useMessageStore((s) => s.perSession);
  const streamingMap = useMessageStore((s) => s.streaming);
  const setMessages = useMessageStore((s) => s.setMessages);
  const appendMessage = useMessageStore((s) => s.appendMessage);
  const setStreaming = useMessageStore((s) => s.setStreaming);
  const appendStreamChunk = useMessageStore((s) => s.appendStreamChunk);

  const messages = sessionKey ? perSession[sessionKey] ?? [] : [];
  const isStreaming = sessionKey ? streamingMap[sessionKey] ?? false : false;

  return {
    messages,
    isStreaming,
    setMessages: (msgs: ChatMessage[]) => {
      if (sessionKey) setMessages(sessionKey, msgs);
    },
    appendMessage: (msg: ChatMessage) => {
      if (sessionKey) appendMessage(sessionKey, msg);
    },
    setStreaming: (v: boolean) => {
      if (sessionKey) setStreaming(sessionKey, v);
    },
    appendStreamChunk: (agentId: string, sessionId: string, chunk: string) => {
      if (sessionKey) appendStreamChunk(sessionKey, agentId, sessionId, chunk);
    },
  };
}
