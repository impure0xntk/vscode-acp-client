// src/platform/backends/console-backend.ts
//
// 全プラットフォーム共通の console ベースバックエンド。
// VSCode / Node.js / Electron のいずれでも動作する。

import type { LogRecord, LoggerBackend, LogLevelValue } from './types';

const levelLabel: Record<LogLevelValue, string> = {
  0: 'TRACE',
  1: 'DEBUG',
  2: 'INFO ',
  3: 'WARN ',
  4: 'ERROR',
  5: 'SILENT',
};

/**
 * console ベースのログバックエンド。
 * フォーマット: [LEVEL] [category] message  key=value ...
 *
 * 使用方法:
 *   const backend = new ConsoleLoggerBackend(LogLevel.debug);
 *   const factory = createLoggerFactory(backend);
 */
export class ConsoleLoggerBackend implements LoggerBackend {
  minLevel: LogLevelValue;

  constructor(minLevel: LogLevelValue = 2) { // default: info
    this.minLevel = minLevel;
  }

  emit(record: LogRecord): void {
    if (record.level < this.minLevel) return;

    const ts = new Date(record.timestamp).toISOString();
    const label = levelLabel[record.level] ?? '?????';
    const parts = [`[${label}]`, `[${ts}]`, `[${record.category}]`, record.message];

    // 構造化コンテキストを key=value 形式で付加
    if (record.context) {
      for (const [k, v] of Object.entries(record.context)) {
        parts.push(`  ${k}=${JSON.stringify(v)}`);
      }
    }

    const line = parts.join(' ');

    switch (record.level) {
      case 0: // trace
      case 1: // debug
        console.debug(line);
        break;
      case 2: // info
        console.info(line);
        break;
      case 3: // warn
        console.warn(line);
        break;
      case 4: // error
        if (record.error) {
          console.error(line, record.error);
        } else {
          console.error(line);
        }
        break;
    }
  }
}
