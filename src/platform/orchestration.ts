// src/platform/orchestration.ts

import type { OrchestrationStateSnapshot } from './context';

/**
 * オーケストレーション状態の永続化を担う API。
 * StateManager がイベントソーシングで状態を保存する際に使用する。
 */
export interface OrchestrationStateAPI {
  // ── 状態の永続化 ──
  saveState(
    snapshot: OrchestrationStateSnapshot,
    options?: { replace?: boolean }
  ): Promise<void>;

  loadState(sessionId: string): Promise<OrchestrationStateSnapshot | undefined>;

  removeState(sessionId: string): Promise<void>;

  listPersistedSessions(): Promise<string[]>;

  // ── イベントログ出力 ──
  appendEventLogEntry(sessionId: string, entry: unknown): Promise<void>;

  readEventLog(sessionId: string, options?: {
    maxLines?: number;
  }): Promise<unknown[]>;
}
