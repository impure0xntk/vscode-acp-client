import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { getLogger } from "../../../lib/logger";
import type { ChatMessage } from "../../../types";

const log = getLogger("handlers.session.message");

interface SessionMessageData {
  agentId: string;
  sessionId: string;
  message: ChatMessage;
}

/** Handle session/message: append a ChatMessage to the message store. */
export function handleSessionMessage(data: SessionMessageData): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const msg = data.message;
  const attachments =
    msg.attachments ??
    (msg.attachmentsJson
      ? (JSON.parse(
          msg.attachmentsJson
        ) as import("../../../types").ContextAttachment[])
      : undefined);

  if (msg.role === "tool" && msg.toolCalls && msg.toolCalls.length > 0) {
    const store = useMessageStore.getState();
    const existingMsgs = store.perSession[msgKey];
    if (existingMsgs) {
      const existingTcIds = new Set<string>();
      for (const m of existingMsgs) {
        if (m.role === "tool" && m.toolCalls) {
          for (const tc of m.toolCalls) existingTcIds.add(tc.id);
        }
      }
      const dedupedTCs = msg.toolCalls.filter(
        (tc) => !existingTcIds.has(tc.id)
      );
      if (dedupedTCs.length === 0) {
        log.debug("handleSessionMessage: skipping duplicate tool message", {
          msgKey,
          msgId: msg.id,
        });
        return;
      }
      if (dedupedTCs.length < msg.toolCalls.length) {
        log.debug("handleSessionMessage: deduplicating tool calls", {
          msgKey,
          before: msg.toolCalls.length,
          after: dedupedTCs.length,
        });
        useMessageStore
          .getState()
          .appendMessage(msgKey, {
            ...msg,
            attachments,
            toolCalls: dedupedTCs,
          });
        return;
      }
    }
  }

  useMessageStore.getState().appendMessage(msgKey, { ...msg, attachments });
}
