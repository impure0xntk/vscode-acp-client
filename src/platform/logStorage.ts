// src/platform/logStorage.ts

/** Options for clearing persisted log entries. */
export interface ClearLogsOptions {
  /** Delete entries older than this timestamp (epoch ms). */
  olderThan?: number | null;
  /** Filter by agent ID. */
  agentId?: string | null;
  /** Filter by session ID. */
  sessionId?: string | null;
}

/** Result of a clearLogs operation. */
export interface ClearLogsResult {
  deletedCount: number;
}

/** Platform abstraction for persisted log storage operations. */
export interface LogStorageAPI {
  /**
   * Clear persisted log entries matching the given filters.
   * Returns the number of deleted rows.
   */
  clearLogs(options?: ClearLogsOptions): Promise<ClearLogsResult>;

  /**
   * Count persisted log entries matching the given filters.
   */
  countLogs(options?: ClearLogsOptions): Promise<number>;
}
