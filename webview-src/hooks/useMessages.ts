import { useMessageStore } from "../store/messageStore";
import { useSessionStore } from "../store/sessionStore";
import type { ChatMessage } from "../types";

// ── Message hooks ───────────────────────────────────────────────────────────

/**
 * Subscribe to messages and streaming state for a given session key.
 * Returns messages, isStreaming, and action functions scoped to the key.
 */
export function useMessages(sessionKey: string | null) {
  // Read via getState() to avoid useSyncExternalStore subscription.
  // useMessageStore(selector) would subscribe and trigger infinite re-renders
  // because every store write creates new object references.
  const { perSession, streaming, setMessages, appendMessage, setStreaming, appendStreamChunk } =
    useMessageStore.getState();

  const messages = sessionKey ? perSession[sessionKey] ?? [] : [];
  const isStreaming = sessionKey ? streaming[sessionKey] ?? false : false;

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
