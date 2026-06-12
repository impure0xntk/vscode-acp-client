// src/platform/context.ts

import type { Disposable, PlatformUri } from './types';

/** メモリ（キー・バリューストア） */
export interface Memento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): string[];
  setKeysForSync(keys: string[]): void;
}

/**
 * オーケストレーション状態のスナップショット。
 * StateManager の state をシリアライズした際のルートオブジェクト。
 */
export interface OrchestrationStateSnapshot {
  version: 1;
  sessionId: string;
  entries: OrchestrationStateEntry[];
}

export interface OrchestrationStateEntry {
  key: string;
  value: unknown;
}

/** Extension Context API インターフェース */
export interface ExtensionContextAPI {
  // ── ストレージ ──
  get globalState(): Memento;
  get workspaceState(): Memento;
  get storageUri(): string | undefined;
  get extensionUri(): PlatformUri;

  // ── サブスクリプション ──
  addSubscription(disposable: Disposable): void;
}
