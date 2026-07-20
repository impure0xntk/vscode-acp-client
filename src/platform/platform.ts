// src/platform/platform.ts

import type { Disposable, EventEmitter, Event } from "./types";
import type { DiagnosticBackend } from "./diagnostics";
import type { EditorAPI } from "./editor";
import type { ExtensionContextAPI } from "./context";
import type { FileSystemAPI } from "./filesystem";
import type { LogStorageAPI } from "./logStorage";
import type { OrchestrationStateAPI } from "./orchestration";
import type { TerminalAPI } from "./terminal";
import type { UIAPI } from "./ui";

export interface PlatformAPI {
  readonly ui: UIAPI;
  readonly fs: FileSystemAPI;
  readonly editor: EditorAPI;
  readonly context: ExtensionContextAPI;
  readonly terminal: TerminalAPI;
  readonly orchestration: OrchestrationStateAPI;
  readonly diagnostics: DiagnosticBackend;
  logStorage: LogStorageAPI;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  readonly platform: "vscode" | "node" | "electron" | "web";
  readonly version: string;
}

export type { Disposable, EventEmitter, Event };
