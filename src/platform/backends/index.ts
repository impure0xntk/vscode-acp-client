// src/platform/backends/index.ts
//
// Barrel export for log abstraction layer.
// Provides getLogger() helper for application code.

export { LogLevel } from "./types";
export type { LogLevelName, LogLevelValue } from "./types";
export type { LogRecord } from "./types";
export type { Logger } from "./types";
export type { LoggerBackend } from "./types";
export type { LoggerFactory } from "./types";

export { LoggerImpl } from "./logger-impl";
export { LoggerFactoryImpl } from "./logger-impl";
export { VsCodeOutputBackend } from "./vscode-output-backend";
export { PinoBridgeBackend } from "./pino-bridge-backend";
export { ConsoleLoggerBackend } from "./console-backend";
export { FilterLoggerBackend } from "./filter-backend";

import { ConsoleLoggerBackend } from "./console-backend";
import { LoggerFactoryImpl } from "./logger-impl";
import type { Logger, LoggerBackend, LoggerFactory, LogLevelValue } from "./types";

// ── Module-level singleton ────────────────────────────────────────────────
// Initialized by platform adapter (VscodePlatform).
// Falls back to console backend so getLogger() works before platform init.

let factory: LoggerFactory = new LoggerFactoryImpl(
  new ConsoleLoggerBackend(2 /* info */)
);

/** Replace the global logger factory (called from VscodePlatform constructor). */
export function initLoggerFactory(f: LoggerFactory): void {
  factory = f;
}

/** Get a logger for the given category. */
export function getLogger(category: string): Logger {
  return factory.getLogger(category);
}

/** Change minimum level for all loggers. */
export function setLogLevel(level: LogLevelValue): void {
  factory.setLevel(level);
}

/** Swap the backend at runtime. */
export function setLoggerBackend(backend: LoggerBackend): void {
  factory.setBackend(backend);
}

/** Access the raw factory (for advanced use). */
export function getLoggerFactory(): LoggerFactory {
  return factory;
}
