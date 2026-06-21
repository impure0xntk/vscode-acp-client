// src/platform/adapters/vscode.ts

import * as vscode from "vscode";
import type {
  Disposable,
  EventEmitter,
  Event,
  FileSnapshot,
  FileStat,
  FileWatchEvent,
  PlatformUri,
} from "../types";
import type { ConfigValue } from "../types";
import type {
  UIAPI,
  QuickPickItem,
  QuickPickButton,
  InputBoxOptions,
  OpenDialogOptions,
  OutputChannel,
  TreeItem,
  TreeDataProvider,
  WebviewPanel,
  Webview,
} from "../ui";
import type { FileSystemAPI, FileCandidate } from "../filesystem";
import type {
  EditorAPI,
  SymbolInfo,
  DefinitionLocation,
  Selection,
  ActiveEditor,
  DiffResult,
} from "../editor";
import type {
  ExtensionContextAPI,
  Memento,
  OrchestrationStateSnapshot,
} from "../context";
import type { TerminalAPI, Terminal } from "../terminal";
import type { OrchestrationStateAPI } from "../orchestration";
import type { PlatformAPI } from "../platform";
import type {
  LogStorageAPI,
  ClearLogsOptions,
  ClearLogsResult,
} from "../logStorage";
import { VsCodeOutputBackend } from "../backends/vscode-output-backend";
import { LogEntrySinkBackend } from "../backends/log-entry-sink-backend";
import { LoggerFactoryImpl } from "../backends/logger-impl";
import { initLoggerFactory, getLoggerFactory } from "../backends";
import type { LogLevelValue } from "../backends/types";
import type { PersistentHistoryStore } from "../../application/session/persistentHistory";
import type { LogEntrySink } from "../backends/log-entry-sink-backend";
import { LogEntrySinkImpl } from "../../domain/services/log-entry-sink";

// ---------------------------------------------------------------------------
// VSCode LogStorage API
// ---------------------------------------------------------------------------

class VscodeLogStorageAPI implements LogStorageAPI {
  private store: PersistentHistoryStore | null = null;

  setStore(store: PersistentHistoryStore): void {
    this.store = store;
  }

  async clearLogs(options?: ClearLogsOptions): Promise<ClearLogsResult> {
    if (!this.store) return { deletedCount: 0 };
    return this.store.clearLogs({
      olderThan: options?.olderThan ?? null,
      agentId: options?.agentId ?? null,
      sessionId: options?.sessionId ?? null,
    });
  }

  async countLogs(options?: ClearLogsOptions): Promise<number> {
    if (!this.store) return 0;
    return this.store.countLogs({
      olderThan: options?.olderThan ?? null,
      agentId: options?.agentId ?? null,
      sessionId: options?.sessionId ?? null,
    });
  }

  getStore(): PersistentHistoryStore | null {
    return this.store;
  }
}

// ---------------------------------------------------------------------------
// VSCode Platform
// ---------------------------------------------------------------------------

export class VscodePlatform implements PlatformAPI {
  readonly platform = "vscode" as const;
  readonly version: string;

  readonly ui: UIAPI;
  readonly fs: FileSystemAPI;
  readonly editor: EditorAPI;
  readonly context: ExtensionContextAPI;
  readonly terminal: TerminalAPI;
  readonly orchestration: OrchestrationStateAPI;
  logStorage: LogStorageAPI;

  private ctx: vscode.ExtensionContext;
  private sinkBackend: LogEntrySinkBackend | null = null;

  constructor(options: {
    context: vscode.ExtensionContext;
    logLevel?: LogLevelValue;
  }) {
    this.ctx = options.context;
    this.version = vscode.version;

    // ── Initialize logging ────────────────────────────────────────────
    const logChannel = vscode.window.createOutputChannel("ACP Client");
    const logLevel: LogLevelValue = 1; // default: debug for VS Code
    const baseBackend = new VsCodeOutputBackend(logChannel, logLevel);
    this.sinkBackend = new LogEntrySinkBackend(baseBackend);
    const factory = new LoggerFactoryImpl(this.sinkBackend);
    initLoggerFactory(factory);

    this.ui = new VscodeUIAPI();
    this.fs = new VscodeFileSystemAPI();
    this.editor = new VscodeEditorAPI();
    this.context = new VscodeContextAPI(this.ctx);
    this.terminal = new VscodeTerminalAPI();
    this.orchestration = new VscodeOrchestrationStateAPI(this.ctx);
    this.logStorage = new VscodeLogStorageAPI();
  }

