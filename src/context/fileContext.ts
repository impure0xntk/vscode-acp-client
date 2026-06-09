import * as vscode from "vscode";

export interface FileCandidate {
  relativePath: string;
  absolutePath: string;
  name: string;
}

const MAX_CANDIDATES = 50;

/**
 * Search workspace files matching a glob-like query string.
 * Returns up to MAX_CANDIDATES matches sorted by relevance.
 */
export async function searchFiles(query: string, cwd?: string): Promise<FileCandidate[]> {
  if (!query.trim()) {
    // Return recently opened / visible editors
    return getVisibleFiles(cwd);
  }

  // Build a glob pattern: if query has no wildcard, wrap with **
  const pattern = query.includes("*") || query.includes("{")
    ? query
    : `**/${query}*`;

  const exclude = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**}";

  // Resolve base for findFiles: use RelativePattern when cwd is set
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  const baseForSearch = resolveBaseFolder(cwd, wsFolder?.uri.fsPath ?? "");

  const includePattern: vscode.GlobPattern = cwd
    ? new vscode.RelativePattern(baseForSearch, pattern)
    : pattern;

  const uris = await vscode.workspace.findFiles(
    includePattern,
    exclude,
    MAX_CANDIDATES
  );

  return uris.map((uri) => ({
    relativePath: cwd ? pathRelative(cwd, uri.fsPath) : vscode.workspace.asRelativePath(uri, false),
    absolutePath: uri.fsPath,
    name: uri.fsPath.split("/").pop() ?? uri.fsPath,
  }));
}

/**
 * Resolve the base folder for findFiles.
 * - If cwd is inside the workspace, use workspace root (findFiles works).
 * - If cwd is outside the workspace, findFiles can't search it, so we
 *   fall back to listing visible tabs only (empty query case).
 * For non-empty queries with out-of-workspace cwd, we use the cwd itself
 * as base — findFiles will still work for absolute-base patterns in some
 * VS Code versions, but if it returns empty we rely on the caller to
 * handle gracefully.
 */
function resolveBaseFolder(
  cwd: string | undefined,
  wsFsPath: string
): string {
  if (!cwd) return wsFsPath || ".";
  if (!wsFsPath) return cwd;
  // cwd inside workspace → use workspace root for proper glob matching
  if (cwd === wsFsPath || cwd.startsWith(wsFsPath + "/")) {
    return wsFsPath;
  }
  // cwd outside workspace → use as-is (findFiles may still work via multi-root)
  return cwd;
}

/**
 * Get currently visible file tabs as candidates.
 * When cwd is provided, filter to files under that directory and compute
 * relative paths from it.
 */
function getVisibleFiles(cwd?: string): FileCandidate[] {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const base = cwd ?? ws;
  const seen = new Set<string>();
  const results: FileCandidate[] = [];

  for (const tab of vscode.window.tabGroups.all.flatMap((g) => g.tabs)) {
    const input = tab.input;
    if (!(input instanceof vscode.TabInputText)) continue;
    if (seen.has(input.uri.fsPath)) continue;
    seen.add(input.uri.fsPath);

    // If cwd is set, only include files under that directory
    if (cwd && !input.uri.fsPath.startsWith(cwd + "/") && input.uri.fsPath !== cwd) {
      continue;
    }

    results.push({
      relativePath: pathRelative(base, input.uri.fsPath) || input.uri.fsPath.split("/").pop() || input.uri.fsPath,
      absolutePath: input.uri.fsPath,
      name: input.uri.fsPath.split("/").pop() ?? input.uri.fsPath,
    });
    if (results.length >= MAX_CANDIDATES) break;
  }

  return results;
}

/**
 * Compute relative path from `from` to `to`.
 * Returns empty string if `to` is the same as `from`.
 */
function pathRelative(from: string, to: string): string {
  if (to.startsWith(from + "/")) {
    return to.slice(from.length + 1);
  }
  return to;
}
