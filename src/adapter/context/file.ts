import type { FileSystemAPI } from "../../platform/filesystem";
import type { FileCandidate } from "../../platform/filesystem";

export type { FileCandidate };

const MAX_CANDIDATES = 50;

export async function searchFiles(
  fs: FileSystemAPI,
  query: string,
  cwd?: string
): Promise<FileCandidate[]> {
  const base = cwd ?? fs.workspaceRoot ?? "";

  // Build a glob that matches the query as a substring of the basename.
  // "Composer" → "**/*Composer*" so it matches src/components/Composer.tsx
  // User-supplied globs with * or { are passed through as-is.
  const pattern =
    query.includes("*") || query.includes("{") ? query : `**/*${query}*`;

  const exclude =
    "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**}";
  const uris = await fs.findFiles(pattern, exclude, MAX_CANDIDATES);

  const results: FileCandidate[] = [];
  const seen = new Set<string>();
  for (const uri of uris) {
    if (seen.has(uri.fsPath)) continue;
    seen.add(uri.fsPath);
    results.push({
      relativePath: base ? fs.relativePath(base, uri.fsPath) : uri.path,
      absolutePath: uri.fsPath,
      name: fs.basename(uri.fsPath),
    });
  }
  return results;
}
