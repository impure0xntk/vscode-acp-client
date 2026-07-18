import { useMessageStore } from "../../store/messageStore";
import { useSessionStore } from "../../store/sessionStore";

export interface StreamBatch {
  chunks: string[];
  rafId: number | null;
  messageId?: string | null;
  sessionUpdate?: string | null;
}

const streamBatchMap = new Map<string, StreamBatch>();

export function flushBatch(
  msgKey: string,
  agentId: string,
  sessionId: string
): void {
  const batch = streamBatchMap.get(msgKey);
  if (!batch || batch.chunks.length === 0) return;
  if (batch.rafId != null) {
    cancelAnimationFrame(batch.rafId);
    batch.rafId = null;
  }
  const accumulated = batch.chunks;
  const messageId = batch.messageId;
  streamBatchMap.delete(msgKey);
  batch.chunks = [];

  useMessageStore
    .getState()
    .appendStreamChunks(
      msgKey,
      agentId,
      sessionId,
      accumulated,
      messageId,
      batch.sessionUpdate
    );
  const store = useSessionStore.getState();
  const existing = store.sessionInfoMap[msgKey];
  if (existing && existing.status === "running") {
    store.setSessionInfo(agentId, sessionId, {
      ...existing,
      lastResponseAt: new Date().toISOString(),
    });
  }
}

export function scheduleStreamFlush(
  msgKey: string,
  agentId: string,
  sessionId: string,
  chunk: string,
  messageId?: string,
  sessionUpdate?: string
): void {
  let batch = streamBatchMap.get(msgKey);
  if (!batch) {
    batch = {
      chunks: [],
      rafId: null,
      messageId: messageId ?? null,
      sessionUpdate: sessionUpdate ?? null,
    };
    streamBatchMap.set(msgKey, batch);
  } else if (batch.messageId == null && messageId != null) {
    batch.messageId = messageId;
  } else if (
    messageId != null &&
    batch.messageId != null &&
    messageId !== batch.messageId
  ) {
    flushBatch(msgKey, agentId, sessionId);
    batch = { chunks: [], rafId: null, messageId, sessionUpdate };
    streamBatchMap.set(msgKey, batch);
  } else if (
    sessionUpdate != null &&
    batch.sessionUpdate != null &&
    sessionUpdate !== batch.sessionUpdate
  ) {
    flushBatch(msgKey, agentId, sessionId);
    batch = {
      chunks: [],
      rafId: null,
      messageId: batch.messageId,
      sessionUpdate,
    };
    streamBatchMap.set(msgKey, batch);
  }
  batch.chunks.push(chunk);
  if (batch.sessionUpdate == null && sessionUpdate != null) {
    batch.sessionUpdate = sessionUpdate;
  }

  if (batch.rafId == null) {
    batch.rafId = requestAnimationFrame(() => {
      const b = streamBatchMap.get(msgKey);
      if (!b) return;
      streamBatchMap.delete(msgKey);
      const accumulated = b.chunks;
      b.chunks = [];
      b.rafId = null;

      useMessageStore
        .getState()
        .appendStreamChunks(
          msgKey,
          agentId,
          sessionId,
          accumulated,
          b.messageId,
          b.sessionUpdate
        );
      const store = useSessionStore.getState();
      const existing = store.sessionInfoMap[msgKey];
      if (existing && existing.status === "running") {
        store.setSessionInfo(agentId, sessionId, {
          ...existing,
          lastResponseAt: new Date().toISOString(),
        });
      }
    });
  }
}

/** Track the currently streaming agent message ID per session. */
export const streamingMessageIdMap = new Map<string, string>();

export function getStreamBatch(msgKey: string): StreamBatch | undefined {
  return streamBatchMap.get(msgKey);
}

export function deleteStreamBatch(msgKey: string): void {
  streamBatchMap.delete(msgKey);
}
