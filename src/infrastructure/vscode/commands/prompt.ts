import * as vscode from "vscode";
import * as path from "path";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { SessionOrchestrator } from "../../../application/orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";
import type {
  ChatMessage,
  ContextAttachmentDTO,
} from "../../../domain/models/chat";
import type { SuggestionItem } from "../../../adapter/context/symbol";
import type {
  PersistentHistoryStore,
  PersistentSessionEntry,
} from "../../../application/session/persistentHistory";
import {
  searchSymbols,
  resolveSymbolByName,
} from "../../../adapter/context/symbol";

/**
 * Wire chat panel events to the orchestrator.
 * This replaces the wireChatPanelEvents() function in extension.ts.
 */
export function wireChatPanelEvents(
  chatPanel: ChatPanel | null,
  orchestrator: SessionOrchestrator,
  sendTabs: () => void,
  resolveFile: (path: string, cwd?: string) => Promise<ContextAttachmentDTO>,
  resolveSelection: () => Promise<ContextAttachmentDTO | null>,
  resolveDiff: () => Promise<ContextAttachmentDTO | null>,
  searchFiles: (
    query: string,
    cwd?: string
  ) => Promise<{ relativePath: string; name: string; absolutePath?: string }[]>,
  searchSymbols: (query: string) => Promise<SuggestionItem[]>,
  resolveSymbolByName: (name: string) => Promise<ContextAttachmentDTO>,
  persistentHistory?: PersistentHistoryStore
): void {
  if (!chatPanel) return;

  chatPanel.onSendMessage(({ agentId, sessionId, text, attachments }) => {
    // Store user message in orchestrator state so tab switches / forks preserve it
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      attachmentsJson:
        attachments.length > 0 ? JSON.stringify(attachments) : undefined,
    };
    orchestrator.appendMessageSilent(agentId, sessionId, userMessage);

    const context = buildPromptContext(attachments);
    orchestrator.prompt(agentId, sessionId, text, context).then(
      (queuedEntry) => {
        if (queuedEntry) {
          // Prompt was queued (turn was active) — no need to set isTurnActive
          // The orchestrator will auto-dequeue when the turn completes
        } else {
          // Prompt was sent immediately — turn is now complete
          orchestrator.setIsTurnActive(agentId, sessionId, false);
        }
      },
      () => orchestrator.setIsTurnActive(agentId, sessionId, false)
    );
    // Only set isTurnActive immediately if the prompt was NOT queued
    // (queued prompts don't start a new turn yet)
    const sessionInfo = orchestrator.getSessionInfo(agentId, sessionId);
    if (sessionInfo && !sessionInfo.isTurnActive) {
      orchestrator.setIsTurnActive(agentId, sessionId, true);
    }
  });

  chatPanel.onCancelTurn(({ agentId, sessionId }) => {
    orchestrator.setIsTurnActive(agentId, sessionId, false);
    void orchestrator.cancel(agentId, sessionId);
  });

  chatPanel.onOpenFile(({ path: openPath, line }) => {
    void (async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const absPath = path.isAbsolute(openPath)
        ? openPath
        : path.join(ws, openPath);
      const uri = vscode.Uri.file(absPath);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const selection = line
          ? new vscode.Range(line - 1, 0, line - 1, 0)
          : undefined;
        await vscode.window.showTextDocument(doc, {
          selection,
          viewColumn: vscode.ViewColumn.Beside,
        });
      } catch {
        void vscode.window.showWarningMessage(`File not found: ${openPath}`);
      }
    })();
  });

  chatPanel.onAttachFile(({ path: filePath }) => {
    void resolveFile(filePath).then((attachment) => {
      addContextToChat(attachment, orchestrator, () => chatPanel);
    });
  });

  chatPanel.onDidReceiveMessage((data: Record<string, unknown>) => {
    switch (data.type as string) {
      case "switchSession": {
        const agentId = data.agentId as string;
        const sessionId = data.sessionId as string;
        orchestrator.setActiveSession(agentId, sessionId);
        const info = orchestrator.getSessionInfo(agentId, sessionId);
        if (info) {
          chatPanel?.setActiveSession(agentId, sessionId, info);
        }
        break;
      }
      case "newSession": {
        const agentId = data.agentId as string;
        void (async () => {
          const ws = process.cwd(); // simplified
          await orchestrator.createSession(agentId, ws);
        })();
        break;
      }
      case "closeSession": {
        const sessionId = data.sessionId as string;
        for (const agent of orchestrator.getAllAgents()) {
          if (agent.sessions.some((s) => s.sessionId === sessionId)) {
            void orchestrator
              .closeSession(agent.agentId, sessionId)
              .then(() => {
                sendTabs();
              });
            break;
          }
        }
        break;
      }
      case "forkSession": {
        const sessionId = data.sessionId as string;
        for (const agent of orchestrator.getAllAgents()) {
          if (!orchestrator.getSessionInfo(agent.agentId, sessionId)) continue;
          void (async () => {
            const result = await orchestrator.forkSession(
              agent.agentId,
              sessionId
            );
            orchestrator.setActiveSession(agent.agentId, result.sessionId);
            const newInfo = orchestrator.getSessionInfo(
              agent.agentId,
              result.sessionId
            );
            if (newInfo) {
              chatPanel?.setActiveSession(
                agent.agentId,
                result.sessionId,
                newInfo
              );
            }
          })();
          break;
        }
        break;
      }
      case "sessionReady":
        sendTabs();
        break;
      case "fetchFiles": {
        const query = data.query as string;
        const reqId = data.reqId as string;
        const cwd = resolveSessionCwd(orchestrator, data);
        void searchFiles(query, cwd).then((candidates) => {
          chatPanel?.postMessage({ type: "fileCandidates", query, reqId, candidates });
        });
        break;
      }
      case "resolveFile": {
        const filePath = data.path as string;
        const reqId = data.reqId as string;
        const cwd = resolveSessionCwd(orchestrator, data);
        void resolveFile(filePath, cwd)
          .then((a) =>
            chatPanel?.postMessage({
              type: "resolvedFile",
              reqId,
              path: filePath,
              attachment: a,
            })
          )
          .catch((err: Error) =>
            chatPanel?.postMessage({
              type: "resolvedFile",
              reqId,
              path: filePath,
              attachment: null,
              error: err.message,
            })
          );
        break;
      }
      case "resolveSelection":
        void resolveSelection().then((a) =>
          chatPanel?.postMessage({ type: "resolvedSelection", attachment: a })
        );
        break;
      case "resolveDiff":
        void resolveDiff().then((a) =>
          chatPanel?.postMessage({ type: "resolvedDiff", attachment: a })
        );
        break;
      case "fetchSymbols": {
        const query = data.query as string;
        void searchSymbols(query).then((candidates) => {
          chatPanel?.postMessage({
            type: "symbolCandidates",
            query,
            candidates,
          });
        });
        break;
      }
      case "resolveSymbol": {
        const name = data.name as string;
        void resolveSymbolByName(name)
          .then((a) =>
            chatPanel?.postMessage({
              type: "resolvedSymbol",
              name,
              attachment: a,
            })
          )
          .catch((err: Error) =>
            chatPanel?.postMessage({
              type: "resolvedSymbol",
              name,
              attachment: null,
              error: err.message,
            })
          );
        break;
      }
      case "selectAgent":
        break;
      case "selectSession": {
        const sessionId = data.sessionId as string;
        for (const agent of orchestrator.getAllAgents()) {
          if (agent.sessions.some((s) => s.sessionId === sessionId)) {
            orchestrator.setActiveSession(agent.agentId, sessionId);
            break;
          }
        }
        break;
      }

      // ==================================================================
      // Persistent history messages
      // ==================================================================
      case "history:getAll": {
        if (persistentHistory) {
          const sessions = persistentHistory.getAllSessions();
          chatPanel?.postMessage({ type: "history:allSessions", sessions });
        }
        break;
      }
      case "history:search": {
        if (persistentHistory) {
          const results = persistentHistory.searchSessions(
            data.query as string
          );
          chatPanel?.postMessage({ type: "history:searchResults", results });
        }
        break;
      }
      case "history:getSession": {
        if (persistentHistory) {
          const sessionId = data.sessionId as string;
          const session = persistentHistory.getSession(sessionId);
          const messages = persistentHistory.getSessionMessages(sessionId);
          chatPanel?.postMessage({
            type: "history:sessionDetail",
            session,
            messages: messages.messages,
          });
        }
        break;
      }
      case "history:delete": {
        if (persistentHistory) {
          const sessionId = data.sessionId as string;
          void persistentHistory.deleteSession(sessionId).then(() => {
            chatPanel?.postMessage({ type: "history:deleted", sessionId });
            const sessions = persistentHistory.getAllSessions();
            chatPanel?.postMessage({ type: "history:allSessions", sessions });
          });
        }
        break;
      }
      case "history:cleanup": {
        if (persistentHistory) {
          const maxAgeDays = data.maxAgeDays as number;
          void persistentHistory
            .cleanupExpiredSessions(maxAgeDays)
            .then((deletedCount) => {
              chatPanel?.postMessage({
                type: "history:cleanupComplete",
                deletedCount,
              });
            });
        }
        break;
      }
      case "history:getStats": {
        if (persistentHistory) {
          const stats = persistentHistory.getStats();
          chatPanel?.postMessage({ type: "history:stats", ...stats });
        }
        break;
      }
      case "history:restore": {
        // Delegate to the acp.restoreSession command which handles
        // loading messages from persistent store and calling orchestrator.restoreSession().
        void vscode.commands.executeCommand("acp.restoreSession");
        break;
      }
      case "history:archive": {
        if (persistentHistory) {
          const sessionId = data.sessionId as string;
          void persistentHistory.archiveSession(sessionId).then(() => {
            chatPanel?.postMessage({ type: "history:archived", sessionId });
            const sessions = persistentHistory!.getAllSessions();
            chatPanel?.postMessage({ type: "history:allSessions", sessions });
          });
        }
        break;
      }
      case "history:unarchive": {
        if (persistentHistory) {
          const sessionId = data.sessionId as string;
          void persistentHistory.unarchiveSession(sessionId).then(() => {
            chatPanel?.postMessage({ type: "history:unarchived", sessionId });
            const sessions = persistentHistory!.getAllSessions();
            chatPanel?.postMessage({ type: "history:allSessions", sessions });
          });
        }
        break;
      }
      case "history:exportMd": {
        if (persistentHistory) {
          const markdown = data.markdown as string;
          chatPanel?.postMessage({ type: "history:exportMd", markdown });
        }
        break;
      }

      // ==================================================================
      // Session Overview messages
      // ==================================================================
      case "sessionOverview:toggle": {
        // Webview toggles its own visibility state;
        // extension host just forwards the current state from the webview.
        // No-op here — visibility is managed in webview state.
        break;
      }
      case "sessionOverview:focus": {
        const { sessionId, agentId } = data as {
          sessionId: string;
          agentId: string;
        };
        orchestrator.setActiveSession(agentId, sessionId);
        break;
      }
      case "sessionOverview:cancel": {
        const { sessionId, agentId } = data as {
          sessionId: string;
          agentId: string;
        };
        void orchestrator.cancelSession(sessionId, agentId);
        break;
      }
      case "sessionOverview:expand":
      case "sessionOverview:collapse":
        // Webview manages expanded state internally; no extension host action needed.
        break;

      // ==================================================================
      // Prompt Queue messages
      // ==================================================================
      case "queue:cancel": {
        const { agentId, sessionId, promptId } = data as {
          agentId: string;
          sessionId: string;
          promptId: string;
        };
        orchestrator.cancelQueuedPrompt(agentId, sessionId, promptId);
        break;
      }
    }
  });
}

