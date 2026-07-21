import * as vscode from "vscode";
import { ChatPanel } from "./chatPanel";
import type { PlatformUri } from "../../../platform/types";
import { VscodeUIAPI } from "../../../platform/adapters/vscode";

// MiniChatPanel uses the same webview bundle as ChatPanel (dist/webview.js) but
// in "mini" layout mode.  Both layouts share the same Zustand stores — no state
// sync bridge needed between webview instances.
//
// However, the extension-side SessionStateBridge must still be wired so that
// orchestrator events (sendTabs, session/snapshot, session/message, etc.) reach
// the MiniChatPanel webview.  This is done via ChatPanel._stateBridge.register()
// and ChatPanel._stateSyncHandler.registerPanel() in createPanel().
// These calls were missing before 2026-07-21, causing MiniChat to show no sessions
// and not reflect sent messages.

/**
 * MiniChat panel — now loads the SAME webview bundle (dist/webview.js)
 * as the full ChatPanel, but sends an initial "ui:setLayoutMode" message
 * to switch the webview to mini layout. Both layouts share the same
 * Zustand stores — no state sync bridge needed.
 *
 * - viewId = "acp.miniChat" (separate webview instance for secondary sidebar)
 * - default placement is ViewColumn.Beside (does not steal the editor area)
 * - loads dist/webview.js (same bundle as ChatPanel)
 * - sends ui:setLayoutMode to switch to mini layout
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

    // Send initial layout mode message to switch webview to mini layout
    if (this.panel) {
      this.panel.webview.postMessage({
        type: "ui:setLayoutMode",
        mode: "mini",
      });
    }

    this.panel.webview.onDidReceiveMessage((data) => {
      const msg = data as Record<string, unknown>;
      this.onDidReceiveMessageEmitter.fire(msg);
      this.handleMessage(msg);
    });

    this.panel.onDidDispose(() => {
      MiniChatPanel.miniInstance = null;
      this.panel = null;
      // Notify bridge listeners (SessionStateBridge auto-unregisters).
      for (const fn of this._disposeListeners) fn();
    });

    // Register with the state bridge so all orchestrator events reach
    // this panel automatically.
    ChatPanel._stateBridge?.register(this);

    // Register with state sync handler for multi-webview state sync
    ChatPanel._stateSyncHandler?.registerPanel(this.panel);
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
      .asWebviewUri(this.distUri("webview.js"))
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
