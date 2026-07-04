import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ChatMessage } from "../../domain/models/chat";
import type { AppSessionInfo, QueuedPrompt } from "./types";
import type { AgentConnection } from "./agent-connection";
import type { SessionState } from "./session-state";
import { sessionKey } from "./session-state";
import type { PromptExecution } from "./prompt-execution";
import type { PersistentHistoryStore } from "./persistentHistory";
import type { SessionHistoryStore, HistoryEntry } from "./historyStore";
import type { RestoreResult } from "./types";
import { abbreviatePath } from "../../shared/util/path";
import { getLogger } from "../../platform/backends";
import { sessionNotFound, connectionFailed } from "../../adapter/acp/error";

const log = getLogger("session-lifecycle");

function withTimeout<T>(
  promise: Promise<T>,
  rejectMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${rejectMs}ms: ${label}`));
    }, rejectMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface SessionLifecycleDeps {
  agentConnection: AgentConnection;
  sessionState: SessionState;
  promptExecution: PromptExecution;
  historyStore: PersistentHistoryStore | null;
  sessionHistoryStore: SessionHistoryStore | null;
  /** Emit orchestrator event (sessionReplayStart, etc.) */
  emit: (event: string, ...args: unknown[]) => void;
}

export class SessionLifecycle {
  private deps: SessionLifecycleDeps;

  constructor(deps: SessionLifecycleDeps) {
    this.deps = deps;
  }

  async createSession(agentId: string, cwd?: string): Promise<string> {
    const connection = this.deps.agentConnection.getConnection(agentId);
    if (!connection) {
      throw connectionFailed(
        agentId,
        new Error("createSession requires an active connection")
      );
    }

    const effectiveCwd = cwd ?? process.cwd();
    log.info("creating session", { agentId, cwd: effectiveCwd });

    const response = await connection.newSession({
      cwd: effectiveCwd,
      mcpServers: [],
    });

    const sessionId = response.sessionId;
    const now = new Date();

    const sessionInfo: AppSessionInfo = {
      sessionId,
      agentId,
      title: abbreviatePath(effectiveCwd),
      cwd: effectiveCwd,
      status: "idle",
      lastTurnOutcome: null,
      messages: [],
      isStreaming: false,
      createdAt: now,
      updatedAt: now,
      lastResponseAt: null,
      tokenUsage: { input: 0, output: 0, total: 0 },
      pendingCancel: false,
      _prevContextUsed: 0,
    };

    this.deps.sessionState.setSessionInfo(agentId, sessionId, sessionInfo);

    if (!this.deps.sessionState.getActiveSessionId(agentId)) {
      this.deps.sessionState.setActiveSession(agentId, sessionId);
    }

    this.persistSession(sessionId, agentId);

    log.info("session created", { agentId, sessionId, cwd: effectiveCwd });
    return sessionId;
  }

  async closeSession(agentId: string, sessionId: string): Promise<void> {
    const connection = this.deps.agentConnection.getConnection(agentId);

    log.info("closing session", { agentId, sessionId });

    this.deps.sessionState.removeSession(agentId, sessionId);

    if (this.deps.sessionState.getActiveSessionId(agentId) === sessionId) {
      this.deps.sessionState.clearActiveSession(agentId);
      const remaining = this.deps.sessionState.getSessionsForAgent(agentId);
      if (remaining.length > 0) {
        this.deps.sessionState.setActiveSession(
          agentId,
          remaining[0].sessionId
        );
      }
    }

    const sKey = sessionKey(agentId, sessionId);
    this.deps.sessionState.clearStreamText(sKey);
    this.deps.sessionState.clearStreamMsgRef(sKey);

    const qKey = sessionKey(agentId, sessionId);
    this.deps.sessionState.setQueue(qKey, []);

    log.info("session closed", { agentId, sessionId });

    if (connection) {
      try {
        await connection.closeSession({ sessionId });
      } catch {
        // Not all agents support session/close
      }
    }
  }

  renameSession(agentId: string, sessionId: string, title: string): void {
    const sessionInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      sessionId
    );
    if (!sessionInfo) {
      throw sessionNotFound(sessionId);
    }
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Session title cannot be empty");
    sessionInfo.title = trimmed;
    sessionInfo.updatedAt = new Date();
    this.persistSession(sessionId, agentId);
    this.syncHistoryStore(agentId, sessionId, sessionInfo);
    log.info("session renamed", { agentId, sessionId, title: trimmed });
  }

  async forkSession(
    agentId: string,
    sourceSessionId: string
  ): Promise<import("./types").RestoreResult> {
    const sourceInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      sourceSessionId
    );
    if (!sourceInfo) {
      throw sessionNotFound(sourceSessionId);
    }

    const allMessages = sourceInfo.messages.map((m) => ({
      ...m,
      id: m.id || crypto.randomUUID(),
    }));

    const newSessionId = await this.createSession(agentId, sourceInfo.cwd);

    const newInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      newSessionId
    );
    if (newInfo) {
      newInfo.messages = allMessages;
      newInfo.title = `${sourceInfo.title} (fork)`;
    }

    const replayable = allMessages.filter(
      (m) => m.role === "user" || m.role === "agent"
    );
    let replayed = 0;
    if (replayable.length > 0) {
      replayed = await this.replayMessages(agentId, newSessionId, replayable);
    }

    return {
      sessionId: newSessionId,
      nativeRestore: false,
      replayedMessageCount: replayed,
    };
  }

  async restoreSession(
    agentId: string,
    sourceSessionId: string,
    messages: ChatMessage[],
    cwd?: string
  ): Promise<import("./types").RestoreResult> {
    const agentInfo = this.deps.agentConnection.getAgentInfo(agentId);
    const sourceInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      sourceSessionId
    );
    const effectiveCwd = cwd ?? sourceInfo?.cwd ?? process.cwd();

    if (agentInfo?.capabilities?.loadSession) {
      const connection = this.deps.agentConnection.getConnection(agentId);
      if (!connection)
        throw connectionFailed(
          agentId,
          new Error("restoreSession requires an active connection")
        );

      await connection.loadSession({
        sessionId: sourceSessionId,
        cwd: effectiveCwd,
        mcpServers: [],
      });

      const now = new Date();
      const restoredMessages = messages.map((m) => ({
        ...m,
        id: m.id || crypto.randomUUID(),
      }));

      const sessionInfo: AppSessionInfo = {
        sessionId: sourceSessionId,
        agentId,
        title: sourceInfo?.title ?? `Restored ${sourceSessionId.slice(0, 8)}`,
        cwd: effectiveCwd,
        status: "idle",
        lastTurnOutcome: null,
        messages: restoredMessages,
        isStreaming: false,
        createdAt: now,
        updatedAt: now,
        lastResponseAt: null,
        tokenUsage: { input: 0, output: 0, total: 0 },
        pendingCancel: false,
      };

      this.deps.sessionState.setSessionInfo(
        agentId,
        sourceSessionId,
        sessionInfo
      );

      if (!this.deps.sessionState.getActiveSessionId(agentId)) {
        this.deps.sessionState.setActiveSession(agentId, sourceSessionId);
      }

      this.persistSession(sourceSessionId, agentId);

      return {
        sessionId: sourceSessionId,
        nativeRestore: true,
        replayedMessageCount: 0,
      };
    }

    const newSessionId = await this.createSession(agentId, effectiveCwd);
    const newInfo = this.deps.sessionState.getSessionInfo(
      agentId,
      newSessionId
    );
    if (newInfo) {
      newInfo.messages = messages.map((m) => ({
        ...m,
        id: m.id || crypto.randomUUID(),
      }));
    }

    const replayed = await this.replayMessages(agentId, newSessionId, messages);

    if (newInfo && sourceInfo) {
      newInfo.title = sourceInfo.title;
    }

    return {
      sessionId: newSessionId,
      nativeRestore: false,
      replayedMessageCount: replayed,
    };
  }

  private async replayMessages(
    agentId: string,
    sessionId: string,
    messages: ChatMessage[]
  ): Promise<number> {
    const replayable = messages.filter(
      (m) => m.role === "user" || m.role === "agent"
    );
    if (replayable.length === 0) return 0;

    const replayId = crypto.randomUUID();
    log.info("replay started", {
      agentId,
      sessionId,
      replayId,
      total: replayable.length,
    });
    this.deps.emit("sessionReplayStart", {
      agentId,
      sessionId,
      replayId,
      total: replayable.length,
    });

    let replayed = 0;
    for (const msg of replayable) {
      const blocks = this.chatMessageToContentBlocks(msg);
      try {
        await withTimeout(
          this.deps.promptExecution.send(agentId, sessionId, "", blocks),
          30_000,
          `replay message ${msg.id}`
        );
        replayed++;
        this.deps.emit("sessionReplayProgress", {
          agentId,
          sessionId,
          replayId,
          index: replayed,
          total: replayable.length,
        });
      } catch (e) {
        log.warn("replay message failed", {
          agentId,
          sessionId,
          messageId: msg.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.deps.emit("sessionReplayComplete", {
      agentId,
      sessionId,
      replayId,
      replayed,
    });
    log.info("replay completed", {
      agentId,
      sessionId,
      replayId,
      replayed,
      total: replayable.length,
    });
    return replayed;
  }

  /** Convert a stored ChatMessage into ACP ContentBlock[] — used by replay and tests */
  chatMessageToContentBlocks(msg: ChatMessage): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    if (msg.inlineFilePaths) {
      for (const fp of msg.inlineFilePaths) {
        blocks.push({ type: "resource_link", uri: fp, name: fp });
      }
    }

    if (msg.attachmentsJson) {
      try {
        const attachments = JSON.parse(msg.attachmentsJson) as Array<{
          type: string;
          path: string;
          content: string;
        }>;
        for (const att of attachments) {
          if (att.type === "file" || att.type === "selection") {
            blocks.push({
              type: "resource",
              resource: { uri: att.path, text: att.content },
            });
          }
        }
      } catch {
        // Ignore malformed attachment JSON
      }
    }

    if (msg.content) {
      blocks.push({ type: "text", text: msg.content });
    }

    return blocks;
  }

  private persistSession(sessionId: string, agentId: string): void {
    const info = this.deps.sessionState.getSessionInfo(agentId, sessionId);
    if (info) {
      this.deps.historyStore?.saveSession(info);
    }
  }

  private syncHistoryStore(
    agentId: string,
    sessionId: string,
    info: AppSessionInfo
  ): void {
    if (!this.deps.sessionHistoryStore) return;
    const entry: HistoryEntry = {
      sessionId,
      agentId,
      title: info.title,
      cwd: info.cwd,
      status: info.status,
      createdAt: info.createdAt.toISOString(),
      messageCount: info.messages.length,
      tokenUsage: {
        input: info.tokenUsage.input,
        output: info.tokenUsage.output,
        total: info.tokenUsage.total,
      },
    };
    void this.deps.sessionHistoryStore.upsertEntry(entry);
  }
}
