// src/platform/filesystem.ts

import type {
  ConfigValue,
  Disposable,
  FileSnapshot,
  FileStat,
  FileWatchEvent,
  PlatformUri,
} from "./types";

/** File candidate */
export interface FileCandidate {
  relativePath: string;
  absolutePath: string;
  name: string;
}

/** File system API interface */
export interface FileSystemAPI {
  // ── Read/Write ──
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;

  // ── Search ──
  findFiles(
    pattern: string,
    exclude?: string,
    maxResults?: number
  ): Promise<PlatformUri[]>;

  /**
   * Find files in an absolute directory using a glob pattern.
   * Unlike findFiles (which searches the workspace), this method
   * can search any directory, including those outside the workspace.
   */
  findFilesInDirectory?(
    cwd: string,
    pattern: string,
    exclude?: string,
    maxResults?: number
  ): Promise<PlatformUri[]>;

  // ── Watch ──
  watchFiles(
    pattern: string,
    callback: (event: FileWatchEvent) => void
  ): () => void;

  // ── Snapshot ──
  captureSnapshot(path: string): Promise<FileSnapshot>;

  // ── URI operations ──
  uri(path: string): PlatformUri;
  joinPath(base: PlatformUri, ...segments: string[]): PlatformUri;
  basename(path: string): string;
  dirname(path: string): string;
  relativePath(from: string, to: string): string;
  isAbsolutePath(path: string): boolean;

  // ── Configuration ──
  getConfiguration(section: string): ConfigValue;

  // ── Workspace ──
  get workspaceRoots(): string[];
  get workspaceRoot(): string | undefined;

  // ── Path resolution ──
  resolvePath(base: string, relative: string): string;
}
