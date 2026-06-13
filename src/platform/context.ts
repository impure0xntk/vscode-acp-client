// src/platform/context.ts

import type { Disposable, PlatformUri } from "./types";

/** Memento (key-value store) */
export interface Memento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): string[];
  setKeysForSync(keys: string[]): void;
}

/**
 * Orchestration state snapshot.
 * Root object produced when serializing StateManager's state.
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

/** Extension Context API interface */
export interface ExtensionContextAPI {
  // ── Storage ──
  get globalState(): Memento;
  get workspaceState(): Memento;
  get storageUri(): string | undefined;
  get extensionUri(): PlatformUri;

  // ── Subscriptions ──
  addSubscription(disposable: Disposable): void;
}
