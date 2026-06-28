import type { FileSystemAPI } from "../../platform/filesystem";
import type { FileCandidate } from "../../platform/filesystem";
import type { PlatformUri } from "../../platform/types";

export type { FileCandidate };

const MAX_CANDIDATES = 50;

export async function searchFiles(
  fs: FileSystemAPI,
  query: string,
  cwd?: string
): Promise<FileCandidate[]> {
  const wsRoot = fs.workspaceRoot ?? "";
  const base = cwd ?? wsRoot;

  const raw =
    query.includes("*") || query.includes("{") ? query : `**/*${query}*`;

  const exclude =
    "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**}";

  let uris: PlatformUri[];

  if (cwd && fs.findFilesInDirectory) {
    uris = await fs.findFilesInDirectory(cwd, raw, exclude, MAX_CANDIDATES);
  } else {
    let pattern: string;
    if (cwd && cwd !== wsRoot) {
      const relCwd = fs.relativePath(wsRoot, cwd);
      pattern = relCwd === "." ? raw : `${relCwd}/${raw}`;
    } else {
      pattern = raw;
    }
    uris = await fs.findFiles(pattern, exclude, MAX_CANDIDATES);
  }

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
