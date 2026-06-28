import type { LogRecord } from "../../platform/backends/types";
import type { PersistentHistoryStore } from "../../application/session/persistentHistory";

/**
 * Sink that persists log records to a PersistentHistoryStore.
 * Non-blocking: writes are fire-and-forget (persisted via the store's own debounce).
 */
export class LogEntrySinkImpl {
  private store: PersistentHistoryStore | null = null;

  setStore(store: PersistentHistoryStore): void {
    this.store = store;
  }

  /**
   * Emit a log record to the sink.
   * Extracts session/agent context from the record's context field.
   */
  emit(record: LogRecord): void {
    if (!this.store) return;

    const ctx = record.context ?? {};
    const sessionId = typeof ctx.sessionId === "string" ? ctx.sessionId : null;
    const agentId = typeof ctx.agentId === "string" ? ctx.agentId : null;
    const traceId = typeof ctx.traceId === "string" ? ctx.traceId : null;

    const { sessionId: _s, agentId: _a, traceId: _t, ...rest } = ctx;
    const contextJson =
      Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;

    this.store.saveLogEntry({
      source: "extension",
      traceId,
      sessionId,
      agentId,
      category: record.category,
      level: record.level,
      message: record.message,
      contextJson,
      timestamp: record.timestamp,
    });
  }
}
