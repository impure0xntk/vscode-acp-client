import { create, type StoreApi } from "zustand";
import type { ChatMessage, QueuedPrompt } from "../types";
import { getLogger } from "../lib/logger";
import { useFileWriteStore } from "./fileWriteStore";

const log = getLogger("webview.store.message");

/**
 * Produce a session-unique id for a new streaming message.
 * When an ACP `messageId` is reused across turns (some agents do this), the
 * bare messageId would collide with a previous turn's message.  Suffix it
 * with `__N` so every message keeps a distinct `id` (React keys, dedup).
 */
function ensureUniqueMessageId(
  existing: ChatMessage[],
  messageId: string
): string {
  if (!existing.some((m) => m.id === messageId)) return messageId;
  let n = 1;
  while (existing.some((m) => m.id === `${messageId}__${n}`)) n++;
  return `${messageId}__${n}`;
}

/**
 * Index of the last still-streaming thinking message, scanning backward.
 * Stops at user/system boundaries; tool messages are skipped so a think that
 * preceded a tool call can still be finalized when a new think starts.
 * Returns -1 when no streaming thinking message exists.
 */
function findLastStreamingThinkingIndex(existing: ChatMessage[]): number {
  for (let i = existing.length - 1; i >= 0; i--) {
    const m = existing[i];
    if (m.role === "user" || m.role === "system") return -1;
    if (m.role === "tool") continue;
    if (
      m.role === "agent" &&
      m.thinking != null &&
      m.thinking.isStreaming === true
    ) {
      return i;
    }
    // A non-streaming agent message (response or finalized think) terminates.
    return -1;
  }
  return -1;
}

/**
 * Finalize the last streaming thinking message so it renders as a completed
 * "Thought" (no blink). Returns the same array reference when nothing changed.
 */
function finalizeLastStreamingThinking(existing: ChatMessage[]): ChatMessage[] {
  const idx = findLastStreamingThinkingIndex(existing);
  if (idx < 0) return existing;
  const target = existing[idx];
  const next = [...existing];
  next[idx] = {
    ...target,
    thinking: { ...target.thinking!, isStreaming: false },
  };
  return next;
}

/**
 * Append thought text into a dedicated thinking message.
 *
 * Thought chunks (agent_thought_chunk) are kept separate from the agent's
 * message body so they render in a ThinkingBlock instead of being
 * concatenated with the response.  We merge into the most recent
 * still-streaming thinking message when it is the SAME logical think
 * (matching or absent messageId); otherwise a new thinking message is
 * created and the previous streaming think is finalized — so a completed
 * think becomes a "Thought" (no blink) the moment a new think begins.
 */
function appendThinkingText(
  existing: ChatMessage[],
  merged: string,
  agentId: string,
  sessionId: string,
  messageId?: string | null
): ChatMessage[] {
  const thinkTargetIdx = findLastStreamingThinkingIndex(existing);

  if (thinkTargetIdx >= 0) {
    const target = existing[thinkTargetIdx];
    // Same logical think (matching or absent messageId) → append to it.
    const sameThink =
      messageId == null ||
      target.messageId == null ||
      target.messageId === messageId;
    if (sameThink) {
      const next = [...existing];
      next[thinkTargetIdx] = {
        ...target,
        thinking: {
          type: "thinking",
          content: target.thinking!.content + merged,
          isStreaming: true,
        },
      };
      return next;
    }
    // A different think started: the previous streaming think is done →
    // finalize it ("Thought") and create a fresh thinking message below.
    const finalized = [...existing];
    finalized[thinkTargetIdx] = {
      ...target,
      thinking: { ...target.thinking!, isStreaming: false },
    };
    return createThinkingMessage(
      finalized,
      merged,
      agentId,
      sessionId,
      messageId
    );
  }

  return createThinkingMessage(existing, merged, agentId, sessionId, messageId);
}

/**
 * Create a new streaming thinking message. Carries messageId so subsequent
 * chunks (or a following distinct think) can be correctly attributed.
 */
