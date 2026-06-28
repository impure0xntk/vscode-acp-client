import type { AppSessionInfo, QueuedPrompt } from "./types";
import type { ToolCall } from "../../domain/models/chat";
import type { PromptBuilder } from "../../domain/services/prompt-builder";
import type { InboundMessage, MeshProtocolConfig } from "../../domain/services/prompt-builder";
import { getLogger } from "../../platform/backends";

const log = getLogger("session-state");

export function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

export class SessionState {
  // agentId → (sessionId → AppSessionInfo)
  private sessions: Map<string, Map<string, AppSessionInfo>> = new Map();
  // agentId → active sessionId
  private activeSessions: Map<string, string> = new Map();
  // agentId → Set<sessionId>
  private pinnedSessions: Map<string, Set<string>> = new Map();

  // Streaming text buffer: sessionKey → accumulated text
  private streamTextBuffer: Map<string, string> = new Map();
  // Streaming message ref: sessionKey → { agentId, sessionId, msgId }
  private streamMsgRef: Map<string, { agentId: string; sessionId: string; msgId: string }> = new Map();

  // Tool call buffering: sessionKey → Map<kind, ToolCall[]>
  private pendingToolCalls: Map<string, Map<string, ToolCall[]>> = new Map();

  // Prompt queue: sessionKey → QueuedPrompt[]
  private promptQueue: Map<string, QueuedPrompt[]> = new Map();

  // PromptBuilder registry: agentId → PromptBuilder
  private promptBuilders: Map<string, PromptBuilder> = new Map();

  // Last inbound message per agent (Mesh Protocol reinjection)
  private lastInboundMessages: Map<string, InboundMessage> = new Map();
  // Reinjection throttle: agentId → timestamp
  private lastReinjectionAt: Map<string, number> = new Map();

  getAgentSessions(agentId: string): Map<string, AppSessionInfo> | undefined {
    return this.sessions.get(agentId);
  }

  getOrCreateAgentSessions(agentId: string): Map<string, AppSessionInfo> {
    let m = this.sessions.get(agentId);
    if (!m) {
      m = new Map();
      this.sessions.set(agentId, m);
    }
    return m;
  }

  getSessionInfo(agentId: string, sessionId: string): AppSessionInfo | undefined {
    return this.sessions.get(agentId)?.get(sessionId);
  }

  setSessionInfo(agentId: string, sessionId: string, info: AppSessionInfo): void {
    const agentSessions = this.getOrCreateAgentSessions(agentId);
    agentSessions.set(sessionId, info);
  }

  removeSession(agentId: string, sessionId: string): void {
    this.sessions.get(agentId)?.delete(sessionId);
  }

  removeAgent(agentId: string): void {
    this.sessions.delete(agentId);
    this.activeSessions.delete(agentId);
    this.pinnedSessions.delete(agentId);
    this.promptBuilders.delete(agentId);
    this.lastInboundMessages.delete(agentId);
    this.lastReinjectionAt.delete(agentId);
    for (const [key] of this.promptQueue) {
      if (key.startsWith(`${agentId}:`)) {
        this.promptQueue.delete(key);
      }
    }
  }

  getSessionsForAgent(agentId: string): AppSessionInfo[] {
    const agentSessions = this.sessions.get(agentId);
    if (!agentSessions) return [];
    return Array.from(agentSessions.values());
  }

  getAllSessions(): Map<string, AppSessionInfo[]> {
    const result = new Map<string, AppSessionInfo[]>();
    for (const [agentId, agentSessions] of this.sessions) {
      result.set(agentId, Array.from(agentSessions.values()));
    }
    return result;
  }

  getAllSessionsFlat(): Array<{ agentId: string; sessionId: string; info: AppSessionInfo }> {
    const result: Array<{ agentId: string; sessionId: string; info: AppSessionInfo }> = [];
    for (const [agentId, agentSessions] of this.sessions) {
      for (const [sessionId, info] of agentSessions) {
        result.push({ agentId, sessionId, info });
      }
    }
    return result;
  }

  findSessionGlobally(sessionId: string): { agentId: string; info: AppSessionInfo } | undefined {
    for (const [agentId, agentSessions] of this.sessions) {
      const info = agentSessions.get(sessionId);
      if (info) return { agentId, info };
    }
    return undefined;
  }

  getActiveSessionId(agentId: string): string | undefined {
    return this.activeSessions.get(agentId);
  }

  setActiveSession(agentId: string, sessionId: string): void {
    this.activeSessions.set(agentId, sessionId);
  }

  clearActiveSession(agentId: string): void {
    this.activeSessions.delete(agentId);
  }

