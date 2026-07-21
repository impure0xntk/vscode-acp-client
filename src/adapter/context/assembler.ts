import * as path from "path";
import type { ContextAttachment } from "./types";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { EditorAPI, DiagnosticProblem } from "../../platform/editor";
import type { PlatformUri } from "../../platform/types";

export type { ContextAttachment };

export interface GitAPI {
  repositories: Array<{
    diff(cached: boolean): Promise<string>;
  }>;
}

export async function resolveFile(
  fs: FileSystemAPI,
  filePath: string,
  cwd?: string
): Promise<ContextAttachment> {
  const ws = fs.workspaceRoot ?? "";
  const base = cwd ?? ws;
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(base, filePath);
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
 * Serializable editor range (0-based, end-exclusive — VS Code convention).
 * Used to thread a Quick Fix / diagnostic range from the code-action
 * provider through to the command handler without depending on the
 * active editor selection at invocation time.
 */
export interface SerializedRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/**
 * Resolve a Composer attachment from an explicit editor range rather than
 * the active editor selection. This is what the Quick Fix path needs: when
 * the user invokes "Fix selection with agent" on a problem (diagnostic), the
 * document's active selection is empty, so reading `editor.activeEditor`
 * would yield nothing. Passing the range the action was invoked on fixes it.
 *
 * VS Code ranges are 0-based and end-exclusive; the attachment's
 * `lineRange`/`label` use 1-based inclusive line numbers (matching the
 * other resolver helpers).
 */
export async function resolveRange(
  editor: EditorAPI,
  documentUri: PlatformUri,
  range: SerializedRange
): Promise<ContextAttachment | null> {
  let content: string;
  try {
    content = await editor.getDocumentContent(documentUri);
  } catch {
    return null;
  }
  if (!content) return null;

  const lines = content.split("\n");

  // A zero-width range (e.g. a bare cursor position) has nothing to attach.
  const isEmptyRange =
    range.startLine === range.endLine &&
    range.startCharacter === range.endCharacter;
  if (isEmptyRange) return null;

  // End-exclusive ranges that terminate at column 0 of a line do not include
  // that line (e.g. a multi-line diagnostic ending at the start of the next
  // line). Drop it so the attachment covers exactly the highlighted lines.
  const firstLine = Math.max(0, range.startLine);
  const rawLastLine =
    range.endCharacter === 0 ? range.endLine - 1 : range.endLine;
  const lastLine = Math.max(firstLine, Math.min(lines.length - 1, rawLastLine));
  if (lastLine < firstLine) return null;

  const selectedLines = lines.slice(firstLine, lastLine + 1);
  const selectedText = selectedLines.join("\n");
  if (!selectedText) return null;

  const filePath = documentUri.fsPath;
  const startLine1 = firstLine + 1;
  const endLine1 = lastLine + 1;

  return {
    id: crypto.randomUUID(),
    type: "selection",
    path: filePath,
    label: `${path.basename(filePath)}:${startLine1}-${endLine1}`,
    lineRange: [startLine1, endLine1],
    tokenCount: estimateTokens(selectedText),
    content: selectedText,
  };
}

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

/**
 * Render one or more diagnostics as a `problem`-type Composer attachment.
 * Used by `resolveProblem` (a single right-clicked problem from the Problems
 * panel's context menu). Embeds each offending source line plus a caret under
 * the offending column so the agent sees both the message and the exact
 * symbol/expression without re-running the linter itself.
 */
async function renderProblems(
  fs: FileSystemAPI,
  problems: DiagnosticProblem[],
  scopeLabel: string
): Promise<ContextAttachment | null> {
  if (problems.length === 0) return null;

  // Sort for stable, readable output.
  problems = [...problems].sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) ||
      a.startLine - b.startLine ||
      a.startColumn - b.startColumn
  );

  const fileCount = new Set(problems.map((p) => p.filePath)).size;
  const issueWord = problems.length === 1 ? "issue" : "issues";
  const fileWord = fileCount === 1 ? "file" : "files";
  const header = `Problems (${scopeLabel}): ${problems.length} ${issueWord} across ${fileCount} ${fileWord}`;

  const relPath = (p: string): string => {
    const ws = fs.workspaceRoot ?? "";
    if (ws && p.startsWith(ws)) {
      const rel = path.relative(ws, p);
      return rel.length > 0 ? rel : path.basename(p);
    }
    return p;
  };

  const lines: string[] = [header, ""];

  // Read each unique file's content once to embed the offending source line.
  const contentCache = new Map<string, string | null>();
  const readFile = async (filePath: string): Promise<string | null> => {
    if (contentCache.has(filePath)) return contentCache.get(filePath) ?? null;
    let content: string | null = null;
    try {
      content = await fs.readFile(filePath);
    } catch {
      content = null;
    }
    contentCache.set(filePath, content);
    return content;
  };

  let index = 0;
  for (let i = 0; i < problems.length; i++) {
    const p = problems[i];
    index += 1;

    const sourceTag = p.source ? `${p.source}` : "(unknown)";
    const codeTag = p.code ? ` (${p.code})` : "";
    const loc = `${relPath(p.filePath)}:${p.startLine}:${p.startColumn}`;
    const severity = p.severity.toUpperCase();
    lines.push(`${index}. [${severity}] ${sourceTag}${codeTag}: ${loc}`);
    lines.push(`   ${p.message}`);

    // Embed the offending source line + a caret under the column so the
    // agent sees both the message and the exact symbol/expression.
    const content = await readFile(p.filePath);
    if (content !== null) {
      const fileLines = content.split("\n");
      const srcLineIdx = p.startLine - 1;
      if (srcLineIdx >= 0 && srcLineIdx < fileLines.length) {
        const srcLine = fileLines[srcLineIdx];
        const gutter = `   > ${p.startLine} | `;
        lines.push(`${gutter}${srcLine}`);
        const caretPad = gutter.length + Math.max(0, p.startColumn - 1);
        lines.push(`${" ".repeat(caretPad)}^`);
      }
    }

    // Blank separator unless the next diagnostic is on the same file+line.
    const next = problems[i + 1];
    if (
      !next ||
      next.filePath !== p.filePath ||
      next.startLine !== p.startLine
    ) {
      lines.push("");
    }
  }

  const first = problems[0];
  const label =
    problems.length === 1
      ? `${path.basename(first.filePath)}:${first.startLine}`
      : scopeLabel === "current file"
        ? `${path.basename(first.filePath)}: Problems (${problems.length})`
        : `Problems (${problems.length})`;

  return {
    id: crypto.randomUUID(),
    type: "problem",
    // First problem's file so the chip click opens it; the prompt block
    // uses a synthetic `problems://` URI (see attachmentsToContentBlocks).
    path: first.filePath,
    label,
    lineRange: [first.startLine, first.endLine],
    tokenCount: estimateTokens(lines.join("\n")),
    content: lines.join("\n"),
    message: first.message,
  };
}

/**
 * Resolve a Composer attachment from a single diagnostic (e.g. one
 * right-clicked in the Problems panel). Used by the `acp.attachProblem`
 * command so a problem is attached as a `problem`-type attachment — distinct
 * from a `selection` — carrying its message, `file:line:col`, source line,
 * and a caret, ready for an agent to act on.
 */
export async function resolveProblem(
  fs: FileSystemAPI,
  problem: DiagnosticProblem
): Promise<ContextAttachment | null> {
  return renderProblems(fs, [problem], "selected problem");
}
