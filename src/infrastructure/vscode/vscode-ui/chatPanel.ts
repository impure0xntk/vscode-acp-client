import * as fs from "fs";
import * as path from "path";
import type { TokenUsage } from "../../../application/session/types";
import type {
  ChatMessage,
  ToolCall,
  ContextAttachmentDTO,
} from "../../../domain/models/chat";
import type { UIAPI, WebviewPanel } from "../../../platform/ui";
import type { EventEmitter, PlatformUri } from "../../../platform/types";
import { VscodeUIAPI, toPlatformUri } from "../../../platform/adapters/vscode";

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

const LOOKS_LIKE_PATH_RE =
  /^(\.{0,2}\/|~\/|\/|[A-Za-z]:\\)[\w./~$-]+(?:\.[a-zA-Z0-9]+)?$|^[\w./-]+\/[\w./-]+$/;

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

function resolveCandidate(candidate: string, cwd: string): string {
  if (
    candidate.startsWith("/") ||
    candidate.startsWith("~") ||
    /^[A-Za-z]:\\/.test(candidate)
  ) {
    return candidate.startsWith("~")
      ? candidate.replace("~", process.env.HOME ?? "~")
      : candidate;
  }
  return path.resolve(cwd, candidate);
}

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
      // ignore
    }
  }
  return existing;
}

function attachInlineFilePaths(message: ChatMessage, cwd: string): ChatMessage {
  const existing = findExistingInlinePaths(message.content, cwd);
  if (existing.length === 0) return message;
  return { ...message, inlineFilePaths: existing };
}

/**
 * Stateless chat panel — forwards snapshots from SessionOrchestrator events.
 * Uses Platform API for webview panel creation.
 */
export class ChatPanel {
  public static readonly viewId = "acp.chatPanel";
  private static instance: ChatPanel | null = null;

  private panel: WebviewPanel | null = null;
  private ui: UIAPI;
  private extensionUri: PlatformUri;

  private _onSendMessage: EventEmitter<{
    agentId: string;
    sessionId: string;
    text: string;
    attachments: ContextAttachmentDTO[];
  }>;
  private _onCancelTurn: EventEmitter<{ agentId: string; sessionId: string }>;
  private _onAttachFile: EventEmitter<{
    path: string;
    lineRange?: [number, number];
  }>;
  private _onDidReceiveMessage: EventEmitter<Record<string, unknown>>;
  private _onOpenFile: EventEmitter<{ path: string; line?: number }>;

  get onSendMessage() {
    return this._onSendMessage.event;
  }
  get onCancelTurn() {
    return this._onCancelTurn.event;
  }
  get onAttachFile() {
    return this._onAttachFile.event;
  }
  get onDidReceiveMessage() {
    return this._onDidReceiveMessage.event;
  }
  get onOpenFile() {
    return this._onOpenFile.event;
  }

  _onGetSessionCommands:
    | ((agentId: string, sessionId: string) => unknown[])
    | null = null;

  static reveal(extensionUri: PlatformUri): ChatPanel {
    if (ChatPanel.instance?.panel) {
      ChatPanel.instance.panel.reveal();
      return ChatPanel.instance;
    }
    // Instance exists but panel was disposed — create a fresh instance
    const ui = new VscodeUIAPI();
    ChatPanel.instance = new ChatPanel(ui, extensionUri);
    return ChatPanel.instance;
  }

  static get current(): ChatPanel | null {
    return ChatPanel.instance;
  }

  private constructor(ui: UIAPI, extensionUri: PlatformUri) {
    this.ui = ui;
    this.extensionUri = extensionUri;
    this._onSendMessage = ui.createEventEmitter();
    this._onCancelTurn = ui.createEventEmitter();
    this._onAttachFile = ui.createEventEmitter();
    this._onDidReceiveMessage = ui.createEventEmitter();
    this._onOpenFile = ui.createEventEmitter();
    this.createPanel();
  }

