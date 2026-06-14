// webview-src/lib/logger.ts
//
// Webview-side logging abstraction.
//
// Architecture (mirrors extension-side Logger/LoggerBackend/LoggerFactory):
//
//   Application code
//       │
//       ▼
//   Logger ──► LoggerBackend.emit(record)
//                  │
//                  ├─ PostMessageBackend  → extension host (OutputChannel)
//                  ├─ ConsoleBackend      → browser DevTools console
//                  └─ CompositeBackend    → both
//
// Usage:
//   import { logger } from "../lib/logger";
//   logger.info("session created", { sessionId, agentId });
//
//   // In React components, prefer the useLogger hook:
//   import { useLogger } from "../hooks/useLogger";
//   const log = useLogger("ChatContainer");

import { getVsCodeApi } from "./vscodeApi";

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

// ── Log record ──────────────────────────────────────────────────────────────

export interface LogRecord {
  readonly level: LogLevelValue;
  readonly category: string;
  readonly message: string;
  readonly timestamp: number;
  readonly context?: Record<string, unknown>;
}

// ── LoggerBackend ───────────────────────────────────────────────────────────

export interface LoggerBackend {
  minLevel: LogLevelValue;
  emit(record: LogRecord): void;
}

// ── Backends ────────────────────────────────────────────────────────────────

const DEV =
  (typeof __DEV__ !== "undefined" && __DEV__) ||
  (typeof process !== "undefined" && process.env?.NODE_ENV === "development");

/**
 * PostMessageBackend — sends log records to the extension host via postMessage.
 * The extension host receives them in ChatPanel.handleWebviewLog().
 */
export class PostMessageBackend implements LoggerBackend {
  minLevel: LogLevelValue;

  constructor(minLevel: LogLevelValue = LogLevel.trace) {
    this.minLevel = minLevel;
  }

  emit(record: LogRecord): void {
    if (record.level < this.minLevel) return;
    try {
      getVsCodeApi().postMessage({
        type: "log",
        payload: {
          level: LogLevel[record.level] as LogLevelName,
          category: record.category,
          message: record.message,
          context: record.context,
          timestamp: record.timestamp,
        },
      });
    } catch {
      // acquireVsCodeApi() can only be called once; ignore if unavailable
    }
  }
}

/**
 * ConsoleBackend — outputs to browser DevTools console.
 * In DEV mode all levels are shown; in production only warn/error.
 */
export class ConsoleBackend implements LoggerBackend {
  minLevel: LogLevelValue;

  constructor(minLevel: LogLevelValue = DEV ? LogLevel.trace : LogLevel.warn) {
    this.minLevel = minLevel;
  }

  emit(record: LogRecord): void {
    if (record.level < this.minLevel) return;

    const prefix = `[${record.category}]`;
    const args = record.context
      ? [prefix, record.message, record.context]
      : [prefix, record.message];

    switch (record.level) {
      case LogLevel.trace:
      case LogLevel.debug:
        console.debug(...args);
        break;
      case LogLevel.info:
        console.info(...args);
        break;
      case LogLevel.warn:
        console.warn(...args);
        break;
      case LogLevel.error:
        console.error(...args);
        break;
    }
  }
}

/**
 * CompositeBackend — fans out to multiple backends.
 */
export class CompositeBackend implements LoggerBackend {
  minLevel: LogLevelValue;
  private backends: LoggerBackend[];

  constructor(...backends: LoggerBackend[]) {
    this.backends = backends;
    this.minLevel = Math.min(...backends.map((b) => b.minLevel));
  }

  emit(record: LogRecord): void {
    for (const b of this.backends) {
      b.emit(record);
    }
  }

  setMinLevel(level: LogLevelValue): void {
    this.minLevel = level;
    for (const b of this.backends) {
      b.minLevel = level;
    }
  }
}

// ── Logger interface ────────────────────────────────────────────────────────

export interface Logger {
  readonly category: string;
  minLevel: LogLevelValue;

  trace(msg: string, context?: Record<string, unknown>): void;
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  child(suffix: string): Logger;
}

// ── LoggerImpl ──────────────────────────────────────────────────────────────

class LoggerImpl implements Logger {
  readonly category: string;
  minLevel: LogLevelValue;
  private backend: LoggerBackend;

  constructor(category: string, backend: LoggerBackend) {
    this.category = category;
    this.minLevel = backend.minLevel;
    this.backend = backend;
  }

  trace(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.trace, msg, context);
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.debug, msg, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.info, msg, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.warn, msg, context);
  }

  error(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.error, msg, context);
  }

  child(suffix: string): Logger {
    return new LoggerImpl(`${this.category}.${suffix}`, this.backend);
  }

  private emit(
    level: LogLevelValue,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (level < this.minLevel) return;
    const record: LogRecord = {
      level,
      category: this.category,
      message,
      timestamp: Date.now(),
      context,
    };
    this.backend.emit(record);
  }
}

// ── LoggerFactory ───────────────────────────────────────────────────────────

export interface LoggerFactory {
  getLogger(category: string): Logger;
  setLevel(level: LogLevelValue): void;
  setBackend(backend: LoggerBackend): void;
}

class LoggerFactoryImpl implements LoggerFactory {
  private backend: LoggerBackend;
  private cache: Map<string, Logger> = new Map();

  constructor(backend: LoggerBackend) {
    this.backend = backend;
  }

  getLogger(category: string): Logger {
    const cached = this.cache.get(category);
    if (cached) return cached;
    const logger = new LoggerImpl(category, this.backend);
    this.cache.set(category, logger);
    return logger;
  }

  setLevel(level: LogLevelValue): void {
    this.backend.minLevel = level;
    for (const logger of this.cache.values()) {
      logger.minLevel = level;
    }
  }

  setBackend(backend: LoggerBackend): void {
    this.backend = backend;
    for (const [category] of this.cache) {
      this.cache.set(category, new LoggerImpl(category, backend));
    }
  }
}

// ── Module-level singleton ──────────────────────────────────────────────────

// Default: PostMessage + Console in DEV, PostMessage only in production.
const defaultBackend: LoggerBackend = DEV
  ? new CompositeBackend(new PostMessageBackend(), new ConsoleBackend())
  : new PostMessageBackend();

const factory: LoggerFactory = new LoggerFactoryImpl(defaultBackend);

// ── Public API ──────────────────────────────────────────────────────────────

export const logger: Logger = factory.getLogger("webview");

export function getLogger(category: string): Logger {
  return factory.getLogger(category);
}

export function setLogLevel(level: LogLevelValue): void {
  factory.setLevel(level);
}

export function setLoggerBackend(backend: LoggerBackend): void {
  factory.setBackend(backend);
}
