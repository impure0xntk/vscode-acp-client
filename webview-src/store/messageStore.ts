import { create } from "zustand";
import type { ChatMessage, QueuedPrompt } from "../types";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.store.message");

// ── Per-session message state ──────────────────────────────────────────────

export interface MessageState {
  /** sessionKey → messages */
  perSession: Record<string, ChatMessage[]>;
  /** sessionKey → streaming flag */
  streaming: Record<string, boolean>;
  /** sessionKey → queued prompts */
  promptQueue: Record<string, QueuedPrompt[]>;
  setMessages: (key: string, msgs: ChatMessage[]) => void;
  appendMessage: (key: string, msg: ChatMessage) => void;
  /** Replace message at index — used by session/notification handler for tool_call updates */
  updateMessage: (key: string, index: number, msg: ChatMessage) => void;
  setStreaming: (key: string, v: boolean) => void;
  /** Append a streaming chunk to the last agent message, or create one */
  appendStreamChunk: (
    key: string,
    agentId: string,
    sessionId: string,
    chunk: string
  ) => void;
  /** Append multiple streaming chunks at once to reduce store updates */
  appendStreamChunks: (
    key: string,
    agentId: string,
    sessionId: string,
    chunks: string[]
  ) => void;
  /**
   * Update the last agent/tool message with turn-end metadata.
   * Used by session/turnEnded to stamp stopReason onto the final response
   * so the pipeline can use it as the authoritative boundary signal.
   */
  updateLastAgentMessage: (key: string, update: Partial<ChatMessage>) => void;
  clearSession: (key: string) => void;
  /** Add a queued prompt entry */
  addQueuedPrompt: (key: string, entry: QueuedPrompt) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  perSession: {},
  streaming: {},
  promptQueue: {},

  setMessages: (key, msgs) =>
    set((state) => {
      const prev = state.perSession[key];
      // Same reference → no change, return same state object
      if (prev === msgs) return state;
      log.debug("setMessages", { key, count: msgs.length });
      return {
        ...state,
        perSession: { ...state.perSession, [key]: msgs },
      };
    }),

  appendMessage: (key, msg) =>
    set((state) => {
      const existing = state.perSession[key] ?? [];
      log.trace("appendMessage", {
        key,
        msgId: msg.id,
        role: msg.role,
        len: existing.length + 1,
      });
      return {
        ...state,
        perSession: { ...state.perSession, [key]: [...existing, msg] },
      };
    }),

  setStreaming: (key, v) =>
    set((state) => {
      if (state.streaming[key] === v) return state;
      log.trace("setStreaming", { key, streaming: v });
      return {
        ...state,
        streaming: { ...state.streaming, [key]: v },
      };
    }),

  /** Append multiple streaming chunks at once to reduce store updates */
  appendStreamChunks: (key, agentId, sessionId, chunks: string[]) =>
    set((state) => {
      if (chunks.length === 0) return state;
      const merged = chunks.join("");
      const existing = state.perSession[key] ?? [];
      // Check whether the last message is a same-agent streaming agent.
      // If the last message is a tool, user, system, or a completed agent,
      // create a NEW agent message — this prevents post-tool chunks from
      // being appended to pre-tool agent text (Goose structured JSON).
      const lastMsg = existing.length > 0 ? existing[existing.length - 1] : null;
      const shouldAppend =
        lastMsg !== null &&
        lastMsg.role === "agent" &&
        lastMsg.agentId === agentId &&
        (lastMsg.stopReason == null || lastMsg.stopReason === "");
      let newMessages: ChatMessage[];
      if (shouldAppend) {
        const updatedLast: ChatMessage = { ...lastMsg, content: lastMsg.content + merged };
        newMessages = [...existing.slice(0, -1), updatedLast];
      } else {
        newMessages = [
          ...existing,
          {
            id: crypto.randomUUID(),
            role: "agent",
            content: merged,
            timestamp: Date.now(),
            agentId,
            sessionId,
          },
        ];
      }
      const newStreaming =
        state.streaming[key] === true
          ? state.streaming
          : { ...state.streaming, [key]: true };
      return {
        ...state,
        perSession: { ...state.perSession, [key]: newMessages },
        streaming: newStreaming,
      };
    }),

  appendStreamChunk: (key, agentId, sessionId, chunk) =>
    set((state) => {
      const existing = state.perSession[key] ?? [];
      // Check whether the last message is a same-agent streaming agent.
      // If the last message is a tool, user, system, or a completed agent,
      // create a NEW agent message — this prevents post-tool chunks from
      // being appended to pre-tool agent text (Goose structured JSON).
      const lastMsg = existing.length > 0 ? existing[existing.length - 1] : null;
      const shouldAppend =
        lastMsg !== null &&
        lastMsg.role === "agent" &&
        lastMsg.agentId === agentId &&
        (lastMsg.stopReason == null || lastMsg.stopReason === "");
      let newMessages: ChatMessage[];
      if (shouldAppend) {
        const updatedLast: ChatMessage = {
          ...lastMsg,
          content: lastMsg.content + chunk,
        };
        newMessages = [...existing.slice(0, -1), updatedLast];
      } else {
        newMessages = [
          ...existing,
          {
            id: crypto.randomUUID(),
            role: "agent",
            content: chunk,
            timestamp: Date.now(),
            agentId,
            sessionId,
          },
        ];
      }
      const newStreaming =
        state.streaming[key] === true
          ? state.streaming
          : { ...state.streaming, [key]: true };
      log.trace("appendStreamChunk", { key, agentId, chunkLen: chunk.length });
      return {
        ...state,
        perSession: { ...state.perSession, [key]: newMessages },
        streaming: newStreaming,
      };
    }),

  updateLastAgentMessage: (key, update) =>
    set((state) => {
      const existing = state.perSession[key];
      if (!existing || existing.length === 0) return state;
      // Find the last agent message (skip tool messages so stopReason
      // is always stamped on the text response, not a tool-only message).
      // selectFinalResponse in SessionChatContainer uses stopReason as
      // the primary signal for the final response boundary — stamping it
      // on a tool message causes the text response to be hidden.
      for (let i = existing.length - 1; i >= 0; i--) {
        if (existing[i].role === "agent") {
          const updated = { ...existing[i], ...update };
          const next = [...existing];
          next[i] = updated;
          return {
            ...state,
            perSession: { ...state.perSession, [key]: next },
          };
        }
      }
      return state;
    }),

  updateMessage: (key, index, msg) =>
    set((state) => {
      const existing = state.perSession[key];
      if (!existing || index < 0 || index >= existing.length) return state;
      const next = [...existing];
      next[index] = msg;
      return {
        ...state,
        perSession: { ...state.perSession, [key]: next },
      };
    }),

  clearSession: (key) =>
    set((state) => {
      if (!(key in state.perSession)) return state;
      const next = { ...state.perSession };
      delete next[key];
      return { ...state, perSession: next };
    }),

  addQueuedPrompt: (key, entry) =>
    set((state) => {
      const existing = state.promptQueue[key] ?? [];
      log.trace("addQueuedPrompt", {
        key,
        entryId: entry.id,
        len: existing.length + 1,
      });
      return {
        ...state,
        promptQueue: { ...state.promptQueue, [key]: [...existing, entry] },
      };
    }),
}));
