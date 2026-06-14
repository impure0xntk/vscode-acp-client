import { create } from "zustand";
import type { ChatMessage } from "../types";
import { extractCandidatePaths } from "../lib/pathPatterns";

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
    set((s) => ({ perSession: { ...s.perSession, [key]: msgs } })),

  appendMessage: (key, msg) =>
    set((s) => ({
      perSession: {
        ...s.perSession,
        [key]: [...(s.perSession[key] ?? []), msg],
      },
    })),

  setStreaming: (key, v) =>
    set((s) => ({ streaming: { ...s.streaming, [key]: v } })),

  appendStreamChunk: (key, agentId, sessionId, chunk) =>
    set((s) => {
      const existing = s.perSession[key] ?? [];
      const last = existing[existing.length - 1];
      if (last && last.role === "agent" && last.agentId === agentId) {
        const newContent = last.content + chunk;
        const freshPaths = extractCandidatePaths(newContent);
        const mergedPaths = [
          ...new Set([...(last.inlineFilePaths ?? []), ...freshPaths]),
        ];
        const updated: ChatMessage = {
          ...last,
          content: newContent,
          inlineFilePaths: mergedPaths.length > 0 ? mergedPaths : undefined,
        };
        return {
          perSession: {
            ...s.perSession,
            [key]: [...existing.slice(0, -1), updated],
          },
          streaming: { ...s.streaming, [key]: true },
        };
      }
      const streamingMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        content: chunk,
        timestamp: Date.now(),
        agentId,
        sessionId,
      };
      return {
        perSession: {
          ...s.perSession,
          [key]: [...existing, streamingMsg],
        },
        streaming: { ...s.streaming, [key]: true },
      };
    }),

  clearSession: (key) =>
    set((s) => {
      const next = { ...s.perSession };
      delete next[key];
      return { perSession: next };
    }),
}));