  getActiveSessionInfo(agentId: string): AppSessionInfo | undefined {
    const sessionId = this.activeSessions.get(agentId);
    if (!sessionId) return undefined;
    return this.sessions.get(agentId)?.get(sessionId);
  }

  pinSession(agentId: string, sessionId: string): void {
    let pinned = this.pinnedSessions.get(agentId);
    if (!pinned) {
      pinned = new Set();
      this.pinnedSessions.set(agentId, pinned);
    }
    pinned.add(sessionId);
  }

  unpinSession(agentId: string, sessionId: string): void {
    const pinned = this.pinnedSessions.get(agentId);
    if (!pinned) return;
    pinned.delete(sessionId);
    if (pinned.size === 0) this.pinnedSessions.delete(agentId);
  }

  getPinnedSessions(agentId: string): string[] {
    return Array.from(this.pinnedSessions.get(agentId) ?? []);
  }

  isSessionPinned(agentId: string, sessionId: string): boolean {
    return this.pinnedSessions.get(agentId)?.has(sessionId) ?? false;
  }

  getStreamText(sessionKey: string): string | undefined {
    return this.streamTextBuffer.get(sessionKey);
  }

  setStreamText(sessionKey: string, text: string): void {
    this.streamTextBuffer.set(sessionKey, text);
  }

  appendStreamText(sessionKey: string, chunk: string): string {
    const existing = this.streamTextBuffer.get(sessionKey) ?? "";
    const updated = existing + chunk;
    this.streamTextBuffer.set(sessionKey, updated);
    return updated;
  }

  clearStreamText(sessionKey: string): void {
    this.streamTextBuffer.delete(sessionKey);
  }

  getStreamMsgRef(sessionKey: string): { agentId: string; sessionId: string; msgId: string } | undefined {
    return this.streamMsgRef.get(sessionKey);
  }

  setStreamMsgRef(sessionKey: string, ref: { agentId: string; sessionId: string; msgId: string }): void {
    this.streamMsgRef.set(sessionKey, ref);
  }

  clearStreamMsgRef(sessionKey: string): void {
    this.streamMsgRef.delete(sessionKey);
  }

  getPendingToolCalls(sessionKey: string): Map<string, ToolCall[]> | undefined {
    return this.pendingToolCalls.get(sessionKey);
  }

  setPendingToolCalls(sessionKey: string, buffered: Map<string, ToolCall[]>): void {
    this.pendingToolCalls.set(sessionKey, buffered);
  }

  clearPendingToolCalls(sessionKey: string): void {
    this.pendingToolCalls.delete(sessionKey);
  }

  getQueue(sessionKey: string): QueuedPrompt[] {
    return this.promptQueue.get(sessionKey) ?? [];
  }

  setQueue(sessionKey: string, queue: QueuedPrompt[]): void {
    if (queue.length === 0) {
      this.promptQueue.delete(sessionKey);
    } else {
      this.promptQueue.set(sessionKey, queue);
    }
  }

  addToQueue(sessionKey: string, entry: QueuedPrompt): void {
    const queue = this.promptQueue.get(sessionKey) ?? [];
    queue.push(entry);
    this.promptQueue.set(sessionKey, queue);
  }

  removeFromQueue(sessionKey: string, promptId: string): boolean {
    const queue = this.promptQueue.get(sessionKey);
    if (!queue) return false;
    const idx = queue.findIndex((e) => e.id === promptId && e.status === "pending");
    if (idx === -1) return false;
    queue.splice(idx, 1);
    if (queue.length === 0) {
      this.promptQueue.delete(sessionKey);
    }
    return true;
  }

  getPromptBuilder(agentId: string): PromptBuilder | undefined {
    return this.promptBuilders.get(agentId);
  }

  setPromptBuilder(agentId: string, builder: PromptBuilder): void {
    this.promptBuilders.set(agentId, builder);
  }

  getLastInboundMessage(agentId: string): InboundMessage | undefined {
    return this.lastInboundMessages.get(agentId);
  }

  setLastInboundMessage(agentId: string, msg: InboundMessage): void {
    this.lastInboundMessages.set(agentId, msg);
  }

  getLastReinjectionAt(agentId: string): number {
    return this.lastReinjectionAt.get(agentId) ?? 0;
  }

  setLastReinjectionAt(agentId: string, ts: number): void {
    this.lastReinjectionAt.set(agentId, ts);
  }

  dispose(): void {
    this.sessions.clear();
    this.activeSessions.clear();
    this.pinnedSessions.clear();
    this.streamTextBuffer.clear();
    this.streamMsgRef.clear();
    this.pendingToolCalls.clear();
    this.promptQueue.clear();
    this.promptBuilders.clear();
    this.lastInboundMessages.clear();
    this.lastReinjectionAt.clear();
  }
}
