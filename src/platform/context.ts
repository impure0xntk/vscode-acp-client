// src/platform/context.ts

import type { Disposable, PlatformUri } from "./types";

export interface Memento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): string[];
  setKeysForSync(keys: string[]): void;
}

export interface OrchestrationStateSnapshot {
  version: 1;
  sessionId: string;
  entries: OrchestrationStateEntry[];
}

export interface OrchestrationStateEntry {
  key: string;
  value: unknown;
}

export interface ExtensionContextAPI {
  get globalState(): Memento;
  get workspaceState(): Memento;
  get storageUri(): string | undefined;
  get extensionUri(): PlatformUri;
  addSubscription(disposable: Disposable): void;
}
