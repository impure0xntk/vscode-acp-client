// src/platform/filesystem.ts

import type { ConfigValue, Disposable, FileSnapshot, FileStat, FileWatchEvent, PlatformUri } from './types';

/** ファイル候補 */
export interface FileCandidate {
  relativePath: string;
  absolutePath: string;
  name: string;
}

/** ファイルシステム API インターフェース */
export interface FileSystemAPI {
  // ── 読み書き ──
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;

  // ── 検索 ──
  findFiles(
    pattern: string,
    exclude?: string,
    maxResults?: number
  ): Promise<PlatformUri[]>;

  // ── 監視 ──
  watchFiles(
    pattern: string,
    callback: (event: FileWatchEvent) => void
  ): () => void;

  // ── スナップショット ──
  captureSnapshot(path: string): Promise<FileSnapshot>;

  // ── URI 操作 ──
  uri(path: string): PlatformUri;
  joinPath(base: PlatformUri, ...segments: string[]): PlatformUri;
  basename(path: string): string;
  dirname(path: string): string;
  relativePath(from: string, to: string): string;
  isAbsolutePath(path: string): boolean;

  // ── 設定 ──
  getConfiguration(section: string): ConfigValue;

  // ── ワークスペース ──
  get workspaceRoots(): string[];
  get workspaceRoot(): string | undefined;

  // ── パス解決 ──
  resolvePath(base: string, relative: string): string;
}
