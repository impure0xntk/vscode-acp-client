// src/platform/backends/types.ts
//
// Core type definitions for log abstraction.
// Shared across all platforms (VSCode / Node.js / Electron).

export const LogLevel = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
} as const;

export type LogLevelName = keyof typeof LogLevel;
export type LogLevelValue = (typeof LogLevel)[LogLevelName];

export interface LogRecord {
  readonly level: LogLevelValue;
  readonly category: string;
  readonly message: string;
  readonly timestamp: number;
  readonly context?: Record<string, unknown>;
  readonly error?: Error;
}

export interface Logger {
  readonly category: string;
  minLevel: LogLevelValue;

  trace(msg: string, context?: Record<string, unknown>): void;
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>, error?: Error): void;

  /** Create a child logger that inherits the category name */
  child(suffix: string): Logger;
}

export interface LoggerBackend {
  minLevel: LogLevelValue;

  /** Emit one record. Calls should be non-blocking. */
  emit(record: LogRecord): void;

  flush?(): Promise<void>;
  dispose?(): void;
}

export interface LoggerFactory {
  getLogger(category: string): Logger;
  setLevel(level: LogLevelValue): void;
  setBackend(backend: LoggerBackend): void;
}
