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
  private static readonly CACHE_MAX = 5000;
  private static readonly FLUSH_INTERVAL_MS = 100;
  private static readonly FLUSH_BATCH_SIZE = 100;

  constructor(cwd: string, callbacks: PathResolverCallbacks) {
    this.cwd = cwd;
    this.callbacks = callbacks;
  }

  private enforceCacheLimit(): void {
    if (BatchedPathResolver.CACHE_MAX <= 0) return;
    if (this.cache.size <= BatchedPathResolver.CACHE_MAX) return;
    // Evict oldest entries (Map iteration order = insertion order)
    const overflow = this.cache.size - BatchedPathResolver.CACHE_MAX;
    let i = 0;
    for (const key of this.cache.keys()) {
      if (i >= overflow) break;
      this.cache.delete(key);
      this.resolved.delete(key);
      i++;
    }
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
    }, BatchedPathResolver.FLUSH_INTERVAL_MS);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const batch = [...this.pending];
    this.pending.clear();

    if (batch.length === 0) return;

    const limited = batch.slice(0, BatchedPathResolver.FLUSH_BATCH_SIZE);

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

    this.enforceCacheLimit();

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
