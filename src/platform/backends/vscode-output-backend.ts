// src/platform/backends/vscode-output-backend.ts
//
// Log backend that writes to a VSCode OutputChannel.
// Receives the OutputChannel from extension.ts and aggregates all logger output.

import type { LogRecord, LoggerBackend, LogLevelValue } from './types';

const levelLabel: Record<LogLevelValue, string> = {
  0: 'TRACE',
  1: 'DEBUG',
  2: 'INFO ',
  3: 'WARN ',
  4: 'ERROR',
  5: 'SILENT',
};

type OutputChannel = {
  appendLine(value: string): void;
  show(): void;
  dispose(): void;
};

/**
 * VSCode OutputChannel-based log backend.
 * Format: [LEVEL] [timestamp] [category] message  key=value ...
 */
export class VsCodeOutputBackend implements LoggerBackend {
  minLevel: LogLevelValue;
  private channel: OutputChannel;

  constructor(channel: OutputChannel, minLevel: LogLevelValue = 2) {
    this.channel = channel;
    this.minLevel = minLevel;
  }

  emit(record: LogRecord): void {
    if (record.level < this.minLevel) return;

    const ts = new Date(record.timestamp).toISOString();
    const label = levelLabel[record.level] ?? '?????';
    const parts = [`[${label}]`, `[${ts}]`, `[${record.category}]`, record.message];

    if (record.context) {
      for (const [k, v] of Object.entries(record.context)) {
        parts.push(`  ${k}=${JSON.stringify(v)}`);
      }
    }

    this.channel.appendLine(parts.join(' '));

    if (record.error?.stack) {
      this.channel.appendLine(`  ${record.error.stack}`);
    }
  }
}
