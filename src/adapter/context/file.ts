import type { FileSystemAPI } from "../../platform/filesystem";
import type { FileCandidate } from "../../platform/filesystem";

export type { FileCandidate };

const MAX_CANDIDATES = 50;

export async function searchFiles(
  fs: FileSystemAPI,
  query: string,
  cwd?: string
): Promise<FileCandidate[]> {
  if (!query.trim()) {
    return getVisibleFiles(fs, cwd);
  }

  const pattern =
    query.includes("*") || query.includes("{") ? query : `**/${query}*`;

  const exclude =
    "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**}";
  const uris = await fs.findFiles(pattern, exclude, MAX_CANDIDATES);

  return uris.map((uri) => ({
    relativePath: cwd ? fs.relativePath(cwd, uri.fsPath) : uri.path,
    absolutePath: uri.fsPath,
    name: fs.basename(uri.fsPath),
  }));
}

function getVisibleFiles(fs: FileSystemAPI, cwd?: string): FileCandidate[] {
  const ws = fs.workspaceRoot ?? "";
  const base = cwd ?? ws;
  const seen = new Set<string>();
  const results: FileCandidate[] = [];

  // Fetch visible editor files via Platform API
  // Fallback: returns workspace root files for now
  const roots = fs.workspaceRoots;
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    results.push({
      relativePath: fs.relativePath(base, root) || fs.basename(root),
      absolutePath: root,
      name: fs.basename(root),
    });
    if (results.length >= MAX_CANDIDATES) break;
  }

  return results;
}
