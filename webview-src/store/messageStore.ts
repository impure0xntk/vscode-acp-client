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
  /** sessionKey + agentId → last seen sessionUpdate type (for boundary detection when no messageId) */
  lastSessionUpdateType: Record<string, string>;
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
    chunk: string,
    messageId?: string | null,
    sessionUpdate?: string | null
  ) => void;
  /** Append multiple streaming chunks at once to reduce store updates */
  appendStreamChunks: (
    key: string,
    agentId: string,
    sessionId: string,
    chunks: string[],
    messageId?: string | null,
    sessionUpdate?: string | null
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
  /** Update a message by messageId (for streaming message stopReason stamping) */
  updateMessageByMessageId: (key: string, messageId: string, update: Partial<ChatMessage>) => void;
}

export const useMessageStore: StoreApi<MessageState> = create<MessageState>(
  (set) => ({
    perSession: {},
    streaming: {},
    promptQueue: {},
    lastSessionUpdateType: {},

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
     * Merge priority:
     * 1. Same messageId (ACP SDK) — always merge.
     * 2. sessionUpdate type boundary — when messageId is not provided, a change
     *    in sessionUpdate type (e.g., agent_message_chunk → agent_thought_chunk)
     *    creates a new message boundary. This mirrors Zed's fallback behavior.
     * 3. Last message is directly mergeable (same agent).
     * 4. Look back past tool messages for an in-progress agent message.
     * 5. Otherwise, create a new ChatMessage.
     */
    appendStreamChunks: (
      key,
      agentId,
      sessionId,
      chunks: string[],
      messageId?: string | null,
      sessionUpdate?: string | null
    ) =>
      set((state) => {
        if (chunks.length === 0) return state;
        const existing = state.perSession[key] ?? [];
        const lastMsg =
          existing.length > 0 ? existing[existing.length - 1] : null;

        // Track sessionUpdate type for boundary detection when no messageId
        const sessionUpdateKey = `${key}:${agentId}`;
        const lastSessionUpdate = state.lastSessionUpdateType[sessionUpdateKey];
        const sessionUpdateChanged =
          sessionUpdate != null &&
          lastSessionUpdate != null &&
          sessionUpdate !== lastSessionUpdate;

        // 1. messageId-based merge: find the agent message with matching id
        let messageIdTargetIdx = -1;
        if (messageId != null) {
          for (let i = existing.length - 1; i >= 0; i--) {
            const m = existing[i];
            if (m.role === "agent" && m.id === messageId) {
              messageIdTargetIdx = i;
              break;
            }
            // Stop looking past user/system messages or completed agents
            if (m.role === "user" || m.role === "system") break;
            if (
              m.role === "agent" &&
              m.stopReason != null &&
              m.stopReason !== ""
            )
              break;
          }
        }

        // 2. Check if the last message is directly mergeable.
        // IMPORTANT: If messageId was explicitly provided but didn't match any
        // existing message (messageIdTargetIdx < 0), we must NOT merge — the
        // messageId is an explicit ACP signal that this is a NEW logical message.
        // Also, if sessionUpdate type changed, we must NOT merge.
        const shouldMergeIntoLast =
          messageId == null &&
          !sessionUpdateChanged &&
          lastMsg !== null &&
          lastMsg.role === "agent" &&
          lastMsg.agentId === agentId &&
          (lastMsg.stopReason == null || lastMsg.stopReason === "");

        // 3. If not directly mergeable, look back past tool messages to find
        //    an in-progress agent message to merge into.
        // IMPORTANT: Only look back if messageId was NOT explicitly provided
        // AND sessionUpdate type didn't change.
        // If messageId was provided but didn't match, it's an explicit ACP signal
        // for a NEW message — we must NOT merge with any previous message.
        let mergeTargetIdx = -1;
        if (
          !shouldMergeIntoLast &&
          lastMsg !== null &&
          messageIdTargetIdx < 0 &&
          messageId == null &&
          !sessionUpdateChanged
        ) {
          for (let i = existing.length - 1; i >= 0; i--) {
            const m = existing[i];
            // Stop at tool messages: each tool_call starts a new step.
            // Without this, post-tool agent chunks merge into the pre-tool
            // agent message, causing splitIntoSteps to see only one perpetual step.
            if (m.role === "tool") break;
            if (
              m.role === "agent" &&
              m.agentId === agentId &&
              (m.stopReason == null || m.stopReason === "")
            ) {
              mergeTargetIdx = i;
              break;
            }
            if (m.role === "user" || m.role === "system") break;
            if (
              m.role === "agent" &&
              m.stopReason != null &&
              m.stopReason !== ""
            )
              break;
          }
        }

        const effectiveMergeTarget =
          messageIdTargetIdx >= 0
            ? messageIdTargetIdx
            : shouldMergeIntoLast
              ? existing.length - 1
              : mergeTargetIdx;

        let newMessages: ChatMessage[];
        if (effectiveMergeTarget >= 0) {
          const merged = chunks.join("");
          const target = existing[effectiveMergeTarget];
          const updatedTarget: ChatMessage = {
            ...target,
            content: target.content + merged,
          };
          newMessages = [...existing];
          newMessages[effectiveMergeTarget] = updatedTarget;
        } else {
          // 4/5. No merge target — create a new ChatMessage.
          const writeSeq = useFileWriteStore.getState().currentSeq();
          const id = messageId ?? crypto.randomUUID();
          const merged = chunks.join("");
          newMessages = [
            ...existing,
            {
              id,
              role: "agent",
              content: merged,
              timestamp: Date.now(),
              agentId,
              sessionId,
              writeSeq,
            },
          ];
        }

        // Update last sessionUpdate type for next boundary check
        const updatedLastSessionUpdate = {
          ...state.lastSessionUpdateType,
          [sessionUpdateKey]: sessionUpdate ?? lastSessionUpdate ?? "",
        };

        return {
          ...state,
          perSession: { ...state.perSession, [key]: newMessages },
          streaming: { ...state.streaming, [key]: true },
          lastSessionUpdateType: updatedLastSessionUpdate,
        };
      }),

    appendStreamChunk: (
      key,
      agentId,
      sessionId,
      chunk,
      messageId?: string | null,
      sessionUpdate?: string | null
    ) =>
      set((state) => {
        const existing = state.perSession[key] ?? [];
        const lastMsg =
          existing.length > 0 ? existing[existing.length - 1] : null;

        // Track sessionUpdate type for boundary detection when no messageId
        const sessionUpdateKey = `${key}:${agentId}`;
        const lastSessionUpdate = state.lastSessionUpdateType[sessionUpdateKey];
        const sessionUpdateChanged =
          sessionUpdate != null &&
          lastSessionUpdate != null &&
          sessionUpdate !== lastSessionUpdate;

        // 1. messageId-based merge: find agent message with matching id
        let messageIdTargetIdx = -1;
        if (messageId != null) {
          for (let i = existing.length - 1; i >= 0; i--) {
            const m = existing[i];
            if (m.role === "agent" && m.id === messageId) {
              messageIdTargetIdx = i;
              break;
            }
            if (m.role === "user" || m.role === "system") break;
            if (
              m.role === "agent" &&
              m.stopReason != null &&
              m.stopReason !== ""
            )
              break;
          }
        }

        // 2. Direct merge: last message is same-agent, in-progress
        // IMPORTANT: If messageId was explicitly provided but didn't match any
        // existing message (messageIdTargetIdx < 0), we must NOT merge — the
        // messageId is an explicit ACP signal that this is a NEW logical message.
        // Also, if sessionUpdate type changed, we must NOT merge.
        const shouldAppend =
          messageId == null &&
          !sessionUpdateChanged &&
          lastMsg !== null &&
          lastMsg.role === "agent" &&
          lastMsg.agentId === agentId &&
          (lastMsg.stopReason == null || lastMsg.stopReason === "");

        // 3. Look back past tool messages for an in-progress agent message
        // IMPORTANT: Only look back if messageId was NOT explicitly provided
        // AND sessionUpdate type didn't change.
        // If messageId was provided but didn't match, it's an explicit ACP signal
        // for a NEW message — we must NOT merge with any previous message.
        let mergeTargetIdx = -1;
        if (
          !shouldAppend &&
          lastMsg !== null &&
          messageIdTargetIdx < 0 &&
          messageId == null &&
          !sessionUpdateChanged
        ) {
          for (let i = existing.length - 1; i >= 0; i--) {
            const m = existing[i];
            // Stop at tool messages: each tool_call starts a new step.
            // Without this, post-tool agent chunks merge into the pre-tool
            // agent message, causing splitIntoSteps to see only one perpetual step.
            if (m.role === "tool") break;
            if (
              m.role === "agent" &&
              m.agentId === agentId &&
              (m.stopReason == null || m.stopReason === "")
            ) {
              mergeTargetIdx = i;
              break;
            }
            if (m.role === "user" || m.role === "system") break;
            if (
              m.role === "agent" &&
              m.stopReason != null &&
              m.stopReason !== ""
            )
              break;
          }
        }

        const effectiveMergeTarget =
          messageIdTargetIdx >= 0
            ? messageIdTargetIdx
            : shouldAppend
              ? existing.length - 1
              : mergeTargetIdx;

        let newMessages: ChatMessage[];
        if (effectiveMergeTarget >= 0) {
          const target = existing[effectiveMergeTarget];
          const updatedTarget: ChatMessage = {
            ...target,
            content: target.content + chunk,
          };
          newMessages = [...existing];
          newMessages[effectiveMergeTarget] = updatedTarget;
        } else {
          // No merge target — create a new ChatMessage.
          const writeSeq = useFileWriteStore.getState().currentSeq();
          const id = messageId ?? crypto.randomUUID();
          newMessages = [
            ...existing,
            {
              id,
              role: "agent",
              content: chunk,
              timestamp: Date.now(),
              agentId,
              sessionId,
              writeSeq,
            },
          ];
        }

        // Update last sessionUpdate type for next boundary check
        const updatedLastSessionUpdate = {
          ...state.lastSessionUpdateType,
          [sessionUpdateKey]: sessionUpdate ?? lastSessionUpdate ?? "",
        };

        const newStreaming =
          state.streaming[key] === true
            ? state.streaming
            : { ...state.streaming, [key]: true };
        log.trace("appendStreamChunk", {
          key,
          agentId,
          chunkLen: chunk.length,
        });
        return {
          ...state,
          perSession: { ...state.perSession, [key]: newMessages },
          streaming: newStreaming,
          lastSessionUpdateType: updatedLastSessionUpdate,
        };
      }),

    updateLastAgentMessage: (key, update) =>
      set((state) => {
        const existing = state.perSession[key];
        if (!existing || existing.length === 0) return state;
        // Find the last agent message (skip tool messages so stopReason
        // is always stamped on the text response, not a tool-only message).
        // Also skip messages with stopReason — they belong to a PREVIOUS turn
        // and must not be mutated by subsequent turn events.
        for (let i = existing.length - 1; i >= 0; i--) {
          if (
            existing[i].role === "agent" &&
            (existing[i].stopReason == null || existing[i].stopReason === "")
          ) {
            const updated = { ...existing[i], ...update };
            const next = [...existing];
            next[i] = updated;
            return {
              ...state,
              perSession: { ...state.perSession, [key]: next },
            };
          }
        }
        // No agent message found — fall back to last tool message
        for (let i = existing.length - 1; i >= 0; i--) {
          if (existing[i].role === "tool") {
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
      // Return the last agent message that has no stopReason — this is the
      // "current" agent message that is still accepting chunks.
      for (let i = existing.length - 1; i >= 0; i--) {
        if (
          existing[i].role === "agent" &&
          (existing[i].stopReason == null || existing[i].stopReason === "")
        )
          return existing[i];
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

    updateMessageByMessageId: (key, messageId, update) =>
      set((state) => {
        const existing = state.perSession[key];
        if (!existing || existing.length === 0) return state;
        // Find the agent message with the matching messageId
        for (let i = existing.length - 1; i >= 0; i--) {
          if (existing[i].role === "agent" && existing[i].id === messageId) {
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
  })
);
