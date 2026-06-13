// src/platform/orchestration.ts

import type { OrchestrationStateSnapshot } from "./context";

/**
 * API for persisting orchestration state.
 * Used by StateManager when saving state via event sourcing.
 */
export interface OrchestrationStateAPI {
  // ── State persistence ──
  saveState(
    snapshot: OrchestrationStateSnapshot,
    options?: { replace?: boolean }
  ): Promise<void>;

  loadState(sessionId: string): Promise<OrchestrationStateSnapshot | undefined>;

  removeState(sessionId: string): Promise<void>;

  listPersistedSessions(): Promise<string[]>;

  // ── Event log output ──
  appendEventLogEntry(sessionId: string, entry: unknown): Promise<void>;

  readEventLog(
    sessionId: string,
    options?: {
      maxLines?: number;
    }
  ): Promise<unknown[]>;
}
