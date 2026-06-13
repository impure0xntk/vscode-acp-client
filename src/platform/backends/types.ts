// src/platform/backends/types.ts
//
// Core type definitions for log abstraction.
// Shared across all platforms (VSCode / Node.js / Electron).

// ── Log level ──────────────────────────────────────────────────────────────

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

// ── Log record ────────────────────────────────────────────────────────────
// Immutable data structure produced by a single log emit.
// Backends receive this record and decide formatting / output destination.

export interface LogRecord {
  /** Log level */
  readonly level: LogLevelValue;
  /** Logger category (typically module name, e.g. "orchestrator", "session") */
  readonly category: string;
  /** Log message (may be a template; combined with context for formatting) */
  readonly message: string;
  /** Timestamp at creation (epoch ms) */
  readonly timestamp: number;
  /** Structured context. Used for template substitution and filtering. */
  readonly context?: Record<string, unknown>;
  /** Associated error, if any */
  readonly error?: Error;
}

// ── Logger interface ────────────────────────────────────────────────
// Logger called from application code.
// Thin facade that internally calls LoggerBackend.emit().

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

// ── LoggerBackend interface ─────────────────────────────────────────
// Abstracts the actual log output destination. Each platform provides its own implementation.
// Pipeline: Logger → LoggerBackend.emit() → destination / OutputChannel / file etc.

export interface LoggerBackend {
  /** Minimum output level. Records below this are discarded immediately. */
  minLevel: LogLevelValue;

  /** Emit one record. Calls should be non-blocking. */
  emit(record: LogRecord): void;

  /** For backends that need buffer flushing (no-op allowed) */
  flush?(): Promise<void>;

  /** For backends that need resource cleanup (no-op allowed) */
  dispose?(): void;
}

// ── LoggerFactory ──────────────────────────────────────────────────────────
// Top-level factory that creates Logger instances.
// PlatformAPI holds this factory and exposes it to the application layer.

export interface LoggerFactory {
  getLogger(category: string): Logger;
  /** Change minimum level for all loggers at once */
  setLevel(level: LogLevelValue): void;
  /** Swap the backend at runtime */
  setBackend(backend: LoggerBackend): void;
}