  setLogStore(store: PersistentHistoryStore): void {
    (this.logStorage as VscodeLogStorageAPI).setStore(store);
    // Wire the log entry sink to the persistent store
    const sink = new LogEntrySinkImpl();
    sink.setStore(store);
    this.sinkBackend?.setSink(sink);
  }

  async initialize(): Promise<void> {
    // VSCode-specific initialization is done in activate; nothing to do here
  }

  async dispose(): Promise<void> {
    // Resource cleanup is done in deactivate
  }
}

// ---------------------------------------------------------------------------
// VSCode UI API
// ---------------------------------------------------------------------------

export class VscodeUIAPI implements UIAPI {
  async showMessage(
    message: string,
    severity: "info" | "warning" | "error" = "info"
  ): Promise<void> {
    if (severity === "error") {
      await vscode.window.showErrorMessage(message);
    } else if (severity === "warning") {
      await vscode.window.showWarningMessage(message);
    } else {
      await vscode.window.showInformationMessage(message);
    }
  }

  async showQuickPick(
    items: QuickPickItem[],
    options?: {
      placeHolder?: string;
      canPickMany?: boolean;
      buttons?: QuickPickButton[];
      onDidTriggerButton?: (button: QuickPickButton) => void;
    }
  ): Promise<QuickPickItem | QuickPickItem[] | undefined> {
    const vscodeItems = items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      picked: item.picked,
    }));

    const result = await vscode.window.showQuickPick(vscodeItems, {
      placeHolder: options?.placeHolder,
      canPickMany: options?.canPickMany,
    });

    return result as QuickPickItem | QuickPickItem[] | undefined;
  }

  async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    return vscode.window.showInputBox(options);
  }

  async showOpenDialog(
    options?: OpenDialogOptions
  ): Promise<PlatformUri[] | undefined> {
    const result = await vscode.window.showOpenDialog(options);
    if (!result) return undefined;
    return result.map((uri) => toPlatformUri(uri));
  }

  createOutputChannel(name: string): OutputChannel {
    return this.createInternalOutputChannel(name);
  }

  /** @internal Direct OutputChannel access for LoggerFactory */
  createInternalOutputChannel(name: string): OutputChannel {
    const channel = vscode.window.createOutputChannel(name);
    return {
      appendLine: (value: string) => channel.appendLine(value),
      show: () => channel.show(),
      dispose: () => channel.dispose(),
    };
  }

  createWebviewPanel(options: {
    viewId: string;
    title: string;
    html: string;
    enableScripts?: boolean;
    retainContextWhenHidden?: boolean;
  }): WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      options.viewId,
      options.title,
      vscode.ViewColumn.One,
      {
        enableScripts: options.enableScripts ?? true,
        retainContextWhenHidden: options.retainContextWhenHidden ?? false,
      }
    );

    panel.webview.html = options.html;

    // Keep a mutable reference so callers can update html / read cspSource live
    const webviewRef: Webview = {
      get html() {
        return panel.webview.html;
      },
      set html(value: string) {
        panel.webview.html = value;
      },
      postMessage: async (message: unknown) =>
        panel.webview.postMessage(message),
      onDidReceiveMessage: (listener: (e: unknown) => void): Disposable => {
        const sub = panel.webview.onDidReceiveMessage(listener);
        return { dispose: () => sub.dispose() };
      },
      asWebviewUri: (uri: PlatformUri) =>
        panel.webview.asWebviewUri(uri as unknown as vscode.Uri),
      cspSource: panel.webview.cspSource,
    };

    return {
      get webview() {
        return webviewRef;
      },
      reveal: () => panel.reveal(),
      onDidDispose: (listener: () => void): Disposable => {
        const sub = panel.onDidDispose(listener);
        return { dispose: () => sub.dispose() };
      },
      dispose: () => panel.dispose(),
    };
  }

  registerTreeDataProvider<T>(
    viewId: string,
    provider: TreeDataProvider<T>
  ): Disposable {
    const vscodeProvider: vscode.TreeDataProvider<T> = {
      onDidChangeTreeData:
        provider.onDidChangeTreeData as unknown as vscode.Event<T | undefined>,
      getTreeItem: (element: T): vscode.TreeItem => {
        const item = provider.getTreeItem(element);
        const vscodeItem = new vscode.TreeItem(
          item.label,
          item.collapsibleState === "none"
            ? vscode.TreeItemCollapsibleState.None
            : item.collapsibleState === "collapsed"
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.Expanded
        );
        if (item.command) vscodeItem.command = item.command;
        if (item.iconPath)
          vscodeItem.iconPath = new vscode.ThemeIcon(item.iconPath);
        if (item.description) vscodeItem.description = item.description;
        if (item.tooltip) vscodeItem.tooltip = item.tooltip;
        return vscodeItem;
      },
      getChildren: (element?: T): T[] | Promise<T[]> =>
        provider.getChildren(element),
    };
    const disposable = vscode.window.registerTreeDataProvider(
      viewId,
      vscodeProvider
    );
    return { dispose: () => disposable.dispose() };
  }

  registerCommand(
    commandId: string,
    handler: (...args: unknown[]) => unknown
  ): Disposable {
    const disposable = vscode.commands.registerCommand(commandId, handler);
    return { dispose: () => disposable.dispose() };
  }

  async executeCommand<T>(
    commandId: string,
    ...args: unknown[]
  ): Promise<T | undefined> {
    return vscode.commands.executeCommand<T>(commandId, ...args);
  }

  async setContext(key: string, value: unknown): Promise<void> {
    await vscode.commands.executeCommand("setContext", key, value);
  }

  createEventEmitter<T>(): EventEmitter<T> {
    const emitter = new vscode.EventEmitter<T>();
    return {
      event: emitter.event as unknown as Event<T>,
      fire: (data: T) => emitter.fire(data),
      dispose: () => emitter.dispose(),
    };
  }

  async showNotification(
    message: string,
    items: string[]
  ): Promise<string | undefined> {
    const result = await vscode.window.showInformationMessage(
      message,
      ...items
    );
    return result;
  }

  async clipboardWriteText(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
  }

  getConfiguration<T>(section: string, key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(section).get<T>(key, defaultValue);
  }
}

