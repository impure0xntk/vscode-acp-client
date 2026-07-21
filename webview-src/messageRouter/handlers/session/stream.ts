import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import { getLogger } from "../../../lib/logger";
import {
  scheduleStreamFlush,
  flushBatch,
  deleteStreamBatch,
  getStreamBatch,
} from "../../shared/streamBuffer";

const log = getLogger("handlers.session.stream");

interface SessionStreamStart {
  type: "session/streamStart";
  agentId: string;
  sessionId: string;
}

interface SessionStream {
  type: "session/stream";
  agentId: string;
  sessionId: string;
  chunk: string;
  messageId?: string;
  sessionUpdate?: string;
}

interface SessionStreamEnd {
  type: "session/streamEnd";
  agentId: string;
  sessionId: string;
}

export function handleSessionStreamStart(data: SessionStreamStart): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  useMessageStore.getState().setStreaming(msgKey, true);
  const writeSeq = useFileWriteStore.getState().currentSeq();
  const lastAgentMsg = useMessageStore.getState().getLastAgentMessage(msgKey);
  log.info("handleSessionStreamStart", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    writeSeq,
    hasLastAgentMsg: !!lastAgentMsg,
    lastAgentMsgWriteSeq: lastAgentMsg?.writeSeq,
  });
  const batch = getStreamBatch(msgKey);
  if (batch && batch.chunks.length > 0) {
    flushBatch(msgKey, data.agentId, data.sessionId);
  }
}

export function handleSessionStream(data: SessionStream): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  scheduleStreamFlush(
    msgKey,
    data.agentId,
    data.sessionId,
    data.chunk,
    data.messageId,
    data.sessionUpdate
  );
}

export function handleSessionStreamEnd(data: SessionStreamEnd): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const batch = getStreamBatch(msgKey);
  if (batch && batch.chunks.length > 0) {
    flushBatch(msgKey, data.agentId, data.sessionId);
  }
  useMessageStore.getState().setStreaming(msgKey, false);
  useMessageStore.getState().finalizeThinking(msgKey);
  const existing = useSessionStore.getState().sessionInfoMap[msgKey];
  if (existing && existing.status === "running") {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: "idle",
      isStreaming: false,
      lastResponseAt: new Date().toISOString(),
    });
  }
}
