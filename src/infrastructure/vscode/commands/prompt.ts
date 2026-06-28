import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { attachmentsToContentBlocks } from "../../../adapter/context/prompt-context";
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
import type { SendTarget } from "../../../domain/models/mesh";
import type { MeshOrchestrator } from "../../../domain/services/mesh-orchestrator";
import type { SupervisorOrchestrator } from "../../../domain/services/supervisor-orchestrator";
import { getLogger } from "../../../platform/backends";

const execAsync = promisify(exec);

let _chatPanel: ChatPanel | null = null;
let _orchestrator: SessionOrchestrator | null = null;
let _meshOrchestrator: MeshOrchestrator | null = null;
let _supervisorOrchestrator: SupervisorOrchestrator | null = null;

// handlePlanMessage is imported from plan-message-handler.ts (pure, testable)

/**
 * Single code path for sending user messages to agent sessions (DRY).
 */
function meshSend(
  text: string,
  attachments: ContextAttachmentDTO[],
  targets: SendTarget[]
): void {
  const chatPanel = _chatPanel;
  const orchestrator = _orchestrator;
  const meshOrchestrator = _meshOrchestrator;
  if (!chatPanel || !orchestrator) return;

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: text,
    timestamp: Date.now(),
    attachmentsJson:
      attachments.length > 0 ? JSON.stringify(attachments) : undefined,
  };
  const context = attachmentsToContentBlocks(attachments);

  if (meshOrchestrator) {
    void meshOrchestrator.meshSend(targets, text, attachments);
  } else {
    for (const target of targets) {
      void orchestrator.prompt(target.agentId, target.sessionId, text, context);
    }
  }
}

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
  persistentHistory?: PersistentHistoryStore,
  meshOrchestrator?: MeshOrchestrator,
  supervisorOrchestrator?: SupervisorOrchestrator
): void {
  _chatPanel = chatPanel;
  _orchestrator = orchestrator;
  _meshOrchestrator = meshOrchestrator ?? null;
  _supervisorOrchestrator = supervisorOrchestrator ?? null;

  if (!chatPanel) return;

  chatPanel.onSendMessage(({ agentId, sessionId, text, attachments }) => {
    const targets: SendTarget[] = [
      { agentId, sessionId, label: agentId, status: "idle" },
    ];
    meshSend(text, attachments, targets);
  });

  chatPanel.onCancelTurn(({ agentId, sessionId }) => {
    void orchestrator.cancel(agentId, sessionId);
  });

  chatPanel.onOpenFile(({ path: openPath, line }) => {
    void (async () => {
      let absPath: string;
      if (path.isAbsolute(openPath)) {
        absPath = openPath;
      } else {
        const activeAgent = orchestrator.getAllAgents()[0];
        const activeSessionId = activeAgent
          ? (orchestrator.getActiveSessionId(activeAgent.agentId) ??
            activeAgent.sessions[0]?.sessionId)
          : undefined;
        let cwd: string | undefined;
        if (activeAgent && activeSessionId) {
          const info = orchestrator.getSessionInfo(
            activeAgent.agentId,
            activeSessionId
          );
          cwd = info?.cwd;
        }
        const base =
          cwd ??
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
          process.cwd();
        absPath = path.resolve(base, openPath);
      }
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
        const info = orchestrator.getSessionInfo(agentId, sessionId);
        if (!info) break;
        orchestrator.setActiveSession(agentId, sessionId);
        chatPanel?.setActiveSession(agentId, sessionId, info);
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
          chatPanel?.postMessage({
            type: "fileCandidates",
            query,
            reqId,
            candidates,
          });
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
          if (orchestrator.getSessionInfo(agent.agentId, sessionId)) {
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
        break;
      }
      case "sessionOverview:focus": {
        const { sessionId, agentId } = data as {
          sessionId: string;
          agentId: string;
        };
        if (orchestrator.getSessionInfo(agentId, sessionId)) {
          orchestrator.setActiveSession(agentId, sessionId);
        }
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
        break;

      // ==================================================================
      // Mesh send — single or multi-target (mesh:send)
      // ==================================================================
      case "mesh:send": {
        const { text, attachments, targets, mode, teamId } = data as {
          text: string;
          attachments: ContextAttachmentDTO[];
          targets: SendTarget[];
          mode?: string;
          teamId?: string;
        };
        if (mode === "supervisor" && teamId && _supervisorOrchestrator && _orchestrator) {
          const team = meshOrchestrator?.getTeam(teamId);
          if (team) {
            const leadTarget: SendTarget = {
              agentId: team.lead.agentId,
              sessionId: team.lead.sessionId,
              label: "Lead",
              status: "idle",
            };
            const workerTargets: SendTarget[] = team.members
              .filter(
                (m) =>
                  !(m.agentId === team.lead.agentId &&
                    m.sessionId === team.lead.sessionId)
              )
              .map((m) => ({
                agentId: m.agentId,
                sessionId: m.sessionId,
                label: m.agentId,
                status: "idle" as const,
              }));
            void _supervisorOrchestrator.executePlanFromUserRequest(
              teamId,
              leadTarget,
              workerTargets,
              text
            );
          }
        } else {
          meshSend(text, attachments, targets);
        }
        break;
      }

      // ==================================================================
      // Mesh Orchestrator messages
      // ==================================================================
      case "mesh:getStatus": {
        if (meshOrchestrator) {
          const statuses = meshOrchestrator.getAgentStatuses();
          const teams = meshOrchestrator.getAllTeams();
          chatPanel?.postMessage({
            type: "mesh:status",
            agents: statuses,
            teams: teams.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              lead: t.lead,
              members: t.members,
              status: t.status,
              createdAt: t.createdAt.toISOString(),
            })),
          });
        }
        break;
      }
      case "mesh:getTaskBoard": {
        if (meshOrchestrator) {
          const teamId = data.teamId as string | undefined;
          if (teamId) {
            const board = meshOrchestrator.getTaskBoard(teamId);
            chatPanel?.postMessage({
              type: "mesh:taskBoard",
              tasks: board?.tasks ?? [],
            });
          }
        }
        break;
      }
      case "mesh:togglePanel": {
        break;
      }
      case "mesh:plan": {
        if (_supervisorOrchestrator && _orchestrator) {
          const teamId = (data.teamId as string) ?? "";
          let plannerAgentId: string | undefined;
          let plannerSessionId: string | undefined;

          if (teamId && meshOrchestrator) {
            const team = meshOrchestrator.getTeam(teamId);
            if (team) {
              plannerAgentId = team.lead.agentId;
              plannerSessionId = team.lead.sessionId;
            }
          }

          if (!plannerAgentId || !plannerSessionId) {
            const activeAgent = _orchestrator.getAllAgents()[0];
            if (activeAgent) {
              plannerAgentId = activeAgent.agentId;
              plannerSessionId =
                _orchestrator.getActiveSessionId(plannerAgentId) ??
                activeAgent.sessions[0]?.sessionId;
            }
          }

          if (plannerAgentId && plannerSessionId) {
            void _supervisorOrchestrator.createPlan(
              plannerAgentId,
              plannerSessionId,
              (data.text as string) ?? "",
              teamId
            );
          }
        }
        break;
      }
      case "mesh:addMemberToTeam": {
        const { teamId, agentId, sessionId } = data as {
          teamId: string;
          agentId: string;
          sessionId: string;
        };
        if (meshOrchestrator) {
          try {
            const team = meshOrchestrator.addMemberToTeam(teamId, {
              agentId,
              sessionId,
            });
            chatPanel?.postMessage({
              type: "mesh:teamUpdated",
              team: {
                id: team.id,
                name: team.name,
                description: team.description,
                lead: team.lead,
                members: team.members,
                status: team.status,
                createdAt: team.createdAt.toISOString(),
              },
            });
          } catch (e) {
            getLogger("prompt").error(
              "addMemberToTeam failed",
              {
                teamId,
                agentId,
                sessionId,
              },
              e as Error
            );
          }
        }
        break;
      }
      case "mesh:removeMemberFromTeam": {
        const { teamId, agentId, sessionId } = data as {
          teamId: string;
          agentId: string;
          sessionId: string;
        };
        if (meshOrchestrator) {
          void meshOrchestrator
            .removeMemberFromTeam(teamId, { agentId, sessionId })
            .then((team) => {
              chatPanel?.postMessage({
                type: "mesh:teamUpdated",
                team: {
                  id: team.id,
                  name: team.name,
                  description: team.description,
                  lead: team.lead,
                  members: team.members,
                  status: team.status,
                  createdAt: team.createdAt.toISOString(),
                },
              });
            })
            .catch((e: Error) => {
              getLogger("prompt").error(
                "removeMemberFromTeam failed",
                {
                  teamId,
                  agentId,
                  sessionId,
                },
                e
              );
            });
        }
        break;
      }
      case "mesh:startTeam": {
        const { teamId, name, description, lead, members } = data as {
          teamId: string;
          name: string;
          description: string;
          lead: { agentId: string; sessionId: string };
          members: Array<{ agentId: string; sessionId: string }>;
        };
        if (meshOrchestrator) {
          void meshOrchestrator
            .startTeam({
              id: teamId,
              name,
              description,
              lead,
              members,
            })
            .then((team) => {
              chatPanel?.postMessage({
                type: "mesh:teamCreated",
                team: {
                  id: team.id,
                  name: team.name,
                  description: team.description,
                  lead: team.lead,
                  members: team.members,
                  status: team.status,
                  createdAt: team.createdAt.toISOString(),
                },
              });
            });
        }
        break;
      }

      // ==================================================================
      // Session Rename messages
      // ==================================================================
      case "renameSession": {
        const { agentId, sessionId, title } = data as {
          agentId: string;
          sessionId: string;
          title: string;
        };
        orchestrator.renameSession(agentId, sessionId, title);
        break;
      }

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
      case "queue:clear": {
        const { agentId, sessionId } = data as {
          agentId: string;
          sessionId: string;
        };
        // Cancel all pending entries in the orchestrator queue
        const queued = orchestrator.getQueuedPrompts(agentId, sessionId);
        for (const entry of queued) {
          if (entry.status === "pending") {
            orchestrator.cancelQueuedPrompt(agentId, sessionId, entry.id);
          }
        }
        break;
      }
      case "queue:reorder": {
        const { agentId, sessionId, orderedIds } = data as {
          agentId: string;
          sessionId: string;
          orderedIds: string[];
        };
        orchestrator.reorderQueuedPrompts(agentId, sessionId, orderedIds);
        break;
      }

      // ==================================================================
      // Supervisor / Plan messages
      // ==================================================================
      case "plan.approve": {
        void _supervisorOrchestrator?.approvePlan(data.planId as string);
        break;
      }
      case "plan.reject": {
        _supervisorOrchestrator?.rejectPlan(data.planId as string);
        break;
      }
      case "plan.modifyStep": {
        _supervisorOrchestrator?.modifyStep(
          data.planId as string,
          data.stepId as string,
          data.newDescription as string
        );
        break;
      }
      case "plan.addStep": {
        _supervisorOrchestrator?.addStep(
          data.planId as string,
          data.description as string,
          data.afterStepId as string | undefined
        );
        break;
      }
      case "plan.removeStep": {
        _supervisorOrchestrator?.removeStep(
          data.planId as string,
          data.stepId as string
        );
        break;
      }
      case "plan.cancel": {
        void _supervisorOrchestrator?.cancelPlan(data.planId as string);
        break;
      }
      case "plan.replan": {
        void _supervisorOrchestrator?.replan(
          data.planId as string,
          data.failedStepId as string,
          data.reason as string
        );
        break;
      }

      // ==================================================================
      // File Edit messages
      // ==================================================================
      case "openDiff": {
        const { path: diffPath, originalContent, expectedHash } = data as {
          path: string;
          originalContent?: string;
          expectedHash?: string;
        };
        void (async () => {
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            ?? process.cwd();
          const absPath = path.isAbsolute(diffPath)
            ? diffPath
            : path.resolve(ws, diffPath);
          const currentUri = vscode.Uri.file(absPath);

          if (expectedHash) {
            try {
              const currentContent = await vscode.workspace.fs.readFile(currentUri);
              const currentHash = require("node:crypto")
                .createHash("sha256")
                .update(new TextDecoder().decode(currentContent), "utf8")
                .digest("hex");
              if (currentHash !== expectedHash) {
                const action = await vscode.window.showWarningMessage(
                  `File ${path.basename(absPath)} has been modified since the agent wrote it. The diff may not reflect the current state.`,
                  "Open Anyway",
                  "Cancel"
                );
                if (action !== "Open Anyway") return;
              }
            } catch {
              // File may not exist — proceed with diff
            }
          }

          if (typeof originalContent === "string") {
            // Write original content to a temp directory, but keep the original
            // filename so that VS Code's language detection (syntax highlighting)
            // works correctly in the diff editor.
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-diff-"));
            const originalFileName = path.basename(absPath);
            const tmpFilePath = path.join(tmpDir, originalFileName);
            fs.writeFileSync(tmpFilePath, originalContent, "utf8");
            const originalUri = vscode.Uri.file(tmpFilePath);

            // Open diff editor in a separate tab (ViewColumn.Two) so it
            // does not steal focus from the chat panel.
            await vscode.commands.executeCommand(
              "vscode.diff",
              originalUri,
              currentUri,
              `${path.basename(absPath)} (Original ↔ Current)`,
              { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
            );

            // Clean up temp file after a delay (diff editor has loaded by then).
            // If the user saves changes in the diff, VS Code writes to the
            // current file (right side), so the temp file is no longer needed.
            setTimeout(() => {
              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
            }, 60_000);
          } else {
            const doc = await vscode.workspace.openTextDocument(currentUri);
            await vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
            });
          }
        })();
        break;
      }
      // ── Revert file to original content ──
      case "revertFile": {
        const { path: revertPath, originalContent } = data as {
          path: string;
          originalContent: string;
        };
        void (async () => {
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            ?? process.cwd();
          const absPath = path.isAbsolute(revertPath)
            ? revertPath
            : path.resolve(ws, revertPath);
          const uri = vscode.Uri.file(absPath);
          try {
            // Check if file exists
            const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
            if (!exists) {
              void vscode.window.showWarningMessage(
                `File not found: ${path.basename(absPath)}`
              );
              return;
            }

            // Write original content back
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(originalContent));

            // Open the reverted file so the user can see the result
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
            });

            void vscode.window.showInformationMessage(
              `Reverted ${path.basename(absPath)} to original content`
            );
          } catch (err) {
            getLogger("prompt").error("revertFile failed", { absPath }, err as Error);
            void vscode.window.showErrorMessage(
              `Failed to revert ${path.basename(absPath)}: ${(err as Error).message}`
            );
          }
        })();
        break;
      }
      // ── Check file hash (for stale detection in FileEditSummary) ──
      case "checkFileHash": {
        const { path: checkPath, expectedHash, msgId } = data as {
          path: string;
          expectedHash: string;
          msgId: string;
        };
        void (async () => {
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          const absPath = path.isAbsolute(checkPath) ? checkPath : path.resolve(wsRoot, checkPath);
          let isStale = false;
          try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
            const currentHash = require("node:crypto")
              .createHash("sha256")
              .update(new TextDecoder().decode(content), "utf8")
              .digest("hex");
            isStale = currentHash !== expectedHash;
          } catch {
            // File doesn't exist → treat as stale
            isStale = true;
          }
          chatPanel?.postMessage({
            type: "hashCheckResult",
            msgId,
            isStale,
          });
        })();
        break;
      }
      // ─ Batch check file hashes (single IPC round-trip for multiple files) ──
      case "checkFileHashBatch": {
        const { batchId, checks } = data as {
          batchId: string;
          checks: Array<{ path: string; expectedHash: string }>;
        };
        void (async () => {
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          for (const check of checks) {
            const absPath = path.isAbsolute(check.path) ? check.path : path.resolve(wsRoot, check.path);
            let isStale = false;
            try {
              const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
              const currentHash = require("node:crypto")
                .createHash("sha256")
                .update(new TextDecoder().decode(content), "utf8")
                .digest("hex");
              isStale = currentHash !== check.expectedHash;
            } catch {
              isStale = true;
            }
            chatPanel?.postMessage({
              type: "hashCheckResult",
              batchId,
              path: check.path,
              isStale,
            });
          }
        })();
        break;
      }
    }
  });
}

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
