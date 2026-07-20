// src/platform/ui.ts

import type { Disposable, Event, EventEmitter, PlatformUri } from "./types";

export type MessageSeverity = "info" | "warning" | "error";

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
  iconPath?: string;
}

export interface QuickPickButton {
  iconPath: string;
  tooltip?: string;
}

export interface InputBoxOptions {
  prompt?: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
}

export interface OpenDialogOptions {
  canSelectMany?: boolean;
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  openLabel?: string;
  filters?: Record<string, string[]>;
}

export interface OutputChannel {
  appendLine(value: string): void;
  show(): void;
  dispose(): void;
}

export interface TreeItem {
  label: string;
  collapsibleState: "none" | "collapsed" | "expanded";
  command?: { command: string; title: string; arguments?: unknown[] };
  iconPath?: string;
  description?: string;
  tooltip?: string;
}

export interface TreeDataProvider<T> {
  onDidChangeTreeData: Event<T | undefined>;
  getTreeItem(element: T): TreeItem;
  getChildren(element?: T): T[] | Promise<T[]>;
}

export interface WebviewPanel {
  readonly webview: Webview;
  reveal(): void;
  onDidDispose: Event<void>;
  dispose(): void;
}

export interface Webview {
  html: string;
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage: Event<unknown>;
  asWebviewUri(uri: PlatformUri): PlatformUri;
  cspSource: string;
}

export interface UIAPI {
  showMessage(message: string, severity?: MessageSeverity): Promise<void>;
  showQuickPick(
    items: QuickPickItem[],
    options?: {
      placeHolder?: string;
      canPickMany?: boolean;
      buttons?: QuickPickButton[];
      onDidTriggerButton?: (button: QuickPickButton) => void;
    }
  ): Promise<QuickPickItem | QuickPickItem[] | undefined>;
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
  showOpenDialog(
    options?: OpenDialogOptions
  ): Promise<PlatformUri[] | undefined>;
  createOutputChannel(name: string): OutputChannel;
  createWebviewPanel(options: {
    viewId: string;
    title: string;
    html: string;
    enableScripts?: boolean;
    retainContextWhenHidden?: boolean;
    /** Initial placement column (VS Code only). Defaults to ViewColumn.One. */
    viewColumn?: number;
  }): WebviewPanel;
  registerTreeDataProvider<T>(
    viewId: string,
    provider: TreeDataProvider<T>
  ): Disposable;
  registerCommand(
    commandId: string,
    handler: (...args: unknown[]) => unknown
  ): Disposable;
  executeCommand<T>(
    commandId: string,
    ...args: unknown[]
  ): Promise<T | undefined>;
  setContext(key: string, value: unknown): Promise<void>;
  createEventEmitter<T>(): EventEmitter<T>;
  showNotification(
    message: string,
    items: string[]
  ): Promise<string | undefined>;
  clipboardWriteText(text: string): Promise<void>;
  getConfiguration<T>(section: string, key: string, defaultValue: T): T;
}
