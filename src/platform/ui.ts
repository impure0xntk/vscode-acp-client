// src/platform/ui.ts

import type { Disposable, Event, EventEmitter, PlatformUri } from "./types";

/** Message severity */
export type MessageSeverity = "info" | "warning" | "error";

/** QuickPick item */
export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
  iconPath?: string;
}

/** QuickPick button */
export interface QuickPickButton {
  iconPath: string;
  tooltip?: string;
}

/** Input box options */
export interface InputBoxOptions {
  prompt?: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
}

/** File dialog options */
export interface OpenDialogOptions {
  canSelectMany?: boolean;
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  openLabel?: string;
  filters?: Record<string, string[]>;
}

/** Status bar item */
export interface StatusBarItem {
  text: string;
  tooltip: string;
  command?: string;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** Output channel */
export interface OutputChannel {
  appendLine(value: string): void;
  show(): void;
  dispose(): void;
}

/** Tree view item */
export interface TreeItem {
  label: string;
  collapsibleState: "none" | "collapsed" | "expanded";
  command?: { command: string; title: string; arguments?: unknown[] };
  iconPath?: string;
  description?: string;
  tooltip?: string;
}

/** Tree data provider */
export interface TreeDataProvider<T> {
  onDidChangeTreeData: Event<T | undefined>;
  getTreeItem(element: T): TreeItem;
  getChildren(element?: T): T[] | Promise<T[]>;
}

/** Webview panel */
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

/** UI API interface */
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

  // ── Configuration ──
  getConfiguration<T>(section: string, key: string, defaultValue: T): T;
}
