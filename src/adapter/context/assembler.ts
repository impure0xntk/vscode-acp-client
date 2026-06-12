import * as path from "path";
import type { ContextAttachment } from "./types";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { EditorAPI } from "../../platform/editor";

export type { ContextAttachment };

export interface GitAPI {
  repositories: Array<{
    diff(cached: boolean): Promise<string>;
  }>;
}

/**
 * Resolve a file path to a ContextAttachment.
 */
export async function resolveFile(
  fs: FileSystemAPI,
  filePath: string,
  cwd?: string
): Promise<ContextAttachment> {
  const ws = fs.workspaceRoot ?? "";
  const base = cwd ?? ws;
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
  const content = await fs.readFile(absPath);
  const label = path.basename(filePath);

  return {
    id: crypto.randomUUID(),
    type: "file",
    path: filePath,
    label,
    tokenCount: estimateTokens(content),
    content,
  };
}

/**
 * Resolve the current editor selection to a ContextAttachment.
 */
export async function resolveSelection(
  editor: EditorAPI
): Promise<ContextAttachment | null> {
  const activeEditor = editor.activeEditor;
  if (!activeEditor || activeEditor.selection.isEmpty) return null;

  const sel = activeEditor.selection;
  const content = await editor.getDocumentContent(activeEditor.documentUri);
  const lines = content.split("\n");
  const selectedLines = lines.slice(sel.startLine - 1, sel.endLine);
  const selectedText = selectedLines.join("\n");

  return {
    id: crypto.randomUUID(),
    type: "selection",
    path: activeEditor.filePath,
    label: `${path.basename(activeEditor.filePath)}:${sel.startLine}-${sel.endLine}`,
    lineRange: [sel.startLine, sel.endLine],
    tokenCount: estimateTokens(selectedText),
    content: selectedText,
  };
}

/**
 * Resolve the symbol at the cursor to a ContextAttachment.
 */
export async function resolveSymbol(
  editor: EditorAPI
): Promise<ContextAttachment | null> {
  const activeEditor = editor.activeEditor;
  if (!activeEditor) return null;

  const def = await editor.findSymbolDefinition(
    activeEditor.documentUri,
    activeEditor.selection.startLine,
    activeEditor.selection.startCharacter
  );
  if (!def) return null;

  const content = await editor.getDocumentContent(def.uri);
  const lines = content.split("\n");
  const selectedLines = lines.slice(def.startLine - 1, def.endLine);
  const selectedText = selectedLines.join("\n");

  return {
    id: crypto.randomUUID(),
    type: "symbol",
    path: def.uri.fsPath,
    label: `${path.basename(def.uri.fsPath)}:${def.startLine}-${def.endLine}`,
    lineRange: [def.startLine, def.endLine],
    tokenCount: estimateTokens(selectedText),
    content: selectedText,
  };
}

/**
 * Resolve the current Git diff to a ContextAttachment.
 */
export async function resolveDiff(
  editor: EditorAPI
): Promise<ContextAttachment | null> {
  const diff = await editor.getGitDiff();
  if (!diff) return null;

  return {
    id: crypto.randomUUID(),
    type: "diff",
    path: "(working tree)",
    label: "Working tree diff",
    tokenCount: estimateTokens(diff),
    content: diff,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
