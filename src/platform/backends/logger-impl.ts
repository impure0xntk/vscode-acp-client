// src/platform/backends/logger-impl.ts
//
// Concrete implementations of Logger and LoggerFactory.
// Backend injection allows the same interface to be used across all platforms.

import type {
  LogRecord,
  Logger,
  LoggerBackend,
  LoggerFactory,
  LogLevelValue,
} from "./types";

export class LoggerImpl implements Logger {
  readonly category: string;
  minLevel: LogLevelValue; // mutable to support batch level changes via setLevel

  private backend: LoggerBackend;

  constructor(category: string, backend: LoggerBackend) {
    this.category = category;
    this.minLevel = backend.minLevel;
    this.backend = backend;
  }

  trace(msg: string, context?: Record<string, unknown>): void {
    this.emit(0, msg, context);
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.emit(1, msg, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.emit(2, msg, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.emit(3, msg, context);
  }

  error(msg: string, context?: Record<string, unknown>, error?: Error): void {
    this.emit(4, msg, context, error);
  }

  child(suffix: string): Logger {
    return new LoggerImpl(`${this.category}.${suffix}`, this.backend);
  }

  private emit(
    level: LogLevelValue,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (level < this.minLevel) return;
    const record: LogRecord = {
      level,
      category: this.category,
      message,
      timestamp: Date.now(),
      context,
      error,
    };
    this.backend.emit(record);
  }
}

export class LoggerFactoryImpl implements LoggerFactory {
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
