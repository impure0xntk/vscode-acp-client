import * as vscode from "vscode";
import { ChatPanel } from "./chatPanel";
import type { UIAPI, WebviewPanel } from "../../../platform/ui";
import type { EventEmitter, PlatformUri } from "../../../platform/types";
import { VscodeUIAPI, toPlatformUri } from "../../../platform/adapters/vscode";

/**
 * MiniChat panel — a lightweight variant of ChatPanel that renders only the
 * Session Overview + Composer (plus an optional drill-down history). It shares
 * the same message protocol and SessionOrchestrator as the full chat panel,
 * so session state stays in sync (FR-7/FR-10/FR-15).
 *
 * Differences from ChatPanel:
 * - viewId = "acp.miniChat" (separate webview instance)
 * - default placement is ViewColumn.Beside (does not steal the editor area)
 * - loads dist/webview.mini.js instead of dist/webview.js
 * - registers with SessionStateBridge on creation (automatic state sync)
 */
export class MiniChatPanel extends ChatPanel {
  public static readonly viewId: string = "acp.miniChat";
  protected static miniInstance: MiniChatPanel | null = null;

  static reveal(extensionUri: PlatformUri): MiniChatPanel {
    if (MiniChatPanel.miniInstance?.panel) {
      MiniChatPanel.miniInstance.panel.reveal();
      return MiniChatPanel.miniInstance;
    }
    const ui = new VscodeUIAPI();
    MiniChatPanel.miniInstance = new MiniChatPanel(ui, extensionUri);
    return MiniChatPanel.miniInstance;
  }

  static get current(): MiniChatPanel | null {
    return MiniChatPanel.miniInstance;
  }

  protected createPanel(): void {
    const html = this.buildHtmlForCreation();
    this.panel = this.ui.createWebviewPanel({
      viewId: MiniChatPanel.viewId,
      title: "ACP MiniChat",
      html,
      enableScripts: true,
      retainContextWhenHidden: true,
      // FR-4: place beside the editor so the implementation view is unobstructed.
      viewColumn: vscode.ViewColumn.Beside,
    });

    this.updatePanelHtml();

    this.panel.webview.onDidReceiveMessage((data) => {
      const msg = data as Record<string, unknown>;
      this.onDidReceiveMessageEmitter.fire(msg);
      this.handleMessage(msg);
    });

    this.panel.onDidDispose(() => {
      MiniChatPanel.miniInstance = null;
      this.panel = null;
      // onDidDispose emitter fires → bridge auto-unregisters
    });

    // Register with the state bridge so session events are pushed
    // to this panel automatically.  The bridge is set before createPanel()
    // is called by the factory/command code.
    ChatPanel._stateBridge?.register(this);
  }

  protected distUri(filename: string): PlatformUri {
    return this.extensionUri.with({
      path: this.extensionUri.path + "/dist/" + filename,
    });
  }

  protected updatePanelHtml(): void {
    const p = this.panel;
    if (!p) return;
    const nonce = crypto.randomUUID();
    const cssUri = p.webview
      .asWebviewUri(this.distUri("webview.css"))
      .toString();
    const jsUri = p.webview
      .asWebviewUri(this.distUri("webview.mini.js"))
      .toString();
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
  <title>ACP MiniChat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    p.webview.html = html;
  }
}