  private createPanel(): void {
    // Build HTML first (before panel creation so we can pass it in)
    const html = this.buildHtmlForCreation();
    this.panel = this.ui.createWebviewPanel({
      viewId: ChatPanel.viewId,
      title: "ACP Chat",
      html,
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    // Now that panel exists, update HTML with proper webview URIs
    this.updatePanelHtml();

    this.panel.webview.onDidReceiveMessage((data) => {
      const msg = data as Record<string, unknown>;
      this._onDidReceiveMessage.fire(msg);
      this.handleMessage(msg);
    });

    this.panel.onDidDispose(() => {
      ChatPanel.instance = null;
      this.panel = null;
    });
  }

  private buildHtmlForCreation(): string {
    // Minimal HTML — will be replaced by updatePanelHtml() immediately after
    return `<!DOCTYPE html><html><body><div id="root"></div></body></html>`;
  }

  private updatePanelHtml(): void {
    const p = this.panel;
    if (!p) return;
    const nonce = crypto.randomUUID();
    const cssUri = p.webview
      .asWebviewUri(this.distUri("webview.css"))
      .toString();
    const jsUri = p.webview.asWebviewUri(this.distUri("webview.js")).toString();
    const csp = [
      "default-src 'none'",
      `style-src ${p.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${p.webview.cspSource}`,
      `img-src ${p.webview.cspSource} https: data:`,
      `font-src ${p.webview.cspSource}`,
    ].join("; ");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>ACP Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    p.webview.html = html;
  }

  private distUri(filename: string): PlatformUri {
    return this.extensionUri.with({
      path: this.extensionUri.path + "/dist/" + filename,
    });
  }

  reveal(): void {
    this.panel?.reveal();
  }

  setActiveSession(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").SessionInfo
  ): void {
    // Send full message snapshot (session/switch) — high cost but only on session switch
    const cwd = info.cwd;
    const enriched = info.messages.map((m) => attachInlineFilePaths(m, cwd));
    this.postMessage({
      type: "session/switch",
      agentId,
      sessionId,
      messages: enriched,
      isTurnActive: info.isTurnActive,
      isStreaming: info.isStreaming,
      tokenUsage: {
        inputTokens: info.tokenUsage.input,
        outputTokens: info.tokenUsage.output,
        totalTokens: info.tokenUsage.total,
      },
      contextWindowMax: info.contextWindowMax,
      model: info.model,
      mode: info.mode,
      cwd: info.cwd,
      messageCount: info.messages.length,
      createdAt: info.createdAt.toISOString(),
      updatedAt: info.updatedAt.toISOString(),
    });
    // Also push metadata-only update for sessionInfoMap
    this.pushSessionInfo(agentId, sessionId, info);
    const commands = this._onGetSessionCommands?.(agentId, sessionId) ?? [];
    if (commands.length > 0) {
      this.pushAvailableCommands(agentId, sessionId, commands);
    }
  }

  pushMessage(
    agentId: string,
    sessionId: string,
    message: ChatMessage,
    cwd?: string
  ): void {
    const enriched = cwd ? attachInlineFilePaths(message, cwd) : message;
    this.postMessage({
      type: "session/message",
      agentId,
      sessionId,
      message: enriched,
    });
  }

  pushStreamChunk(agentId: string, sessionId: string, chunk: string): void {
    this.postMessage({ type: "session/stream", agentId, sessionId, chunk });
  }

  pushStreamEnd(agentId: string, sessionId: string): void {
    this.postMessage({ type: "session/streamEnd", agentId, sessionId });
  }

  pushSessionNotification(
    agentId: string,
    sessionId: string,
    notification: unknown
  ): void {
    this.postMessage({
      type: "session/notification",
      agentId,
      sessionId,
      notification,
    });
  }

  pushTurnActive(agentId: string, sessionId: string, active: boolean): void {
    this.postMessage({
      type: "session/turnActive",
      agentId,
      sessionId,
      active,
    });
  }

  setAgentName(name: string): void {
    this.postMessage({ type: "agentName", name });
  }

  setAgentInfo(agentId: string, info: unknown): void {
    this.postMessage({ type: "agentInfo", agentId, info });
  }

  pushAvailableCommands(
    agentId: string,
    sessionId: string,
    commands: unknown[]
  ): void {
    this.postMessage({
      type: "session/availableCommands",
      agentId,
      sessionId,
      commands,
    });
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
    this.postMessage({
      type: "session/usage",
      agentId,
      sessionId,
      tokenUsage,
      contextWindowMax,
    });
  }

  /** Push SessionInfo metadata to webview (no messages — use setActiveSession for full snapshot) */
  pushSessionInfo(
    agentId: string,
    sessionId: string,
    info: import("../../../application/session/types").SessionInfo
  ): void {
    this.postMessage({
      type: "session/info",
      agentId,
      sessionId,
      status: info.status,
      tokenUsage: {
        inputTokens: info.tokenUsage.input,
        outputTokens: info.tokenUsage.output,
        totalTokens: info.tokenUsage.total,
      },
      contextWindowMax: info.contextWindowMax,
      model: info.model,
      mode: info.mode,
      cwd: info.cwd,
      isTurnActive: info.isTurnActive,
      isStreaming: info.isStreaming,
      messageCount: info.messages.length,
      createdAt: info.createdAt.toISOString(),
      updatedAt: info.updatedAt.toISOString(),
    });
  }

  private handleMessage(data: Record<string, unknown>): void {
    switch (data.type as string) {
      case "ready":
        break;
      case "sendMessage": {
        const agentId = data.agentId as string;
        const sessionId = data.sessionId as string;
        if (agentId && sessionId) {
          this.handleSendMessage(
            agentId,
            sessionId,
            data.text as string,
            (data.attachments as ContextAttachmentDTO[]) ?? []
          );
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
        this._onAttachFile.fire({
          path: data.path as string,
          lineRange: data.lineRange as [number, number] | undefined,
        });
        break;
      // fetchFiles, resolveFile, resolveSelection, resolveDiff, fetchSymbols, resolveSymbol
      // are handled via onDidReceiveMessage in wireChatPanelEvents().
      // They must not be intercepted here — intentionally no case for them.
      case "openNewSessionPicker":
        void this.ui.executeCommand("acp.newSession");
        break;
      case "openFile": {
        const filePath = data.path as string;
        const line = data.line as number | undefined;
        if (filePath) {
          this._onOpenFile.fire({ path: filePath, line });
        }
        break;
      }
      case "copyToClipboard": {
        const text = data.text as string;
        if (text) {
          void this.ui.clipboardWriteText(text);
        }
        break;
      }
    }
  }

  private handleSendMessage(
    agentId: string,
    sessionId: string,
    text: string,
    attachments: ContextAttachmentDTO[]
  ): void {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      attachmentsJson:
        attachments.length > 0 ? JSON.stringify(attachments) : undefined,
    };
    this.pushMessage(agentId, sessionId, userMessage);
    this._onSendMessage.fire({ agentId, sessionId, text, attachments });
  }

  postMessage(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }
}
