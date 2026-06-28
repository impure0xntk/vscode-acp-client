import { create, type StoreApi } from "zustand";
import type { ChatMessage, QueuedPrompt } from "../types";
import { getLogger } from "../lib/logger";
import { useFileWriteStore } from "./fileWriteStore";

const log = getLogger("webview.store.message");

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
  getLastAgentMessage: (key: string) => ChatMessage | null;
  clearSession: (key: string) => void;
  /** Add a queued prompt entry */
  addQueuedPrompt: (key: string, entry: QueuedPrompt) => void;
}

export const useMessageStore: StoreApi<MessageState> = create<MessageState>((set) => ({
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

  /**
   * Append multiple streaming chunks to the message store.
   *
   * When the last message is an in-progress same-agent stream (no stopReason),
   * chunks are appended in-place — this is the common case during
   * high-frequency streaming where chunks belong to the same logical message.
   *
   * When the last message is a tool message that arrived mid-stream
   * (between agent message chunks), we look back to find the last agent
   * message without stopReason and merge into it. This prevents message
   * fragmentation where tool_call notifications between agent_message_chunk
   * deliveries would otherwise cause subsequent chunks to become separate
   * ChatMessages instead of continuing the in-progress agent response.
   *
   * Only when there is truly no in-progress agent message to merge into
   * (e.g. last message is user, system, or completed agent), each chunk
   * becomes a SEPARATE ChatMessage — this is the correct behavior for
   * intermediate-step boundaries.
   */
  appendStreamChunks: (key, agentId, sessionId, chunks: string[]) =>
    set((state) => {
      if (chunks.length === 0) return state;
      const existing = state.perSession[key] ?? [];
      const lastMsg = existing.length > 0 ? existing[existing.length - 1] : null;

      // Check if the last message is directly mergeable
      const shouldMergeIntoLast =
        lastMsg !== null &&
        lastMsg.role === "agent" &&
        lastMsg.agentId === agentId &&
        (lastMsg.stopReason == null || lastMsg.stopReason === "");

      // If not directly mergeable, look back past tool messages to find
      // an in-progress agent message to merge into. This handles the case
      // where tool_call notifications arrive between agent_message_chunk
      // deliveries during streaming.
      let mergeTargetIdx = -1;
      if (!shouldMergeIntoLast && lastMsg !== null) {
        for (let i = existing.length - 1; i >= 0; i--) {
          const m = existing[i];
          if (
            m.role === "agent" &&
            m.agentId === agentId &&
            (m.stopReason == null || m.stopReason === "")
          ) {
            mergeTargetIdx = i;
            break;
          }
          // Stop looking if we hit a user message or completed agent
          if (m.role === "user" || m.role === "system") break;
          if (m.role === "agent" && m.stopReason != null && m.stopReason !== "") break;
        }
      }

      const effectiveMerge = shouldMergeIntoLast || mergeTargetIdx >= 0;

      let newMessages: ChatMessage[];
      if (effectiveMerge) {
        const merged = chunks.join("");
        if (shouldMergeIntoLast) {
          // Fast path: merge into last message
          const updatedLast: ChatMessage = {
            ...lastMsg,
            content: lastMsg.content + merged,
          };
          newMessages = [...existing.slice(0, -1), updatedLast];
        } else {
          // Merge into the found agent message at mergeTargetIdx
          const target = existing[mergeTargetIdx];
          const updatedTarget: ChatMessage = {
            ...target,
            content: target.content + merged,
          };
          newMessages = [...existing];
          newMessages[mergeTargetIdx] = updatedTarget;
        }
      } else {
        // Different agent, or last message is user/system/completed-agent:
        // each chunk becomes a separate ChatMessage.  Stamp writeSeq so the
        // pipeline's attachStepFileEditSummaries can partition writes per step.
        const writeSeq = useFileWriteStore.getState().currentSeq();
        newMessages = existing;
        for (const chunk of chunks) {
          newMessages = [
            ...newMessages,
            {
              id: crypto.randomUUID(),
              role: "agent",
              content: chunk,
              timestamp: Date.now(),
              agentId,
              sessionId,
              writeSeq,
            },
          ];
        }
      }

      return {
        ...state,
        perSession: { ...state.perSession, [key]: newMessages },
        streaming: { ...state.streaming, [key]: true },
      };
    }),

  appendStreamChunk: (key, agentId, sessionId, chunk) =>
    set((state) => {
      const existing = state.perSession[key] ?? [];
      const lastMsg = existing.length > 0 ? existing[existing.length - 1] : null;
      // Single chunk from a same-agent in-progress stream: append
      // in-place for efficiency (avoids flooding the store).
      const shouldAppend =
        lastMsg !== null &&
        lastMsg.role === "agent" &&
        lastMsg.agentId === agentId &&
        (lastMsg.stopReason == null || lastMsg.stopReason === "");

      // Look back past tool messages for an in-progress agent message
      let mergeTargetIdx = -1;
      if (!shouldAppend && lastMsg !== null) {
        for (let i = existing.length - 1; i >= 0; i--) {
          const m = existing[i];
          if (
            m.role === "agent" &&
            m.agentId === agentId &&
            (m.stopReason == null || m.stopReason === "")
          ) {
            mergeTargetIdx = i;
            break;
          }
          if (m.role === "user" || m.role === "system") break;
          if (m.role === "agent" && m.stopReason != null && m.stopReason !== "") break;
        }
      }

      const effectiveMerge = shouldAppend || mergeTargetIdx >= 0;
      let newMessages: ChatMessage[];
      if (effectiveMerge) {
        if (shouldAppend) {
          const updatedLast: ChatMessage = {
            ...lastMsg,
            content: lastMsg.content + chunk,
          };
          newMessages = [...existing.slice(0, -1), updatedLast];
        } else {
          const target = existing[mergeTargetIdx];
          const updatedTarget: ChatMessage = {
            ...target,
            content: target.content + chunk,
          };
          newMessages = [...existing];
          newMessages[mergeTargetIdx] = updatedTarget;
        }
      } else {
        // Stamp writeSeq so the pipeline can partition writes per step.
        const writeSeq = useFileWriteStore.getState().currentSeq();
        newMessages = [
          ...existing,
          {
            id: crypto.randomUUID(),
            role: "agent",
            content: chunk,
            timestamp: Date.now(),
            agentId,
            sessionId,
            writeSeq,
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

  getLastAgentMessage: (key: string): ChatMessage | null => {
    const state = useMessageStore.getState();
    const existing: ChatMessage[] | undefined = state.perSession[key];
    if (!existing || existing.length === 0) return null;
    for (let i = existing.length - 1; i >= 0; i--) {
      if (existing[i].role === "agent") return existing[i];
    }
    return null;
  },

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
