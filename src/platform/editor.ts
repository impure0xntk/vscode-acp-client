// src/platform/editor.ts

import type { Disposable, LineRange, PlatformUri, DiffResult } from "./types";

/** Symbol information */
export interface SymbolInfo {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  containerName?: string;
}

/** Definition location */
export interface DefinitionLocation {
  uri: PlatformUri;
  startLine: number;
  endLine: number;
}

/** Selection range */
export interface Selection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  isEmpty: boolean;
}

/** Active editor info */
export interface ActiveEditor {
  documentUri: PlatformUri;
  filePath: string;
  languageId: string;
  selection: Selection;
  visibleRanges: LineRange[];
}

/** Editor API interface */
export interface EditorAPI {
  // ── Document operations ──
  openDocument(uri: PlatformUri): Promise<PlatformUri>;
  getDocumentContent(uri: PlatformUri): Promise<string>;

  // ── Active editor ──
  get activeEditor(): ActiveEditor | undefined;
  get visibleEditors(): ActiveEditor[];

  // ── Symbols ──
  getSymbols(uri: PlatformUri): Promise<SymbolInfo[]>;
  findSymbolDefinition(
    uri: PlatformUri,
    line: number,
    character: number
  ): Promise<DefinitionLocation | undefined>;
  searchSymbols(query: string): Promise<SymbolInfo[]>;

  // ── File operations ──
  openFile(path: string, line?: number): Promise<void>;

  // ── Diff ──
  computeDiff(oldContent: string, newContent: string, path: string): DiffResult;
  showDiff(
    diff: DiffResult,
    options?: {
      title?: string;
      preserveFocus?: boolean;
      preview?: boolean;
    }
  ): Promise<void>;

  // ── Virtual documents ──
  registerDocumentProvider(
    scheme: string,
    provider: {
      provideContent(path: string): string | undefined;
    }
  ): Disposable;

  // ── Git ──
  getGitDiff(): Promise<string | undefined>;
}

/** Diff result (re-exported from editor.ts) */
export type { DiffResult } from "./types";