// ---------------------------------------------------------------------------
// VSCode FileSystem API
// ---------------------------------------------------------------------------

class VscodeFileSystemAPI implements FileSystemAPI {
  async readFile(path: string): Promise<string> {
    const uri = vscode.Uri.file(path);
    const content = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(content);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileStat> {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return {
      type: stat.type === vscode.FileType.Directory ? "directory" : "file",
      mtime: stat.mtime,
      size: stat.size,
    };
  }

  async findFiles(
    pattern: string,
    exclude?: string,
    maxResults = 50
  ): Promise<PlatformUri[]> {
    const uris = await vscode.workspace.findFiles(pattern, exclude, maxResults);
    return uris.map((uri) => toPlatformUri(uri));
  }

  async findFilesInDirectory(
    cwd: string,
    pattern: string,
    exclude?: string,
    maxResults = 50
  ): Promise<PlatformUri[]> {
    const baseUri = vscode.Uri.file(cwd);
    const relativePattern = new vscode.RelativePattern(baseUri, pattern);
    const uris = await vscode.workspace.findFiles(
      relativePattern,
      exclude,
      maxResults
    );
    return uris.map((uri) => toPlatformUri(uri));
  }

  watchFiles(
    pattern: string,
    callback: (event: FileWatchEvent) => void
  ): () => void {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange((uri) =>
      callback({ path: uri.fsPath, type: "change" })
    );
    watcher.onDidCreate((uri) => callback({ path: uri.fsPath, type: "add" }));
    watcher.onDidDelete((uri) =>
      callback({ path: uri.fsPath, type: "unlink" })
    );
    return () => watcher.dispose();
  }

  async captureSnapshot(path: string): Promise<FileSnapshot> {
    const content = await this.readFile(path);
    const stat = await this.stat(path);
    return { path, content, mtime: stat.mtime };
  }

  uri(path: string): PlatformUri {
    return toPlatformUri(vscode.Uri.file(path));
  }

  joinPath(base: PlatformUri, ...segments: string[]): PlatformUri {
    const vscUri = vscode.Uri.file(base.fsPath);
    const newUri = vscode.Uri.joinPath(vscUri, ...segments);
    return toPlatformUri(newUri);
  }

  basename(path: string): string {
    const parts = path.split("/");
    return parts[parts.length - 1];
  }

  dirname(path: string): string {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  }

  relativePath(from: string, to: string): string {
    const fromUri = vscode.Uri.file(from);
    const toUri = vscode.Uri.file(to);
    return vscode.workspace.asRelativePath(toUri, false) ?? to;
  }

  isAbsolutePath(path: string): boolean {
    return path.startsWith("/") || /^[A-Za-z]:\\/.test(path);
  }

  getConfiguration(section: string): ConfigValue {
    const config = vscode.workspace.getConfiguration(section);
    return {
      get: <T>(key: string, defaultValue?: T) => config.get(key, defaultValue),
    };
  }

  get workspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  resolvePath(base: string, relative: string): string {
    if (this.isAbsolutePath(relative)) return relative;
    const path = require("node:path");
    return path.resolve(base, relative);
  }
}

// ---------------------------------------------------------------------------
// VSCode Editor API
// ---------------------------------------------------------------------------

class VscodeEditorAPI implements EditorAPI {
  async openDocument(uri: PlatformUri): Promise<PlatformUri> {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(uri.fsPath)
    );
    return toPlatformUri(doc.uri);
  }

