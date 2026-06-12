// src/platform/editor.ts

import type { Disposable, LineRange, PlatformUri, DiffResult } from './types';

/** シンボル情報 */
export interface SymbolInfo {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  containerName?: string;
}

/** 定義位置 */
export interface DefinitionLocation {
  uri: PlatformUri;
  startLine: number;
  endLine: number;
}

/** 選択範囲 */
export interface Selection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  isEmpty: boolean;
}

/** アクティブエディタ情報 */
export interface ActiveEditor {
  documentUri: PlatformUri;
  filePath: string;
  languageId: string;
  selection: Selection;
  visibleRanges: LineRange[];
}

/** エディタ API インターフェース */
export interface EditorAPI {
  // ── ドキュメント操作 ──
  openDocument(uri: PlatformUri): Promise<PlatformUri>;
  getDocumentContent(uri: PlatformUri): Promise<string>;

  // ── アクティブエディタ ──
  get activeEditor(): ActiveEditor | undefined;
  get visibleEditors(): ActiveEditor[];

  // ── シンボル ──
  getSymbols(uri: PlatformUri): Promise<SymbolInfo[]>;
  findSymbolDefinition(uri: PlatformUri, line: number, character: number): Promise<DefinitionLocation | undefined>;
  searchSymbols(query: string): Promise<SymbolInfo[]>;

  // ── ファイル操作 ──
  openFile(path: string, line?: number): Promise<void>;

  // ── Diff ──
  computeDiff(oldContent: string, newContent: string, path: string): DiffResult;
  showDiff(diff: DiffResult, options?: {
    title?: string;
    preserveFocus?: boolean;
    preview?: boolean;
  }): Promise<void>;

  // ── 仮想ドキュメント ──
  registerDocumentProvider(
    scheme: string,
    provider: {
      provideContent(path: string): string | undefined;
    }
  ): Disposable;

  // ── Git ──
  getGitDiff(): Promise<string | undefined>;
}

/** Diff 結果（editor.ts から再エクスポート） */
export type { DiffResult } from './types';
