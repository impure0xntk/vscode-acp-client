import { create } from "zustand";
import type { ChatMessage } from "../types";
import { extractCandidatePaths } from "../lib/pathPatterns";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.store.message");

// ── Per-session message state ──────────────────────────────────────────────

export interface MessageState {
  /** sessionKey → messages */
  perSession: Record<string, ChatMessage[]>;
  /** sessionKey → streaming flag */
  streaming: Record<string, boolean>;
  setMessages: (key: string, msgs: ChatMessage[]) => void;
  appendMessage: (key: string, msg: ChatMessage) => void;
  setStreaming: (key: string, v: boolean) => void;
  /** Append a streaming chunk to the last agent message, or create one */
  appendStreamChunk: (key: string, agentId: string, sessionId: string, chunk: string) => void;
  clearSession: (key: string) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  perSession: {},
  streaming: {},

  setMessages: (key, msgs) =>
    set((state) => {
      const prev = state.perSession[key];
      // Same reference → no change, return same state object
      if (prev === msgs) return state;
      // Same length (content may differ) — still update, but skip if identical
      if (prev && prev.length === msgs.length) {
        let same = true;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== msgs[i]) { same = false; break; }
        }
        if (same) return state;
      }
      log.debug("setMessages", { key, count: msgs.length });
      return {
        ...state,
        perSession: { ...state.perSession, [key]: msgs },
      };
    }),

  appendMessage: (key, msg) =>
    set((state) => {
      const existing = state.perSession[key] ?? [];
      log.trace("appendMessage", { key, msgId: msg.id, role: msg.role, len: existing.length + 1 });
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

  appendStreamChunk: (key, agentId, sessionId, chunk) =>
    set((state) => {
      const existing = state.perSession[key] ?? [];
      const last = existing[existing.length - 1];
      let newMessages: ChatMessage[];
      if (last && last.role === "agent" && last.agentId === agentId) {
        const newContent = last.content + chunk;
        const freshPaths = extractCandidatePaths(newContent);
        const mergedPaths = [
          ...new Set([...(last.inlineFilePaths ?? []), ...freshPaths]),
        ];
        // Mutate the last element in-place for the new array
        const updatedLast: ChatMessage = {
          ...last,
          content: newContent,
          inlineFilePaths: mergedPaths.length > 0 ? mergedPaths : undefined,
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
      const newStreaming = state.streaming[key] === true
        ? state.streaming
        : { ...state.streaming, [key]: true };
      log.trace("appendStreamChunk", { key, agentId, chunkLen: chunk.length });
      return {
        ...state,
        perSession: { ...state.perSession, [key]: newMessages },
        streaming: newStreaming,
      };
    }),

  clearSession: (key) =>
    set((state) => {
      if (!(key in state.perSession)) return state;
      const next = { ...state.perSession };
      delete next[key];
      return { ...state, perSession: next };
    }),
}));
