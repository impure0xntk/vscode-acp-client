// src/platform/backends/filter-backend.ts
//
// 既存の LoggerBackend をラップし、カテゴリ単位でログレベルを上書きするデコレータ。
// 特定モジュールだけ trace を有効化する等、デバッグ用途に使用する。
//
// 使用方法:
//   const base = new ConsoleLoggerBackend(LogLevel.info);
//   const filtered = new FilterLoggerBackend(base, {
//     'orchestrator': LogLevel.trace,
//   });

import type { LogRecord, LoggerBackend, LogLevelValue } from './types';

export class FilterLoggerBackend implements LoggerBackend {
  minLevel: LogLevelValue;
  private inner: LoggerBackend;
  private categoryOverrides: Map<string, LogLevelValue>;

  constructor(
    inner: LoggerBackend,
    categoryOverrides: Record<string, LogLevelValue> = {},
  ) {
    this.inner = inner;
    this.minLevel = inner.minLevel;
    this.categoryOverrides = new Map(Object.entries(categoryOverrides));
  }

  setCategoryLevel(category: string, level: LogLevelValue): void {
    this.categoryOverrides.set(category, level);
  }

  emit(record: LogRecord): void {
    const effectiveLevel = this.categoryOverrides.get(record.category) ?? this.minLevel;
    if (record.level < effectiveLevel) return;
    this.inner.emit(record);
  }

  async flush(): Promise<void> {
    await this.inner.flush?.();
  }

  dispose(): void {
    this.inner.dispose?.();
  }
}
