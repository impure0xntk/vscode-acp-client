import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { TokenUsage } from "../session/types";
import type { ChatMessage, ToolCall, ContextAttachmentDTO } from "../types/chat";

// ============================================================================
// Snapshot sent to webview on session switch
// ============================================================================

export interface SessionSnapshot {
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  isTurnActive: boolean;
  tokenUsage: TokenUsage; // { input, output, total }
}

function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Inline file-path extraction & existence check
// ---------------------------------------------------------------------------

/**
 * Heuristic regex: matches strings that look like file paths.
 * Same logic as the webview-side `looksLikeFilePath` in markdown.ts.
 */
const LOOKS_LIKE_PATH_RE =
  /^(\.{0,2}\/|~\/|\/|[A-Za-z]:\\)[\w./~$-]+(?:\.[a-zA-Z0-9]+)?$|^[\w./-]+\/[\w./-]+$/;

/**
 * Extract candidate file-path-like tokens from a text string.
 * Splits on whitespace and common delimiters, then filters by heuristic.
 */
function extractCandidatePaths(text: string): string[] {
  const tokens = text.split(/[\s,;:|"'()[\]{}<>]+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const trimmed = t.trim();
    if (trimmed.length > 260) continue;
    if (/^https?:\/\//.test(trimmed)) continue;
    if (!LOOKS_LIKE_PATH_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Resolve a candidate path: if relative, resolve against cwd.
 * Returns the resolved absolute path.
 */
function resolveCandidate(candidate: string, cwd: string): string {
  if (candidate.startsWith("/") || candidate.startsWith("~") || /^[A-Za-z]:\\/.test(candidate)) {
    return candidate.startsWith("~") ? candidate.replace("~", process.env.HOME ?? "~") : candidate;
  }
  return path.resolve(cwd, candidate);
}

/**
 * Given message text and a cwd, return the list of file paths that
 * (a) look like file paths and (b) actually exist on disk.
 */
function findExistingInlinePaths(content: string, cwd: string): string[] {
  const candidates = extractCandidatePaths(content);
  const existing: string[] = [];
  for (const c of candidates) {
    try {
      const resolved = resolveCandidate(c, cwd);
      if (fs.existsSync(resolved)) {
        existing.push(c);
      }
    } catch {
      // ignore resolution errors
    }
  }
  return existing;
}

/**
 * Attach `inlineFilePaths` to a message by scanning its content for
 * file-path-like tokens and checking existence against the session cwd.
 */
function attachInlineFilePaths(
  message: ChatMessage,
  cwd: string,
): ChatMessage {
  const existing = findExistingInlinePaths(message.content, cwd);
  if (existing.length === 0) return message;
  return { ...message, inlineFilePaths: existing };
}

/**
 * Stateless chat panel — a messenger that forwards snapshots from
 * SessionOrchestrator events. No internal domain state is stored here.
 *
 * Uses a WebviewPanel in the bottom area (terminal-like) instead of a
 * sidebar WebviewView. The panel is a singleton — only one instance exists
 * per extension activation.
 */
export class ChatPanel {
  public static readonly viewId = "acp.chatPanel";
  private static instance: ChatPanel | null = null;

  private panel: vscode.WebviewPanel | null = null;

  // Event emitters — exposed as readonly for the extension to subscribe
  private _onSendMessage = new vscode.EventEmitter<{
    agentId: string;
    sessionId: string;
    text: string;
    attachments: ContextAttachmentDTO[];
  }>();
  private _onCancelTurn = new vscode.EventEmitter<{ agentId: string; sessionId: string }>();
  private _onAttachFile = new vscode.EventEmitter<{ path: string; lineRange?: [number, number] }>();
  private _onDidReceiveMessage = new vscode.EventEmitter<Record<string, unknown>>();
  private _onOpenFile = new vscode.EventEmitter<{ path: string; line?: number }>();

  readonly onSendMessage = this._onSendMessage.event;
  readonly onCancelTurn = this._onCancelTurn.event;
  readonly onAttachFile = this._onAttachFile.event;
  readonly onDidReceiveMessage = this._onDidReceiveMessage.event;
  readonly onOpenFile = this._onOpenFile.event;

  /** Callback to get available commands for a session (set by extension.ts) */
  _onGetSessionCommands: ((agentId: string, sessionId: string) => unknown[]) | null = null;

  /** Get or create the singleton panel */
  static reveal(extensionUri: vscode.Uri): ChatPanel {
    if (ChatPanel.instance?.panel) {
      ChatPanel.instance.panel.reveal(vscode.ViewColumn.Beside, true);
      return ChatPanel.instance;
    }
    ChatPanel.instance = new ChatPanel(extensionUri);
    return ChatPanel.instance;
  }

  static get current(): ChatPanel | null {
    return ChatPanel.instance;
  }

  private constructor(private readonly extensionUri: vscode.Uri) {
    this.createPanel();
  }

  // ========================================================================
  // Panel Lifecycle
  // ========================================================================

  private createPanel(): void {
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist");
    this.panel = vscode.window.createWebviewPanel(
      ChatPanel.viewId,
      "ACP Chat",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri, distUri],
      }
    );

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((data) => {
      this._onDidReceiveMessage.fire(data);
      this.handleMessage(data);
    });

    this.panel.onDidDispose(() => {
      this._onSendMessage.dispose();
      this._onCancelTurn.dispose();
      this._onAttachFile.dispose();
      this._onDidReceiveMessage.dispose();
      ChatPanel.instance = null;
      this.panel = null;
    });
  }

  /** Reveal and focus the panel */
  reveal(): void {
    this.panel?.reveal(vscode.ViewColumn.Beside, true);
  }

  // ========================================================================
  // Stateless push methods — forward snapshots to webview
  // ========================================================================

  /** Push a session switch with full state */
  setActiveSession(agentId: string, sessionId: string, info: import("../session/types").SessionInfo): void {
    const cwd = info.cwd;
    const enriched = info.messages.map((m) => attachInlineFilePaths(m, cwd));
    this.postMessage({
      type: "session/switch",
      agentId,
      sessionId,
      messages: enriched,
      isTurnActive: info.isTurnActive,
      tokenUsage: {
        inputTokens: info.tokenUsage.input,
        outputTokens: info.tokenUsage.output,
        totalTokens: info.tokenUsage.total,
      },
      contextWindowMax: info.contextWindowMax,
    });
    // Also push available commands for this session
    const commands = this._onGetSessionCommands?.(agentId, sessionId) ?? [];
    if (commands.length > 0) {
      this.pushAvailableCommands(agentId, sessionId, commands);
    }
  }

  /** Push a new message to the webview for a session */
  pushMessage(agentId: string, sessionId: string, message: ChatMessage, cwd?: string): void {
    const enriched = cwd ? attachInlineFilePaths(message, cwd) : message;
    this.postMessage({ type: "session/message", agentId, sessionId, message: enriched });
  }

  /** Push a streaming chunk */
  pushStreamChunk(agentId: string, sessionId: string, chunk: string): void {
    this.postMessage({ type: "session/stream", agentId, sessionId, chunk });
  }

  /** Signal end of streaming */
  pushStreamEnd(agentId: string, sessionId: string): void {
    this.postMessage({ type: "session/streamEnd", agentId, sessionId });
  }

  /** Forward a raw SDK SessionNotification to the webview */
  pushSessionNotification(agentId: string, sessionId: string, notification: unknown): void {
    this.postMessage({ type: "session/notification", agentId, sessionId, notification });
  }

  /** Update turn active state */
  pushTurnActive(agentId: string, sessionId: string, active: boolean): void {
    this.postMessage({ type: "session/turnActive", agentId, sessionId, active });
  }

  setAgentName(name: string): void {
    this.postMessage({ type: "agentName", name });
  }

  setAgentInfo(agentId: string, info: unknown): void {
    this.postMessage({ type: "agentInfo", agentId, info });
  }

  /** Push available slash commands for a session */
  pushAvailableCommands(agentId: string, sessionId: string, commands: unknown[]): void {
    console.log("[chatPanel] pushAvailableCommands", { agentId, sessionId, commands });
    this.postMessage({ type: "session/availableCommands", agentId, sessionId, commands });
  }

  /** Push a token/context-window update for the active session (no full switch) */
  pushSessionUsage(agentId: string, sessionId: string, tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }, contextWindowMax?: number): void {
    this.postMessage({ type: "session/usage", agentId, sessionId, tokenUsage, contextWindowMax });
  }

  // ========================================================================
  // Inbound Messages ← Webview
  // ========================================================================

  private handleMessage(data: Record<string, unknown>): void {
    switch (data.type as string) {
      case "ready":
        // No-op: webview gets state via setActiveSession from orchestrator
        break;
      case "sendMessage": {
        const agentId = data.agentId as string;
        const sessionId = data.sessionId as string;
        if (agentId && sessionId) {
          this.handleSendMessage(agentId, sessionId, data.text as string, (data.attachments as ContextAttachmentDTO[]) ?? []);
        }
        break;
      }
      case "cancelTurn": {
        const agentId = data.agentId as string;
        const sessionId = data.sessionId as string;
        if (agentId && sessionId) {
          this._onCancelTurn.fire({ agentId, sessionId });
        }
        break;
      }
      case "attachFile":
        this._onAttachFile.fire({ path: data.path as string, lineRange: data.lineRange as [number, number] | undefined });
        break;
      case "fetchFiles":
        // Handled by wireChatPanelEvents in prompt.ts via onDidReceiveMessage
        break;
      case "resolveFile":
        // Handled by wireChatPanelEvents in prompt.ts via onDidReceiveMessage
        break;
      case "resolveSelection":
        // Handled by wireChatPanelEvents in prompt.ts via onDidReceiveMessage
        break;
      case "resolveDiff":
        // Handled by wireChatPanelEvents in prompt.ts via onDidReceiveMessage
        break;
      case "openNewSessionPicker":
        void vscode.commands.executeCommand("acp.newSession");
        break;
      case "openFile": {
        const filePath = data.path as string;
        const line = data.line as number | undefined;
        if (filePath) {
          this._onOpenFile.fire({ path: filePath, line });
        }
        break;
      }
    }
  }

  private handleSendMessage(agentId: string, sessionId: string, text: string, attachments: ContextAttachmentDTO[]): void {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      attachmentsJson: attachments.length > 0 ? JSON.stringify(attachments) : undefined,
    };
    this.pushMessage(agentId, sessionId, userMessage);
    this._onSendMessage.fire({ agentId, sessionId, text, attachments });
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")
    );
    const nonce = crypto.randomUUID();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <title>ACP Chat</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