function createThinkingMessage(
  base: ChatMessage[],
  content: string,
  agentId: string,
  sessionId: string,
  messageId?: string | null
): ChatMessage[] {
  const writeSeq = useFileWriteStore.getState().currentSeq();
  const id = messageId ?? crypto.randomUUID();
  return [
    ...base,
    {
      id,
      role: "agent",
      content: "",
      timestamp: Date.now(),
      agentId,
      sessionId,
      writeSeq,
      messageId: messageId ?? undefined,
      thinking: {
        type: "thinking",
        content,
        isStreaming: true,
      },
    },
  ];
}

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
  /** Mark any still-streaming thinking blocks in a session as complete. */
  finalizeThinking: (key: string) => void;
  getLastAgentMessage: (key: string) => ChatMessage | null;
  clearSession: (key: string) => void;
  /** Add a queued prompt entry */
  addQueuedPrompt: (key: string, entry: QueuedPrompt) => void;
  /** Update a message by messageId (for streaming message stopReason stamping) */
  updateMessageByMessageId: (
    key: string,
    messageId: string,
    update: Partial<ChatMessage>
  ) => void;
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
        let existing = state.perSession[key] ?? [];

        // Track sessionUpdate type for boundary detection when no messageId
        const sessionUpdateKey = `${key}:${agentId}`;
        const lastSessionUpdate = state.lastSessionUpdateType[sessionUpdateKey];
        const sessionUpdateChanged =
          sessionUpdate != null &&
          lastSessionUpdate != null &&
          sessionUpdate !== lastSessionUpdate;

        // Thoughts are kept in their own message so they render as a thinking
        // block and are never concatenated with the agent's message body.
        if (sessionUpdate === "agent_thought_chunk") {
          const merged = chunks.join("");
          const newMessages = appendThinkingText(
            existing,
            merged,
            agentId,
            sessionId,
            messageId
          );
          return {
            ...state,
            perSession: { ...state.perSession, [key]: newMessages },
            streaming: { ...state.streaming, [key]: true },
            lastSessionUpdateType: {
              ...state.lastSessionUpdateType,
              [sessionUpdateKey]: sessionUpdate,
            },
          };
        }

        // A non-thinking stream chunk (response text, tool output, etc.)
        // supersedes any still-streaming thinking block — finalize it so it
        // renders as a completed "Thought" (no blink) instead of a perpetual
        // "Thinking…".  A completed think must not keep blinking once the
        // agent has moved on to producing the response.
        existing = finalizeLastStreamingThinking(existing);

        const lastMsg =
          existing.length > 0 ? existing[existing.length - 1] : null;

        // 1. messageId-based merge: find the agent message with matching id
        let messageIdTargetIdx = -1;
        if (messageId != null) {
          for (let i = existing.length - 1; i >= 0; i--) {
            const m = existing[i];
            // A thinking message carrying this id is a DISTINCT logical
            // message (the thought block), not the response.  Never merge a
            // response chunk into it — doing so would produce a single message
            // holding both `thinking` and `content`, which Message.tsx renders
            // mixed (thinking block + response body in one container).  When
            // thought and response share an ACP messageId, the response must
            // become its own message so they render as separate blocks.
            if (
              m.role === "agent" &&
              m.thinking == null &&
              m.id === messageId &&
              // Only merge into an in-progress message.  A matching message
              // that already carries a stopReason is a completed previous turn;
              // some ACP agents reuse the same messageId across distinct turns.
              // Merging there concatenates the previous turn's text into the new
              // turn's response, so the final step ends up showing the prior
              // step's message mixed in.  stopReason is stamped only after a
              // turn's chunks stop (session/turnEnded), so an in-flight message
              // never has one — making this a safe boundary signal.
              (m.stopReason == null || m.stopReason === "")
            ) {
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
        // Never merge into a thinking message: doing so appends the response
        // text onto the thinking message's content, so the final step renders a
        // normal message body instead of keeping the thought in its own block.
        const shouldMergeIntoLast =
          messageId == null &&
          !sessionUpdateChanged &&
          lastMsg !== null &&
          lastMsg.role === "agent" &&
          lastMsg.agentId === agentId &&
          (lastMsg.stopReason == null || lastMsg.stopReason === "") &&
          lastMsg.thinking == null;

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
          // ensureUniqueMessageId suffixes the id when it collides with an
          // existing message (e.g. a thinking message that shares this ACP
          // messageId), so separate logical messages keep distinct ids.
          const id = ensureUniqueMessageId(
            existing,
            messageId ?? crypto.randomUUID()
          );
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
        let existing = state.perSession[key] ?? [];

        // Track sessionUpdate type for boundary detection when no messageId
        const sessionUpdateKey = `${key}:${agentId}`;
        const lastSessionUpdate = state.lastSessionUpdateType[sessionUpdateKey];
        const sessionUpdateChanged =
          sessionUpdate != null &&
          lastSessionUpdate != null &&
          sessionUpdate !== lastSessionUpdate;

        // Thoughts are kept in their own message so they render as a thinking
        // block and are never concatenated with the agent's message body.
        if (sessionUpdate === "agent_thought_chunk") {
          const newMessages = appendThinkingText(
            existing,
            chunk,
            agentId,
            sessionId,
            messageId
          );
          return {
            ...state,
            perSession: { ...state.perSession, [key]: newMessages },
            streaming: { ...state.streaming, [key]: true },
            lastSessionUpdateType: {
              ...state.lastSessionUpdateType,
              [sessionUpdateKey]: sessionUpdate,
            },
          };
        }

        // A non-thinking stream chunk supersedes any still-streaming thinking
        // block — finalize it so it renders as a completed "Thought" (no blink).
        existing = finalizeLastStreamingThinking(existing);

        const lastMsg =
          existing.length > 0 ? existing[existing.length - 1] : null;

        // 1. messageId-based merge: find agent message with matching id
        let messageIdTargetIdx = -1;
        if (messageId != null) {
          for (let i = existing.length - 1; i >= 0; i--) {
            const m = existing[i];
            // A thinking message carrying this id is a DISTINCT logical
            // message (the thought block), not the response.  Never merge a
            // response chunk into it — doing so would produce a single message
            // holding both `thinking` and `content`, which Message.tsx renders
            // mixed (thinking block + response body in one container).  When
            // thought and response share an ACP messageId, the response must
            // become its own message so they render as separate blocks.
            if (
              m.role === "agent" &&
              m.thinking == null &&
              m.id === messageId &&
              // Only merge into an in-progress message.  A matching message
              // that already carries a stopReason is a completed previous turn;
              // some ACP agents reuse the same messageId across distinct turns.
              // Merging there concatenates the previous turn's text into the new
              // turn's response, so the final step ends up showing the prior
              // step's message mixed in.  stopReason is stamped only after a
              // turn's chunks stop (session/turnEnded), so an in-flight message
              // never has one — making this a safe boundary signal.
              (m.stopReason == null || m.stopReason === "")
            ) {
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
        // Never merge into a thinking message (same reason as shouldMergeIntoLast).
        const shouldAppend =
          messageId == null &&
          !sessionUpdateChanged &&
          lastMsg !== null &&
          lastMsg.role === "agent" &&
          lastMsg.agentId === agentId &&
          (lastMsg.stopReason == null || lastMsg.stopReason === "") &&
          lastMsg.thinking == null;

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
          // ensureUniqueMessageId suffixes the id when it collides with an
          // existing message (e.g. a thinking message that shares this ACP
          // messageId), so separate logical messages keep distinct ids.
          const id = ensureUniqueMessageId(
            existing,
            messageId ?? crypto.randomUUID()
          );
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
            !existing[i].thinking &&
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

    finalizeThinking: (key) =>
      set((state) => {
        const existing = state.perSession[key];
        if (!existing || existing.length === 0) return state;
        let changed = false;
        const next = existing.map((m) => {
          if (
            m.role === "agent" &&
            m.thinking != null &&
            m.thinking.isStreaming === true
          ) {
            changed = true;
            return { ...m, thinking: { ...m.thinking, isStreaming: false } };
          }
          return m;
        });
        if (!changed) return state;
        return {
          ...state,
          perSession: { ...state.perSession, [key]: next },
        };
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
