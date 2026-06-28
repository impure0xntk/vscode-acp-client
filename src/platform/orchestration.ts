// src/platform/orchestration.ts

import type { OrchestrationStateSnapshot } from "./context";

export interface OrchestrationStateAPI {
  saveState(
    snapshot: OrchestrationStateSnapshot,
    options?: { replace?: boolean }
  ): Promise<void>;
  loadState(sessionId: string): Promise<OrchestrationStateSnapshot | undefined>;
  removeState(sessionId: string): Promise<void>;
  listPersistedSessions(): Promise<string[]>;
  appendEventLogEntry(sessionId: string, entry: unknown): Promise<void>;
  readEventLog(
    sessionId: string,
    options?: { maxLines?: number }
  ): Promise<unknown[]>;
}
