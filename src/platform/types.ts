// src/platform/types.ts

/** 破棄可能なリソース */
export interface Disposable {
  dispose(): void;
}

/** イベント */
export interface Event<T> {
  (listener: (e: T) => void): Disposable;
}

/** イベントエミッタ */
export interface EventEmitter<T> {
  event: Event<T>;
  fire(data: T): void;
  dispose(): void;
}

/** URI 表現 */
export interface PlatformUri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path: string;
  with(change: { scheme?: string; path?: string }): PlatformUri;
  toString(): string;
}

/** ファイル情報 */
export interface FileStat {
  type: 'file' | 'directory';
  mtime: number;
  size: number;
}

/** ファイル変更イベント */
export interface FileWatchEvent {
  path: string;
  type: 'change' | 'add' | 'unlink';
}

/** ファイルスナップショット */
export interface FileSnapshot {
  path: string;
  content: string;
  mtime: number;
}

/** 行範囲 */
export interface LineRange {
  start: number;  // 1-based
  end: number;    // 1-based
}

/** Diff Hunk */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** Diff 結果 */
export interface DiffResult {
  path: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

/** 設定値ラッパー */
export interface ConfigValue {
  get<T>(section: string, defaultValue?: T): T | undefined;
}