  async getDocumentContent(uri: PlatformUri): Promise<string> {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(uri.fsPath)
    );
    return doc.getText();
  }

  get activeEditor(): ActiveEditor | undefined {
    // When the webview panel has focus, activeTextEditor is undefined.
    // Fall back to the first visible text editor so that selection
    // attachment still works while the chat panel is focused.
    const editor =
      vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
    if (!editor) return undefined;
    return {
      documentUri: toPlatformUri(editor.document.uri),
      filePath: editor.document.fileName,
      languageId: editor.document.languageId,
      selection: {
        startLine: editor.selection.start.line + 1,
        startCharacter: editor.selection.start.character,
        endLine: editor.selection.end.line + 1,
        endCharacter: editor.selection.end.character,
        isEmpty: editor.selection.isEmpty,
      },
      visibleRanges: editor.visibleRanges.map((r) => ({
        start: r.start.line + 1,
        end: r.end.line + 1,
      })),
    };
  }

  get visibleEditors(): ActiveEditor[] {
    return vscode.window.visibleTextEditors.map((editor) => ({
      documentUri: toPlatformUri(editor.document.uri),
      filePath: editor.document.fileName,
      languageId: editor.document.languageId,
      selection: {
        startLine: editor.selection.start.line + 1,
        startCharacter: editor.selection.start.character,
        endLine: editor.selection.end.line + 1,
        endCharacter: editor.selection.end.character,
        isEmpty: editor.selection.isEmpty,
      },
      visibleRanges: editor.visibleRanges.map((r) => ({
        start: r.start.line + 1,
        end: r.end.line + 1,
      })),
    }));
  }

  async getSymbols(uri: PlatformUri): Promise<SymbolInfo[]> {
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >("vscode.executeDocumentSymbolProvider", vscode.Uri.file(uri.fsPath));
    if (!symbols) return [];
    return this.flattenSymbols(symbols, uri.fsPath);
  }

  private flattenSymbols(
    symbols: vscode.DocumentSymbol[],
    filePath: string
  ): SymbolInfo[] {
    const result: SymbolInfo[] = [];
    for (const sym of symbols) {
      result.push({
        name: sym.name,
        kind: vscode.SymbolKind[sym.kind]?.toLowerCase() ?? "unknown",
        filePath,
        startLine: sym.range.start.line + 1,
        endLine: sym.range.end.line + 1,
        containerName: (sym as any).containerName || undefined,
      });
      if (sym.children) {
        result.push(...this.flattenSymbols(sym.children, filePath));
      }
    }
    return result;
  }

  async findSymbolDefinition(
    uri: PlatformUri,
    line: number,
    character: number
  ): Promise<DefinitionLocation | undefined> {
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      vscode.Uri.file(uri.fsPath),
      new vscode.Position(line - 1, character)
    );
    if (!locations || locations.length === 0) return undefined;
    return {
      uri: toPlatformUri(locations[0].uri),
      startLine: locations[0].range.start.line + 1,
      endLine: locations[0].range.end.line + 1,
    };
  }

  async searchSymbols(query: string): Promise<SymbolInfo[]> {
    const symbols = await vscode.commands.executeCommand<
      vscode.SymbolInformation[]
    >("vscode.executeWorkspaceSymbolProvider", query);
    if (!symbols) return [];
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    return symbols.map((sym) => ({
      name: sym.name,
      kind: vscode.SymbolKind[sym.kind]?.toLowerCase() ?? "unknown",
      filePath: vscode.workspace.asRelativePath(sym.location.uri, false),
      startLine: sym.location.range.start.line + 1,
      endLine: sym.location.range.end.line + 1,
      containerName: sym.containerName || undefined,
    }));
  }

  async openFile(path: string, line?: number): Promise<void> {
    const uri = vscode.Uri.file(path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const options: vscode.TextDocumentShowOptions = {};
    if (line !== undefined) {
      options.selection = new vscode.Range(line - 1, 0, line - 1, 0);
    }
    await vscode.window.showTextDocument(doc, options);
  }

  computeDiff(
    oldContent: string,
    newContent: string,
    path: string
  ): DiffResult {
    // Compute a simple line-based diff without using the diff package
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const hunks: DiffResult["hunks"] = [];
    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (
        i < oldLines.length &&
        j < newLines.length &&
        oldLines[i] === newLines[j]
      ) {
        i++;
        j++;
        continue;
      }
      const oldStart = i + 1;
      const newStart = j + 1;
      const hunkLines: string[] = [];
      while (
        i < oldLines.length &&
        (j >= newLines.length || oldLines[i] !== newLines[j])
      ) {
        hunkLines.push(`-${oldLines[i]}`);
        i++;
      }
      while (
        j < newLines.length &&
        (i >= oldLines.length || oldLines[i] !== newLines[j])
      ) {
        hunkLines.push(`+${newLines[j]}`);
        j++;
      }
      hunks.push({
        oldStart,
        oldLines: i - (oldStart - 1),
        newStart,
        newLines: j - (newStart - 1),
        lines: hunkLines,
      });
    }
    return { path, oldContent, newContent, hunks };
  }

  async showDiff(
    diff: DiffResult,
    options?: {
      title?: string;
      preserveFocus?: boolean;
      preview?: boolean;
    }
  ): Promise<void> {
    const uri = vscode.Uri.parse(`acp-diff:${diff.path}`);
    const provider = {
      provideTextDocumentContent: () => diff.oldContent,
    };
    const disposable = vscode.workspace.registerTextDocumentContentProvider(
      "acp-diff",
      provider
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preserveFocus: options?.preserveFocus,
      preview: options?.preview,
      viewColumn: vscode.ViewColumn.Two,
    });
    disposable.dispose();
  }

  registerDocumentProvider(
    scheme: string,
    provider: { provideContent(path: string): string | undefined }
  ): Disposable {
    const disposable = vscode.workspace.registerTextDocumentContentProvider(
      scheme,
      {
        provideTextDocumentContent: (uri: vscode.Uri) =>
          provider.provideContent(uri.path),
      }
    );
    return { dispose: () => disposable.dispose() };
  }

  async getGitDiff(): Promise<string | undefined> {
    const gitExtension = vscode.extensions.getExtension<{
      getAPI(version: number): GitAPI;
    }>("vscode.git");
    if (!gitExtension) return undefined;
    const git = gitExtension.exports.getAPI(1);
    if (git.repositories.length === 0) return undefined;
    const repo = git.repositories[0];
    const diffs: string[] = [];
    const staged = await repo.diff(true);
    if (staged) diffs.push(staged);
    const unstaged = await repo.diff(false);
    if (unstaged) diffs.push(unstaged);
    return diffs.length > 0 ? diffs.join("\n") : undefined;
  }
}

