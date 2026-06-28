// src/platform/filesystem.ts

import type {
  ConfigValue,
  Disposable,
  FileSnapshot,
  FileStat,
  FileWatchEvent,
  PlatformUri,
} from "./types";

export interface FileCandidate {
  relativePath: string;
  absolutePath: string;
  name: string;
}

export interface FileSystemAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;
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
  watchFiles(
    pattern: string,
    callback: (event: FileWatchEvent) => void
  ): () => void;
  captureSnapshot(path: string): Promise<FileSnapshot>;
  uri(path: string): PlatformUri;
  joinPath(base: PlatformUri, ...segments: string[]): PlatformUri;
  basename(path: string): string;
  dirname(path: string): string;
  relativePath(from: string, to: string): string;
  isAbsolutePath(path: string): boolean;
  getConfiguration(section: string): ConfigValue;
  get workspaceRoots(): string[];
  get workspaceRoot(): string | undefined;
  resolvePath(base: string, relative: string): string;
}
