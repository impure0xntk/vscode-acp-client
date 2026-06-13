// src/platform/index.ts

export type {
  Disposable,
  Event,
  EventEmitter,
  PlatformUri,
  FileStat,
  FileWatchEvent,
  FileSnapshot,
  LineRange,
  DiffHunk,
  DiffResult,
  ConfigValue,
} from "./types";
export type {
  UIAPI,
  MessageSeverity,
  QuickPickItem,
  QuickPickButton,
  InputBoxOptions,
  OpenDialogOptions,
  StatusBarItem,
  OutputChannel,
  TreeItem,
  TreeDataProvider,
  WebviewPanel,
  Webview,
} from "./ui";
export type { FileSystemAPI, FileCandidate } from "./filesystem";
export type {
  EditorAPI,
  SymbolInfo,
  DefinitionLocation,
  Selection,
  ActiveEditor,
} from "./editor";
export type {
  ExtensionContextAPI,
  Memento,
  OrchestrationStateSnapshot,
  OrchestrationStateEntry,
} from "./context";
export type { TerminalAPI, Terminal } from "./terminal";
export type { OrchestrationStateAPI } from "./orchestration";
export type { PlatformAPI } from "./platform";
export { createPlatform } from "./factory";
