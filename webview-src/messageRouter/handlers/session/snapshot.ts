import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { toSessionInfoDTO } from "../../../store/mappers";
import { getLogger } from "../../../lib/logger";
import { setPendingSnapshotKey } from "../../shared/guards";
import type { ChatMessage } from "../../../types";

const log = getLogger("handlers.session.snapshot");

interface SessionSnapshot {
  type: "session/snapshot";
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  tokenUsage: import("../../../types").TokenUsage;
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  status: string;
  isStreaming: boolean;
  createdAt: string;
  lastResponseAt: string | null;
}

interface SessionInfo {
  type: "session/info";
  agentId: string;
  sessionId: string;
  status: string;
  lastTurnOutcome: string | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  isStreaming: boolean;
  createdAt: string;
  lastResponseAt: string | null;
}

interface SessionUsage {
  type: "session/usage";
  agentId: string;
  sessionId: string;
  tokenUsage: import("../../../types").TokenUsage;
  contextWindowMax?: number;
}

interface SessionCompression {
  type: "session/compression";
  agentId: string;
  sessionId: string;
  contextWindowMax: number;
  usedTokens: number;
  usedBefore?: number;
}

interface SessionCompleted {
  type: "session/completed";
  agentId: string;
  sessionId: string;
  title: string;
  stopReason?: string;
}

export function handleSessionSnapshot(data: SessionSnapshot): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("handleSessionSnapshot", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    messageCount: data.messages.length,
  });

  const messages = data.messages.map((msg) => {
    let next = msg;
    if (msg.attachmentsJson && !msg.attachments) {
      try {
        const attachments = JSON.parse(
          msg.attachmentsJson
        ) as import("../../../types").ContextAttachment[];
        next = { ...next, attachments };
      } catch {
        /* keep original */
      }
    }
    const tcJson = (msg as { toolCallsJson?: string }).toolCallsJson;
    if (tcJson && !msg.toolCalls) {
      try {
        const toolCalls = JSON.parse(
          tcJson
        ) as import("../../../types").ToolCall[];
        next = { ...next, toolCalls };
      } catch {
        /* keep original */
      }
    }
    return next;
  });

  useMessageStore.getState().setMessages(key, messages);

  const dto = toSessionInfoDTO({
    sessionId: data.sessionId,
    agentId: data.agentId,
    status: data.status,
    lastTurnOutcome: null,
    isStreaming: data.isStreaming,
    tokenUsage: {
      input: data.tokenUsage.inputTokens,
      output: data.tokenUsage.outputTokens,
      total: data.tokenUsage.totalTokens,
    },
    contextWindowMax: data.contextWindowMax,
    model: data.model,
    mode: data.mode,
    cwd: data.cwd,
    createdAt: data.createdAt,
    lastResponseAt: data.lastResponseAt,
  });
  useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, dto);

  const sessionStore = useSessionStore.getState();
  if (!sessionStore.tabOrder.includes(key)) {
    sessionStore.addTab(
      data.agentId,
      data.sessionId,
      data.sessionId.slice(0, 8)
    );
  }

  sessionStore.setActiveSession(key);
  setPendingSnapshotKey(key);
}

export function handleSessionInfo(data: SessionInfo): void {
  const dto = toSessionInfoDTO({
    sessionId: data.sessionId,
    agentId: data.agentId,
    status: data.status,
    lastTurnOutcome: data.lastTurnOutcome,
    isStreaming: data.isStreaming,
    tokenUsage: {
      input: data.tokenUsage.inputTokens,
      output: data.tokenUsage.outputTokens,
      total: data.tokenUsage.totalTokens,
    },
    contextWindowMax: data.contextWindowMax,
    model: data.model,
    mode: data.mode,
    cwd: data.cwd,
    createdAt: data.createdAt,
    lastResponseAt: data.lastResponseAt,
  });
  useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, dto);
}

export function handleSessionUsage(data: SessionUsage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const existing = useSessionStore.getState().sessionInfoMap[key];
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      tokenUsage: data.tokenUsage,
      contextWindowMax: data.contextWindowMax ?? existing.contextWindowMax,
    });
  }
}

export function handleSessionCompression(data: SessionCompression): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const compressionMsg: ChatMessage = {
    id: `compression-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "system",
    content: "",
    timestamp: Date.now(),
    agentId: data.agentId,
    sessionId: data.sessionId,
    compressionInfo: {
      contextWindowMax: data.contextWindowMax,
      usedTokens: data.usedTokens,
      usedBefore: data.usedBefore,
    },
  };
  useMessageStore.getState().appendMessage(msgKey, compressionMsg);
}

export function handleSessionCompleted(data: SessionCompleted): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const existing = useSessionStore.getState().sessionInfoMap[key];
  log.info("handleSessionCompleted", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    title: data.title,
    stopReason: data.stopReason,
  });
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: "completed",
      isStreaming: false,
      lastResponseAt: new Date().toISOString(),
    });
  }
  const outcome: "completed" | "error" | "cancelled" = data.stopReason
    ? data.stopReason === "end_turn" || data.stopReason === "max_turn_requests"
      ? "completed"
      : data.stopReason === "cancelled"
        ? "cancelled"
        : "error"
    : "completed";
  useSessionStore.getState().setCompletionNotification({
    agentId: data.agentId,
    sessionId: data.sessionId,
    title: data.title,
    outcome,
  });
}
