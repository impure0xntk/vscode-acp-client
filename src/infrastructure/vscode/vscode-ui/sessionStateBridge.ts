import type { TokenUsage } from "../../../application/session/types";
import type {
  ChatMessage,
  ContextAttachmentDTO,
} from "../../../domain/models/chat";

/**
 * Minimum interface that any panel (ChatPanel, MiniChatPanel) must implement
 * to receive session-state updates from the orchestrator via the bridge.
 *
 * The bridge calls these methods on every registered target so that all
 * open panels stay in sync without direct coupling between them.
 */
export interface SessionStateTarget {
  /** Unfiltered postMessage for free-form messages (setTabs, overview, etc.) */
  postMessage(message: unknown): void;

  pushMessage(
    agentId: string,
    sessionId: string,
    message: ChatMessage,
    cwd?: string
  ): void;

  pushSessionInfo(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").AppSessionInfo
  ): void;

  pushSessionSnapshot(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").AppSessionInfo
  ): void;

  pushStreamChunk(
    agentId: string,
    sessionId: string,
    chunk: string,
    messageId?: string,
    sessionUpdate?: string
  ): void;

  pushStreamEnd(agentId: string, sessionId: string): void;

  pushTurnActive(
    agentId: string,
    sessionId: string,
    active: boolean
  ): void;

  pushSessionNotification(
    agentId: string,
    sessionId: string,
    notification: unknown
  ): void;

  pushFileWrite(
    agentId: string,
    sessionId: string,
    path: string,
    content: string,
    originalContent?: string | null,
    contentHash?: string
  ): void;

  pushSessionUsage(
    agentId: string,
    sessionId: string,
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    contextWindowMax?: number
  ): void;

  pushSessionCompression(
    agentId: string,
    sessionId: string,
    info: {
      contextWindowMax: number;
      usedTokens: number;
      usedBefore?: number;
    }
  ): void;

  setAgentInfo(agentId: string, info: unknown): void;

  setActiveSession(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").AppSessionInfo
  ): void;

  pushAvailableCommands(
    agentId: string,
    sessionId: string,
    commands: unknown[]
  ): void;

  /** Called when the panel is disposed — the bridge removes it. */
  onDidDispose: { event: (fn: () => void) => { dispose(): void } };

  logger: {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  } | null;
}

/**
 * Central dispatcher for session-state events.
 *
 * All orchestrator event wiring pushes through the bridge rather than
 * referencing specific panel instances. Panels register on creation and
 * unregister on disposal.
 *
 * This decouples SessionOrchestrator wiring from concrete UI panels,
 * enabling MiniChat, UnifiedChat, or any future panel to receive the
 * same session-state updates without code changes in the event layer.
 */
export class SessionStateBridge {
  private targets = new Set<SessionStateTarget>();

  register(target: SessionStateTarget): void {
    this.targets.add(target);
    // Auto-unregister when the panel disposes.
    target.onDidDispose.event(() => {
      this.unregister(target);
    });
  }

  unregister(target: SessionStateTarget): void {
    this.targets.delete(target);
  }

  get size(): number {
    return this.targets.size;
  }

  // ── broadcast helpers ──────────────────────────────────────────────

  postMessage(message: unknown): void {
    for (const t of this.targets) t.postMessage(message);
  }

  pushMessage(
    agentId: string,
    sessionId: string,
    message: ChatMessage,
    cwd?: string
  ): void {
    for (const t of this.targets) t.pushMessage(agentId, sessionId, message, cwd);
  }

  pushSessionInfo(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").AppSessionInfo
  ): void {
    for (const t of this.targets) t.pushSessionInfo(agentId, sessionId, info);
  }

  pushSessionSnapshot(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").AppSessionInfo
  ): void {
    for (const t of this.targets) t.pushSessionSnapshot(agentId, sessionId, info);
  }

  pushStreamChunk(
    agentId: string,
    sessionId: string,
    chunk: string,
    messageId?: string,
    sessionUpdate?: string
  ): void {
    for (const t of this.targets)
      t.pushStreamChunk(agentId, sessionId, chunk, messageId, sessionUpdate);
  }

  pushStreamEnd(agentId: string, sessionId: string): void {
    for (const t of this.targets) t.pushStreamEnd(agentId, sessionId);
  }

  pushTurnActive(agentId: string, sessionId: string, active: boolean): void {
    for (const t of this.targets)
      t.pushTurnActive(agentId, sessionId, active);
  }

  pushSessionNotification(
    agentId: string,
    sessionId: string,
    notification: unknown
  ): void {
    for (const t of this.targets)
      t.pushSessionNotification(agentId, sessionId, notification);
  }

  pushFileWrite(
    agentId: string,
    sessionId: string,
    path: string,
    content: string,
    originalContent?: string | null,
    contentHash?: string
  ): void {
    for (const t of this.targets)
      t.pushFileWrite(
        agentId,
        sessionId,
        path,
        content,
        originalContent,
        contentHash
      );
  }

  pushSessionUsage(
    agentId: string,
    sessionId: string,
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    contextWindowMax?: number
  ): void {
    for (const t of this.targets)
      t.pushSessionUsage(agentId, sessionId, tokenUsage, contextWindowMax);
  }

  pushSessionCompression(
    agentId: string,
    sessionId: string,
    info: {
      contextWindowMax: number;
      usedTokens: number;
      usedBefore?: number;
    }
  ): void {
    for (const t of this.targets)
      t.pushSessionCompression(agentId, sessionId, info);
  }

  setAgentInfo(agentId: string, info: unknown): void {
    for (const t of this.targets) t.setAgentInfo(agentId, info);
  }

  setActiveSession(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").AppSessionInfo
  ): void {
    for (const t of this.targets) t.setActiveSession(agentId, sessionId, info);
  }

  pushAvailableCommands(
    agentId: string,
    sessionId: string,
    commands: unknown[]
  ): void {
    for (const t of this.targets)
      t.pushAvailableCommands(agentId, sessionId, commands);
  }
}
