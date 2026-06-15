import type { TokenUsage } from "../../../application/session/types";
import type {
  ChatMessage,
  ToolCall,
  ContextAttachmentDTO,
} from "../../../domain/models/chat";
import type { UIAPI, WebviewPanel } from "../../../platform/ui";
import type { EventEmitter, PlatformUri } from "../../../platform/types";
import { VscodeUIAPI, toPlatformUri } from "../../../platform/adapters/vscode";
import type { LogEntrySink } from "../../../platform/backends/log-entry-sink-backend";
import { LogLevelValue } from "../../../platform/backends/types";
import { BatchedPathResolver } from "../../../extension/pathResolver";

// ============================================================================
// Snapshot sent to webview on session switch
// ============================================================================

export interface SessionSnapshot {
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsage; // { input, output, total }
}

function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Inline file-path extraction (no I/O — candidates validated by BatchedPathResolver)
// ---------------------------------------------------------------------------

const LOOKS_LIKE_PATH_RE =
  /^(\.{0,2}\/|~\/|\/|[A-Za-z]:\\)[\w./~$-]+(?:\.[a-zA-Z0-9]+)?$|^[\w./-]+\/[\w./-]+$/;

export function extractCandidatePaths(text: string): string[] {
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
 * Stateless chat panel — forwards snapshots from SessionOrchestrator events.
 * Uses Platform API for webview panel creation.
 */
export class ChatPanel {
  public static readonly viewId = "acp.chatPanel";
  private static instance: ChatPanel | null = null;

  private panel: WebviewPanel | null = null;
  private ui: UIAPI;
  private extensionUri: PlatformUri;
  private pathResolver: BatchedPathResolver;
  private currentSessionKey: string = "";

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

  /** Extension-side logger — set by extension.ts after construction. */
  logger: { debug(msg: string): void; info(msg: string): void; warn(msg: string): void; error(msg: string): void } | null = null;

  /** Log entry sink — set by extension.ts to persist webview logs to DB. */
  private static logSink: LogEntrySink | null = null;

  static setLogSink(sink: LogEntrySink): void {
    ChatPanel.logSink = sink;
  }

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
    this.pathResolver = new BatchedPathResolver(process.cwd(), {
      onResolved: (paths) => {
        if (this.currentSessionKey) {
          this.postMessage({ type: "pathsResolved", sessionKey: this.currentSessionKey, paths });
        }
      },
    });
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
    this.currentSessionKey = sessionKey(agentId, sessionId);
    const cwd = info.cwd ?? process.cwd();
    this.pathResolver.updateCwd(cwd);
    this.postMessage({
      type: "session/switch",
      agentId,
      sessionId,
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
      createdAt: info.createdAt.toISOString(),
    });
    const commands = this._onGetSessionCommands?.(agentId, sessionId) ?? [];
    if (commands.length > 0) {
      this.pushAvailableCommands(agentId, sessionId, commands);
    }
  }

  pushMessage(
    agentId: string,
    sessionId: string,
    message: ChatMessage,
    _cwd?: string
  ): void {
    // Attach path candidates for session restore (resource_link blocks).
    // Existence is validated asynchronously by BatchedPathResolver separately.
    const candidates = extractCandidatePaths(message.content);
    const enriched = candidates.length > 0
      ? { ...message, inlineFilePaths: candidates }
      : message;
    this.postMessage({
      type: "session/message",
      agentId,
      sessionId,
      message: enriched,
    });
    if (candidates.length > 0) {
      this.pathResolver.enqueue(candidates);
    }
  }

  pushStreamChunk(agentId: string, sessionId: string, chunk: string): void {
    this.postMessage({ type: "session/stream", agentId, sessionId, chunk });
    // Enqueue path candidates from streaming chunks
    const candidates = extractCandidatePaths(chunk);
    if (candidates.length > 0) {
      this.pathResolver.enqueue(candidates);
    }
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

  pushSessionCompression(
    agentId: string,
    sessionId: string,
    info: {
      contextWindowMax: number;
      usedTokens: number;
      usedBefore?: number;
    }
  ): void {
    this.postMessage({
      type: "session/compression",
      agentId,
      sessionId,
      contextWindowMax: info.contextWindowMax,
      usedTokens: info.usedTokens,
      usedBefore: info.usedBefore,
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
      lastTurnOutcome: info.lastTurnOutcome,
      tokenUsage: {
        inputTokens: info.tokenUsage.input,
        outputTokens: info.tokenUsage.output,
        totalTokens: info.tokenUsage.total,
      },
      contextWindowMax: info.contextWindowMax,
      model: info.model,
      mode: info.mode,
      cwd: info.cwd,
      isStreaming: info.isStreaming,
      createdAt: info.createdAt.toISOString(),
      lastResponseAt: info.lastResponseAt,
    });
  }

  /** Push SessionInfo for ALL sessions (used by sendTabsToChatPanel to sync non-active sessions) */
  pushAllSessionInfos(
    agentId: string,
    sessions: import("../../../application/session/types").SessionInfo[]
  ): void {
    for (const info of sessions) {
      this.pushSessionInfo(agentId, info.sessionId, info);
    }
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
      case "log": {
        this.handleWebviewLog(data.payload as Record<string, unknown>);
        break;
      }
    }
  }

  /**
   * Forward webview log messages to the extension logger and persist to DB.
   */
  private handleWebviewLog(payload: Record<string, unknown>): void {
    const level = String(payload.level ?? "info");
    const category = String(payload.category ?? "webview");
    const message = String(payload.message ?? "");
    const context = (payload.context as Record<string, unknown>) ?? {};
    const line = `[webview:${category}] ${message} ${JSON.stringify(context)}`;
    switch (level) {
      case "trace":
      case "debug":
        this.logger?.debug(line);
        break;
      case "info":
        this.logger?.info(line);
        break;
      case "warn":
        this.logger?.warn(line);
        break;
      case "error":
        this.logger?.error(line);
        break;
      default:
        this.logger?.info(line);
    }

    // Persist webview log to DB via sink
    if (ChatPanel.logSink) {
      const levelMap: Record<string, LogLevelValue> = {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4,
      };
      ChatPanel.logSink.emit({
        level: levelMap[level] ?? 2,
        category: `webview.${category}`,
        message,
        timestamp: Date.now(),
        context,
      });
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
