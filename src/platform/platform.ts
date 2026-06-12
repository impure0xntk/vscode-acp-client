// src/platform/platform.ts

import type { Disposable, EventEmitter, Event } from './types';
import type { EditorAPI } from './editor';
import type { ExtensionContextAPI } from './context';
import type { FileSystemAPI } from './filesystem';
import type { OrchestrationStateAPI } from './orchestration';
import type { TerminalAPI } from './terminal';
import type { UIAPI } from './ui';

/** 統合 Platform API */
export interface PlatformAPI {
  readonly ui: UIAPI;
  readonly fs: FileSystemAPI;
  readonly editor: EditorAPI;
  readonly context: ExtensionContextAPI;
  readonly terminal: TerminalAPI;
  readonly orchestration: OrchestrationStateAPI;

  // ── ライフサイクル ──
  initialize(): Promise<void>;
  dispose(): Promise<void>;

  // ── プラットフォーム情報 ──
  readonly platform: 'vscode' | 'node' | 'electron' | 'web';
  readonly version: string;
}

export type { Disposable, EventEmitter, Event };
