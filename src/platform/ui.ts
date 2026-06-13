// src/platform/ui.ts

import type { Disposable, Event, EventEmitter, PlatformUri } from "./types";

/** メッセージ重要度 */
export type MessageSeverity = "info" | "warning" | "error";

/** QuickPick アイテム */
export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
  iconPath?: string;
}

/** QuickPick ボタン */
export interface QuickPickButton {
  iconPath: string;
  tooltip?: string;
}

/** 入力ボックスオプション */
export interface InputBoxOptions {
  prompt?: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
}

/** ファイルダイアログオプション */
export interface OpenDialogOptions {
  canSelectMany?: boolean;
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  openLabel?: string;
  filters?: Record<string, string[]>;
}

/** ステータスバーアイテム */
export interface StatusBarItem {
  text: string;
  tooltip: string;
  command?: string;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** 出力チャネル */
export interface OutputChannel {
  appendLine(value: string): void;
  show(): void;
  dispose(): void;
}

/** ツリービューアイテム */
export interface TreeItem {
  label: string;
  collapsibleState: "none" | "collapsed" | "expanded";
  command?: { command: string; title: string; arguments?: unknown[] };
  iconPath?: string;
  description?: string;
  tooltip?: string;
}

/** ツリーデータプロバイダ */
export interface TreeDataProvider<T> {
  onDidChangeTreeData: Event<T | undefined>;
  getTreeItem(element: T): TreeItem;
  getChildren(element?: T): T[] | Promise<T[]>;
}

/** Webview パネル */
export interface WebviewPanel {
  readonly webview: Webview;
  reveal(): void;
  onDidDispose: Event<void>;
  dispose(): void;
}

/** Webview */
export interface Webview {
  html: string;
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage: Event<unknown>;
  /** Convert a local file URI to a webview-safe URI */
  asWebviewUri(uri: PlatformUri): PlatformUri;
  /** CSP source string for this webview (e.g. "https://vscode-cdn.net") */
  cspSource: string;
}

/** UI API インターフェース */
export interface UIAPI {
  // ── Message display ──
  showMessage(message: string, severity?: MessageSeverity): Promise<void>;

  // ── QuickPick ──
  showQuickPick(
    items: QuickPickItem[],
    options?: {
      placeHolder?: string;
      canPickMany?: boolean;
      buttons?: QuickPickButton[];
      onDidTriggerButton?: (button: QuickPickButton) => void;
    }
  ): Promise<QuickPickItem | QuickPickItem[] | undefined>;

  // ── InputBox ──
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;

  // ── File dialog ──
  showOpenDialog(
    options?: OpenDialogOptions
  ): Promise<PlatformUri[] | undefined>;

  // ── Status bar ──
  createStatusBarItem(options: {
    alignment: "left" | "right";
    priority?: number;
    command?: string;
  }): StatusBarItem;

  // ── Output channel ──
  createOutputChannel(name: string): OutputChannel;

  // ── Webview panel ──
  createWebviewPanel(options: {
    viewId: string;
    title: string;
    html: string;
    enableScripts?: boolean;
    retainContextWhenHidden?: boolean;
  }): WebviewPanel;

  // ── Tree View ──
  registerTreeDataProvider<T>(
    viewId: string,
    provider: TreeDataProvider<T>
  ): Disposable;

  // ── Commands ──
  registerCommand(
    commandId: string,
    handler: (...args: unknown[]) => unknown
  ): Disposable;
  executeCommand<T>(
    commandId: string,
    ...args: unknown[]
  ): Promise<T | undefined>;
  setContext(key: string, value: unknown): Promise<void>;

  // ── Event emitter ──
  createEventEmitter<T>(): EventEmitter<T>;

  // ── Notifications ──
  showNotification(
    message: string,
    items: string[]
  ): Promise<string | undefined>;

  // ── Clipboard ──
  clipboardWriteText(text: string): Promise<void>;
}
