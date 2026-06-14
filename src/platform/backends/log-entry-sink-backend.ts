// src/platform/backends/log-entry-sink-backend.ts
//
// Decorator backend that forwards log records to a LogEntrySink
// in addition to the wrapped backend's normal output.
// Used to persist logs to SQLite without modifying the core logger pipeline.

import type { LogRecord, LoggerBackend, LogLevelValue } from "./types";

export interface LogEntrySink {
  emit(record: LogRecord): void;
}

/**
 * Decorator that tees log records to a LogEntrySink.
 * The sink write is fire-and-forget — errors are silently swallowed
 * to avoid disrupting the logging pipeline.
 */
export class LogEntrySinkBackend implements LoggerBackend {
  minLevel: LogLevelValue;
  private inner: LoggerBackend;
  private sink: LogEntrySink | null = null;

  constructor(inner: LoggerBackend) {
    this.inner = inner;
    this.minLevel = inner.minLevel;
  }

  setSink(sink: LogEntrySink): void {
    this.sink = sink;
  }

  emit(record: LogRecord): void {
    // Always forward to sink (sink decides its own filtering)
    try {
      this.sink?.emit(record);
    } catch {
      // sink must not disrupt logging
    }

    // Delegate to inner backend (handles minLevel filtering)
    this.inner.emit(record);
  }

  async flush(): Promise<void> {
    await this.inner.flush?.();
  }

  dispose(): void {
    this.inner.dispose?.();
  }
}
