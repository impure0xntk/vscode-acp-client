// src/platform/types.ts

/** Disposable resource */
export interface Disposable {
  dispose(): void;
}

/** Event */
export interface Event<T> {
  (listener: (e: T) => void): Disposable;
}

/** Event emitter */
export interface EventEmitter<T> {
  event: Event<T>;
  fire(data: T): void;
  dispose(): void;
}

/** URI representation */
export interface PlatformUri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path: string;
  with(change: { scheme?: string; path?: string }): PlatformUri;
  toString(): string;
}

/** File info */
export interface FileStat {
  type: "file" | "directory";
  mtime: number;
  size: number;
}

/** File change event */
export interface FileWatchEvent {
  path: string;
  type: "change" | "add" | "unlink";
}

/** File snapshot */
export interface FileSnapshot {
  path: string;
  content: string;
  mtime: number;
}

/** Line range */
export interface LineRange {
  start: number; // 1-based
  end: number; // 1-based
}

/** Diff Hunk */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** Diff result */
export interface DiffResult {
  path: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

/** Config value wrapper */
export interface ConfigValue {
  get<T>(section: string, defaultValue?: T): T | undefined;
}
