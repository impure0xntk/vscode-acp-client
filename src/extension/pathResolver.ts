import * as vscode from "vscode";
import * as path from "path";

export interface PathResolverCallbacks {
  onResolved: (paths: string[]) => void;
}

export class BatchedPathResolver {
  private pending = new Set<string>();
  private resolved = new Set<string>();
  private cache = new Map<string, boolean>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cwd: string;
  private callbacks: PathResolverCallbacks;

  constructor(cwd: string, callbacks: PathResolverCallbacks) {
    this.cwd = cwd;
    this.callbacks = callbacks;
  }

  enqueue(paths: string[]): void {
    let hasNew = false;
    for (const p of paths) {
      if (!this.resolved.has(p) && !this.pending.has(p)) {
        this.pending.add(p);
        hasNew = true;
      }
    }
    if (hasNew) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.flush().catch(() => {});
    }, 100);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const batch = [...this.pending];
    this.pending.clear();

    if (batch.length === 0) return;

    const limited = batch.slice(0, 100);

    const results = await Promise.all(
      limited.map(async (filePath) => {
        const cached = this.cache.get(filePath);
        const fullPath = path.resolve(this.cwd, filePath);
        if (cached !== undefined)
          return { path: filePath, fullPath, exists: cached };
        try {
          const stat = await vscode.workspace.fs.stat(
            vscode.Uri.file(fullPath)
          );
          // Only link files, not directories
          const isFile = (stat.type & vscode.FileType.File) !== 0;
          this.cache.set(filePath, isFile);
          return { path: filePath, fullPath, exists: isFile };
        } catch {
          this.cache.set(filePath, false);
          return { path: filePath, fullPath, exists: false };
        }
      })
    );

    const existingPaths: string[] = [];

    for (const r of results) {
      if (r.exists) {
        this.resolved.add(r.path);
        existingPaths.push(r.path);
      }
    }

    if (existingPaths.length > 0) {
      this.callbacks.onResolved(existingPaths);
    }
  }

  updateCwd(newCwd: string): void {
    if (this.cwd !== newCwd) {
      this.cwd = newCwd;
      this.cache.clear();
      this.resolved.clear();
    }
  }

  clear(): void {
    this.pending.clear();
    this.resolved.clear();
    this.cache.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