// ---------------------------------------------------------------------------
// VSCode ExtensionContext API
// ---------------------------------------------------------------------------

class VscodeContextAPI implements ExtensionContextAPI {
  constructor(private ctx: vscode.ExtensionContext) {}

  get globalState(): Memento {
    return {
      get: <T>(key: string, defaultValue?: T) =>
        this.ctx.globalState.get(key, defaultValue) as T | undefined,
      update: (key: string, value: unknown) =>
        Promise.resolve(this.ctx.globalState.update(key, value)),
      keys: () => this.ctx.globalState.keys().slice(),
      setKeysForSync: (keys: string[]) =>
        this.ctx.globalState.setKeysForSync(keys),
    };
  }

  get workspaceState(): Memento {
    return {
      get: <T>(key: string, defaultValue?: T) =>
        this.ctx.workspaceState.get(key, defaultValue) as T | undefined,
      update: (key: string, value: unknown) =>
        Promise.resolve(this.ctx.workspaceState.update(key, value)),
      keys: () => this.ctx.workspaceState.keys().slice(),
      setKeysForSync: () => {}, // workspaceState does not support sync keys
    };
  }

  get storageUri(): string | undefined {
    return this.ctx.globalStorageUri.fsPath;
  }

  get extensionUri(): PlatformUri {
    return toPlatformUri(this.ctx.extensionUri);
  }

