// src/platform/backends/pino-bridge-backend.ts
//
// Bridge backend to a Pino logger.
// Outputs structured JSON logs in Node.js / Electron environments.

import type { LogRecord, LoggerBackend, LogLevelValue } from "./types";

type PinoLogger = {
  trace(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

/**
 * Bridge to a Pino logger.
 * Converts LogRecord to Pino's structured log format.
 */
export class PinoBridgeBackend implements LoggerBackend {
  minLevel: LogLevelValue;
  private pino: PinoLogger;

  constructor(pino: PinoLogger, minLevel: LogLevelValue = 2) {
    this.pino = pino;
    this.minLevel = minLevel;
  }

  emit(record: LogRecord): void {
    if (record.level < this.minLevel) return;

    const obj: Record<string, unknown> = {
      category: record.category,
      timestamp: record.timestamp,
      ...record.context,
    };

    if (record.error) {
      obj.err = {
        message: record.error.message,
        stack: record.error.stack,
        name: record.error.name,
      };
    }

    switch (record.level) {
      case 0:
        this.pino.trace(obj, record.message);
        break;
      case 1:
        this.pino.debug(obj, record.message);
        break;
      case 2:
        this.pino.info(obj, record.message);
        break;
      case 3:
        this.pino.warn(obj, record.message);
        break;
      case 4:
        this.pino.error(obj, record.message);
        break;
    }
  }
}
