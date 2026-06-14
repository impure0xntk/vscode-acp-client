import { create } from "zustand";
import { produce } from "immer";
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
    set(produce((draft: MessageState) => {
      draft.perSession[key] = msgs;
      log.debug("setMessages", { key, count: msgs.length });
    })),

  appendMessage: (key, msg) =>
    set(produce((draft: MessageState) => {
      if (!draft.perSession[key]) draft.perSession[key] = [];
      draft.perSession[key].push(msg);
      log.trace("appendMessage", { key, msgId: msg.id, role: msg.role, len: draft.perSession[key].length });
    })),

  setStreaming: (key, v) =>
    set(produce((draft: MessageState) => {
      draft.streaming[key] = v;
      log.trace("setStreaming", { key, streaming: v });
    })),

  appendStreamChunk: (key, agentId, sessionId, chunk) =>
    set(produce((draft: MessageState) => {
      if (!draft.perSession[key]) draft.perSession[key] = [];
      const existing = draft.perSession[key];
      const last = existing[existing.length - 1];
      if (last && last.role === "agent" && last.agentId === agentId) {
        const newContent = last.content + chunk;
        const freshPaths = extractCandidatePaths(newContent);
        const mergedPaths = [
          ...new Set([...(last.inlineFilePaths ?? []), ...freshPaths]),
        ];
        existing[existing.length - 1] = {
          ...last,
          content: newContent,
          inlineFilePaths: mergedPaths.length > 0 ? mergedPaths : undefined,
        };
        draft.streaming[key] = true;
        return;
      }
      existing.push({
        id: crypto.randomUUID(),
        role: "agent",
        content: chunk,
        timestamp: Date.now(),
        agentId,
        sessionId,
      });
      draft.streaming[key] = true;
      log.trace("appendStreamChunk:new", { key, agentId, chunkLen: chunk.length });
    })),

  clearSession: (key) =>
    set(produce((draft: MessageState) => {
      delete draft.perSession[key];
    })),
}));
