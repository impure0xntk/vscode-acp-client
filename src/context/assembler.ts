import * as vscode from "vscode";
import * as path from "path";

export interface ContextAttachment {
  id: string;
  type: "file" | "selection" | "symbol" | "diff";
  path: string;
  label: string;
  lineRange?: [number, number];
  tokenCount: number;
  content: string;
}

/**
 * Resolve a file path to a ContextAttachment.
 * filePath may be absolute or relative to cwd (or workspace root if no cwd).
 * cwd: session working directory — used to resolve relative paths.
 */
export async function resolveFile(
  filePath: string,
  cwd?: string
): Promise<ContextAttachment> {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const base = cwd ?? ws;
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
  const uri = vscode.Uri.file(absPath);

  const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf-8");
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
export async function resolveSelection(): Promise<ContextAttachment | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const sel = editor.selection;
  if (sel.isEmpty) return null;

  const doc = editor.document;
  const fullText = doc.getText();
  const lines = fullText.split("\n");

  // Compute 1-based line range
  const startLine = sel.start.line + 1;
  const endLine = sel.end.line + 1;

  // Extract selected text preserving line structure
  const selectedLines = lines.slice(sel.start.line, sel.end.line + 1);
  const content = selectedLines.join("\n");

  const filePath = doc.fileName;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const relPath = path.relative(ws, filePath);

  return {
    id: crypto.randomUUID(),
    type: "selection",
    path: relPath,
    label: `${path.basename(relPath)}:${startLine}-${endLine}`,
    lineRange: [startLine, endLine],
    tokenCount: estimateTokens(content),
    content,
  };
}

/**
 * Resolve the symbol at the cursor to a ContextAttachment.
 * Uses vscode.executeDefinitionProvider to find the symbol definition.
 */
export async function resolveSymbol(): Promise<ContextAttachment | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const pos = editor.selection.active;
  const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeDefinitionProvider",
    editor.document.uri,
    pos
  );

  if (!definitions || definitions.length === 0) return null;

  const def = definitions[0];
  const doc = await vscode.workspace.openTextDocument(def.uri);
  const fullText = doc.getText();
  const lines = fullText.split("\n");

  const startLine = def.range.start.line + 1;
  const endLine = def.range.end.line + 1;
  const content = lines.slice(def.range.start.line, def.range.end.line + 1).join("\n");

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const relPath = path.relative(ws, def.uri.fsPath);

  return {
    id: crypto.randomUUID(),
    type: "symbol",
    path: relPath,
    label: `${path.basename(relPath)}:${startLine}-${endLine}`,
    lineRange: [startLine, endLine],
    tokenCount: estimateTokens(content),
    content,
  };
}

/**
 * Resolve the current Git diff to a ContextAttachment.
 * Uses the Git extension API to get staged + unstaged changes.
 */
export async function resolveDiff(): Promise<ContextAttachment | null> {
  const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>("vscode.git");
  if (!gitExtension) return null;

  const git = gitExtension.exports.getAPI(1);
  if (git.repositories.length === 0) return null;

  const repo = git.repositories[0];
  const diffs: string[] = [];

  // Staged changes
  const staged = await repo.diff(true);
  if (staged) diffs.push(staged);

  // Unstaged changes
  const unstaged = await repo.diff(false);
  if (unstaged) diffs.push(unstaged);

  if (diffs.length === 0) return null;

  const content = diffs.join("\n");
  return {
    id: crypto.randomUUID(),
    type: "diff",
    path: "(working tree)",
    label: "Working tree diff",
    tokenCount: estimateTokens(content),
    content,
  };
}

/**
 * Rough token estimation: characters / 4.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Git API type (minimal)
// ---------------------------------------------------------------------------

interface GitAPI {
  repositories: Array<{
    diff(cached: boolean): Promise<string>;
  }>;
}
