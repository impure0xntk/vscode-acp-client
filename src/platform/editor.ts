// src/platform/editor.ts

import type { Disposable, LineRange, PlatformUri, DiffResult } from "./types";

export interface SymbolInfo {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  containerName?: string;
}

export interface DefinitionLocation {
  uri: PlatformUri;
  startLine: number;
  endLine: number;
}

export interface Selection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  isEmpty: boolean;
}

export interface ActiveEditor {
  documentUri: PlatformUri;
  filePath: string;
  languageId: string;
  selection: Selection;
  visibleRanges: LineRange[];
}

export interface EditorAPI {
  openDocument(uri: PlatformUri): Promise<PlatformUri>;
  getDocumentContent(uri: PlatformUri): Promise<string>;
  get activeEditor(): ActiveEditor | undefined;
  get visibleEditors(): ActiveEditor[];
  getSymbols(uri: PlatformUri): Promise<SymbolInfo[]>;
  findSymbolDefinition(
    uri: PlatformUri,
    line: number,
    character: number
  ): Promise<DefinitionLocation | undefined>;
  searchSymbols(query: string): Promise<SymbolInfo[]>;
  openFile(path: string, line?: number): Promise<void>;
  computeDiff(oldContent: string, newContent: string, path: string): DiffResult;
  showDiff(
    diff: DiffResult,
    options?: {
      title?: string;
      preserveFocus?: boolean;
      preview?: boolean;
    }
  ): Promise<void>;
  registerDocumentProvider(
    scheme: string,
    provider: {
      provideContent(path: string): string | undefined;
    }
  ): Disposable;
  getGitDiff(): Promise<string | undefined>;
}

export type { DiffResult } from "./types";
