import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { useFileWriteStore } from "../../../store/fileWriteStore";
import { getLogger } from "../../../lib/logger";
import {
  safeJsonStringify,
  normalizeToolStatus,
  extractDiffFromContent,
} from "../../shared/utils";
import type { ChatMessage } from "../../../types";

const log = getLogger("handlers.session.notification");

interface SessionNotificationMessage {
  type: "session/notification";
  agentId: string;
  sessionId: string;
  notification: {
    update: {
      sessionUpdate: string;
      [key: string]: unknown;
    };
    sessionId: string;
  };
}

interface SessionFileWriteMessage {
  type: "session/webviewFileWrite";
  agentId: string;
  sessionId: string;
  path: string;
  content: string;
  originalContent?: string | null;
  contentHash?: string;
}

export function handleSessionNotification(
  data: SessionNotificationMessage
): void {
  const { agentId, sessionId, notification } = data;
  const update = notification.update;
  const su = update.sessionUpdate;

  if (su !== "tool_call" && su !== "tool_call_update") return;

  const msgKey = sessionKeyOf(agentId, sessionId);

  if (su === "tool_call") {
    const tcId = update.toolCallId as string;
    const tcTitle = (update.title as string) ?? "";
    const tcStatus = normalizeToolStatus(update.status as string | null);
    const tcKind = (update.kind as string) ?? "";
    const rawInput = update.rawInput;
    const rawOutput = update.rawOutput;
    const tcLocations = (
      update.locations as Array<{ path: string; line?: number }> | undefined
    )?.map((loc) => ({ path: loc.path, line: loc.line ?? undefined }));
    const tcDiff = extractDiffFromContent(
      update.content as
        | Array<{ type: string; [key: string]: unknown }>
        | undefined
    );

    const toolCall = {
      id: tcId,
      title: tcTitle,
      status: tcStatus,
      kind: tcKind,
      input:
        typeof rawInput === "string" ? rawInput : safeJsonStringify(rawInput),
      output:
        rawOutput !== undefined
          ? typeof rawOutput === "string"
            ? rawOutput
            : safeJsonStringify(rawOutput)
          : undefined,
      locations: tcLocations,
      diffContent: tcDiff,
    };

    const store = useMessageStore.getState();
    const existingMsgs = store.perSession[msgKey];

    if (existingMsgs) {
      const alreadyExists = existingMsgs.some(
        (m: ChatMessage) =>
          m.role === "tool" && m.toolCalls?.some((tc) => tc.id === tcId)
      );
      if (alreadyExists) {
        log.debug("handleSessionNotification: skipping duplicate tool_call", {
          msgKey,
          tcId,
        });
        return;
      }
    }

    if (existingMsgs && existingMsgs.length > 0) {
      const lastMsg = existingMsgs[existingMsgs.length - 1];
      if (lastMsg.role === "tool") {
        log.debug(
          "handleSessionNotification: appending to existing tool message",
          {
            msgKey,
            lastMsgId: lastMsg.id,
            incomingToolId: tcId,
          }
        );
        useMessageStore
          .getState()
          .updateMessage(msgKey, existingMsgs.length - 1, {
            ...lastMsg,
            toolCalls: [...(lastMsg.toolCalls ?? []), toolCall],
          });
      } else {
        const toolMsg = {
          id: `tc-${tcKind}-${tcId}-${Date.now()}`,
          role: "tool" as const,
          content: "",
          timestamp: Date.now(),
          agentId,
          sessionId,
          toolCalls: [toolCall],
        };
        store.appendMessage(msgKey, toolMsg);
      }
    } else {
      const toolMsg = {
        id: `tc-${tcKind}-${tcId}-${Date.now()}`,
        role: "tool" as const,
        content: "",
        timestamp: Date.now(),
        agentId,
        sessionId,
        toolCalls: [toolCall],
      };
      store.appendMessage(msgKey, toolMsg);
    }
  } else if (su === "tool_call_update") {
    const tcId = update.toolCallId as string;
    const store = useMessageStore.getState();
    const existingMsgs = store.perSession[msgKey];
    if (!existingMsgs) return;

    log.debug("handleSessionNotification: tool_call_update", {
      msgKey,
      tcId,
      status: update.status,
    });

    for (let i = existingMsgs.length - 1; i >= 0; i--) {
      const m = existingMsgs[i];
      if (m.toolCalls?.some((tc) => tc.id === tcId)) {
        const updatedTCs = (m.toolCalls ?? []).map((tc) => {
          if (tc.id !== tcId) return tc;
          const rawInput = update.rawInput;
          const rawOutput = update.rawOutput;
          return {
            ...tc,
            title: (update.title as string) ?? tc.title,
            status: normalizeToolStatus((update.status as string) ?? tc.status),
            kind: (update.kind as string) ?? tc.kind,
            input:
              rawInput !== undefined
                ? typeof rawInput === "string"
                  ? rawInput
                  : safeJsonStringify(rawInput)
                : tc.input,
            output:
              rawOutput !== undefined
                ? typeof rawOutput === "string"
                  ? rawOutput
                  : safeJsonStringify(rawOutput)
                : tc.output,
            locations:
              (
                update.locations as
                  | Array<{ path: string; line?: number }>
                  | undefined
              )?.map((loc) => ({
                path: loc.path,
                line: loc.line ?? undefined,
              })) ?? tc.locations,
            diffContent:
              extractDiffFromContent(
                update.content as
                  | Array<{ type: string; [key: string]: unknown }>
                  | undefined
              ) ?? tc.diffContent,
          };
        });
        store.updateMessage(msgKey, i, { ...m, toolCalls: updatedTCs });
        break;
      }
    }
  }
}

export function handleSessionFileWrite(data: SessionFileWriteMessage): void {
  log.debug("handleSessionFileWrite", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    path: data.path,
    contentLen: data.content.length,
    hasOriginal: data.originalContent !== undefined,
  });
  useFileWriteStore
    .getState()
    .addWrite(
      data.agentId,
      data.sessionId,
      data.path,
      data.content,
      data.originalContent ?? null,
      data.contentHash
    );
}