  addSubscription(disposable: Disposable): void {
    this.ctx.subscriptions.push(disposable);
  }
}

// ---------------------------------------------------------------------------
// VSCode Terminal API
// ---------------------------------------------------------------------------

class VscodeTerminalAPI implements TerminalAPI {
  createTerminal(options: {
    name?: string;
    cwd?: string;
    command?: string;
    args?: string[];
  }): Terminal {
    const vscodeTerminal = vscode.window.createTerminal({
      name: options.name,
      cwd: options.cwd,
    });
    return {
      id: options.name ?? "",
      show: () => vscodeTerminal.show(),
      sendText: (text: string) => vscodeTerminal.sendText(text),
      getOutput: async () => "", // VSCode API does not support direct terminal output retrieval
      waitForExit: async () => 0, // Not supported
      kill: () => vscodeTerminal.dispose(),
      dispose: () => vscodeTerminal.dispose(),
    };
  }
}

// ---------------------------------------------------------------------------
// VSCode OrchestrationState API
// ---------------------------------------------------------------------------

class VscodeOrchestrationStateAPI implements OrchestrationStateAPI {
  private context: vscode.ExtensionContext;
  private storagePrefix = "orchestration.";

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async saveState(
    snapshot: OrchestrationStateSnapshot,
    options?: { replace?: boolean }
  ): Promise<void> {
    const key = `${this.storagePrefix}${snapshot.sessionId}`;
    if (options?.replace) {
      await this.context.globalState.update(key, snapshot);
    } else {
      const existing = await this.loadState(snapshot.sessionId);
      const merged: OrchestrationStateSnapshot = existing
        ? { ...snapshot, entries: [...existing.entries, ...snapshot.entries] }
        : snapshot;
      await this.context.globalState.update(key, merged);
    }
  }

  async loadState(
    sessionId: string
  ): Promise<OrchestrationStateSnapshot | undefined> {
    const key = `${this.storagePrefix}${sessionId}`;
    return this.context.globalState.get<OrchestrationStateSnapshot>(key);
  }

  async removeState(sessionId: string): Promise<void> {
    const key = `${this.storagePrefix}${sessionId}`;
    await this.context.globalState.update(key, undefined);
  }

  async listPersistedSessions(): Promise<string[]> {
    return this.context.globalState
      .keys()
      .filter((k) => k.startsWith(this.storagePrefix))
      .map((k) => k.slice(this.storagePrefix.length));
  }

  async appendEventLogEntry(sessionId: string, entry: unknown): Promise<void> {
    const logKey = `${this.storagePrefix}log.${sessionId}`;
    const existing = this.context.globalState.get<unknown[]>(logKey, []);
    existing.push(entry);
    await this.context.globalState.update(logKey, existing);
  }

  async readEventLog(
    sessionId: string,
    options?: { maxLines?: number }
  ): Promise<unknown[]> {
    const logKey = `${this.storagePrefix}log.${sessionId}`;
    const entries = this.context.globalState.get<unknown[]>(logKey, []);
    const max = options?.maxLines ?? entries.length;
    return entries.slice(-max);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toPlatformUri(uri: vscode.Uri): PlatformUri {
  const base = {
    scheme: uri.scheme,
    fsPath: uri.fsPath,
    path: uri.path,
    with: (change: { scheme?: string; path?: string }) => {
      const newUri = uri.with(change);
      return toPlatformUri(newUri);
    },
  };
  return {
    ...base,
    toString() {
      return uri.toString();
    },
  };
}

interface GitAPI {
  repositories: Array<{
    diff(cached: boolean): Promise<string>;
  }>;
}
