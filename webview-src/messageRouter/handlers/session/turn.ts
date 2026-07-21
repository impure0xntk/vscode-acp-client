import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { clearDiffCache } from "../../../pipeline/stages/grouping";
import { getLogger } from "../../../lib/logger";
import { pendingSwitchGuard, setPendingSwitchGuard } from "../../shared/guards";

const log = getLogger("handlers.session.turn");

interface SessionSwitch {
  type: "session/switch";
  agentId: string;
  sessionId: string;
  tokenUsage?: import("../../../types").TokenUsage;
  contextWindowMax?: number;
  model?: string;
  mode?: string;
  cwd?: string;
  createdAt?: string;
  isStreaming?: boolean;
}

interface SessionTurnActive {
  type: "session/turnActive";
  agentId: string;
  sessionId: string;
  active: boolean;
  action?: string;
}

interface SessionTurnEnded {
  type: "session/turnEnded";
  agentId: string;
  sessionId: string;
  stopReason: string;
}

export function handleSessionSwitch(data: SessionSwitch): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const currentKey = useSessionStore.getState().activeSessionKey;
  log.info("handleSessionSwitch", {
    from: currentKey,
    to: key,
    hasTokenUsage: !!data.tokenUsage,
    model: data.model,
  });

  if (currentKey === key) {
    log.debug("handleSessionSwitch: already active, skipping", { key });
    setPendingSwitchGuard(null);
    return;
  }

  if (pendingSwitchGuard !== null && pendingSwitchGuard !== key) {
    log.info("handleSessionSwitch: stale echo discarded", {
      expected: pendingSwitchGuard,
      received: key,
    });
    return;
  }

  setPendingSwitchGuard(null);
  clearDiffCache();

  const sessionStore = useSessionStore.getState();
  if (!sessionStore.tabOrder.includes(key)) {
    sessionStore.addTab(
      data.agentId,
      data.sessionId,
      data.sessionId.slice(0, 8)
    );
  }
  if (currentKey !== key) {
    sessionStore.setActiveSession(key);
  }
}

export function handleSessionTurnActive(data: SessionTurnActive): void {
  const msgKey = sessionKeyOf(data.agentId, data.sessionId);
  const active = data.active;
  log.debug("handleSessionTurnActive", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    active,
    action: data.action,
  });

  useMessageStore.getState().setStreaming(msgKey, active);

  const existing = useSessionStore.getState().sessionInfoMap[msgKey];
  if (existing) {
    const nextStatus =
      existing.status === "cancelling"
        ? "cancelling"
        : active
          ? "running"
          : "idle";
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      isStreaming: active,
      status: nextStatus,
    });
  }
}

export function handleSessionTurnEnded(data: SessionTurnEnded): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  const existing = useSessionStore.getState().sessionInfoMap[key];
  log.info("handleSessionTurnEnded", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    stopReason: data.stopReason,
  });

  const msgKey = key;
  const batch = getStreamBatch(msgKey);
  if (batch && batch.chunks.length > 0) {
    flushBatch(msgKey, data.agentId, data.sessionId);
    const store = useSessionStore.getState();
    const existingInfo = store.sessionInfoMap[msgKey];
    if (existingInfo && existingInfo.status === "running") {
      store.setSessionInfo(data.agentId, data.sessionId, {
        ...existingInfo,
        lastResponseAt: new Date().toISOString(),
      });
    }
  }

  clearDiffCache();
  removePipelineCache(key);

  useMessageStore.getState().updateLastAgentMessage(key, {
    stopReason: data.stopReason,
  });
  useMessageStore.getState().finalizeThinking(key);
  useMessageStore.getState().setStreaming(key, false);

  const outcome: "completed" | "error" | "cancelled" =
    data.stopReason === "end_turn" || data.stopReason === "max_turn_requests"
      ? "completed"
      : data.stopReason === "cancelled"
        ? "cancelled"
        : "error";
  if (existing) {
    useSessionStore.getState().setSessionInfo(data.agentId, data.sessionId, {
      ...existing,
      status: outcome === "completed" ? "idle" : existing.status,
      isStreaming: false,
      lastTurnOutcome: outcome,
      lastResponseAt: new Date().toISOString(),
    });
  }
  if (data.stopReason === "refusal" || data.stopReason === "max_tokens") {
    useSessionStore.getState().setCompletionNotification({
      agentId: data.agentId,
      sessionId: data.sessionId,
      title: existing?.title ?? data.sessionId.slice(0, 8),
      outcome,
    });
  }
}

// Import from streamBuffer (circular dependency resolved via shared module)
import { getStreamBatch, flushBatch } from "../../shared/streamBuffer";
import { removePipelineCache } from "../../../hooks/useMessagePipeline";