/**
 * Resolve the session cwd from message data.
 * Falls back to the cwd of the active session for the given agent.
 */
function resolveSessionCwd(
  orchestrator: SessionOrchestrator,
  data: Record<string, unknown>
): string | undefined {
  // Explicit cwd sent by webview takes priority
  if (typeof data.cwd === "string" && data.cwd) return data.cwd;
  // Otherwise look up the session's cwd
  const agentId = data.agentId as string | undefined;
  const sessionId = data.sessionId as string | undefined;
  if (agentId && sessionId) {
    const info = orchestrator.getSessionInfo(agentId, sessionId);
    if (info?.cwd) return info.cwd;
  }
  // Fallback: active session for the agent
  if (agentId) {
    const activeId = orchestrator.getActiveSessionId(agentId);
    if (activeId) {
      const info = orchestrator.getSessionInfo(agentId, activeId);
      if (info?.cwd) return info.cwd;
    }
  }
  return undefined;
}

function buildPromptContext(attachments: ContextAttachmentDTO[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const a of attachments) {
    switch (a.type) {
      case "file":
      case "symbol":
        blocks.push({
          type: "resource",
          resource: {
            uri: `file://${a.path}`,
            mimeType: "text/plain",
            text: a.content,
          },
        });
        break;
      case "selection":
        blocks.push({
          type: "resource",
          resource: {
            uri: `file://${a.path}`,
            mimeType: "text/plain",
            text: a.content,
          },
        });
        break;
      case "diff":
        blocks.push({
          type: "resource",
          resource: {
            uri: `file://${a.path}`,
            mimeType: "text/plain",
            text: a.content,
          },
        });
        break;
    }
  }
  return blocks;
}

function addContextToChat(
  attachment: ContextAttachmentDTO,
  orchestrator: SessionOrchestrator,
  getChatPanel: () => ChatPanel | null
): void {
  const agents = orchestrator.getAllAgents();
  if (agents.length === 0) return;
  const agent = agents[0];
  const activeSessionId =
    orchestrator.getActiveSessionId(agent.agentId) ??
    agent.sessions[0]?.sessionId;
  if (!activeSessionId) return;
  const info = orchestrator.getSessionInfo(agent.agentId, activeSessionId);
  getChatPanel()?.pushMessage(
    agent.agentId,
    activeSessionId,
    {
      id: crypto.randomUUID(),
      role: "system",
      content: `📎 ${attachment.label} (${attachment.tokenCount} tokens)`,
      timestamp: Date.now(),
    },
    info?.cwd
  );
}
