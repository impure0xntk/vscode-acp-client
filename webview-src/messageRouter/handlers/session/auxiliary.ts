import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { getLogger } from "../../../lib/logger";
import type { SlashCommand, AgentInfo } from "../../../store/sessionStore";
import type { QueuedPrompt } from "../../../types";

const log = getLogger("handlers.session.auxiliary");

interface AgentInfoMessage {
  type: "agentInfo";
  agentId: string;
  info: AgentInfo;
}

interface StatuslineMessage {
  type: "statusline";
  hostname?: string;
  repoName?: string;
  branch?: string;
  tag?: string;
}

interface SessionCommandsMessage {
  type: "session/commands";
  agentId: string;
  sessionId: string;
  commands: SlashCommand[];
}

interface QueueAddedMessage {
  type: "queue:added";
  agentId: string;
  sessionId: string;
  entry: QueuedPrompt;
}

interface QueueUpdatedMessage {
  type: "queue:updated";
  agentId: string;
  sessionId: string;
  queue: QueuedPrompt[];
}

interface QueueDequeuedMessage {
  type: "queue:dequeued";
  agentId: string;
  sessionId: string;
  entry: QueuedPrompt;
}

interface SessionTitleMessage {
  type: "session/title";
  agentId: string;
  sessionId: string;
  title: string;
}

interface SessionPinnedNotification {
  type: "session.pinned";
  agentId: string;
  sessionId: string;
}

interface SessionUnpinnedNotification {
  type: "session.unpinned";
  agentId: string;
  sessionId: string;
}

export function handleAgentInfo(data: AgentInfoMessage): void {
  useSessionStore.getState().setAgentInfo(data.agentId, data.info);
}

export function handleStatusline(data: StatuslineMessage): void {
  useSessionStore.getState().setStatusline({
    hostname: data.hostname,
    repoName: data.repoName,
    branch: data.branch,
    tag: data.tag,
  });
}

export function handleSessionCommands(data: SessionCommandsMessage): void {
  useSessionStore
    .getState()
    .setSessionCommands(data.agentId, data.sessionId, data.commands);
}

export function handleQueueAdded(data: QueueAddedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore.getState().addQueuedPrompt(key, data.entry);
}

export function handleQueueUpdated(data: QueueUpdatedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore.getState().setPromptQueue(key, data.queue);
}

export function handleQueueDequeued(data: QueueDequeuedMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  useSessionStore
    .getState()
    .updateQueuedPromptStatus(key, data.entry.id, "sending");
}

export function handleSessionTitle(data: SessionTitleMessage): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("session title changed", {
    agentId: data.agentId,
    sessionId: data.sessionId,
    title: data.title,
  });
  useSessionStore.getState().setTabTitle(key, data.title);
}

export function handleSessionPinned(data: SessionPinnedNotification): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("session pinned", {
    agentId: data.agentId,
    sessionId: data.sessionId,
  });
  useSessionStore.getState().pinSession(key);
}

export function handleSessionUnpinned(data: SessionUnpinnedNotification): void {
  const key = sessionKeyOf(data.agentId, data.sessionId);
  log.info("session unpinned", {
    agentId: data.agentId,
    sessionId: data.sessionId,
  });
  useSessionStore.getState().unpinSession(key);
}
