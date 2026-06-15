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
        if (cached !== undefined) return { path: filePath, exists: cached };
        try {
          const fullPath = path.resolve(this.cwd, filePath);
          await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
          this.cache.set(filePath, true);
          return { path: filePath, exists: true };
        } catch {
          this.cache.set(filePath, false);
          return { path: filePath, exists: false };
        }
      }),
    );

    const existingPaths = results
      .filter((r) => r.exists)
      .map((r) => r.path);

    for (const p of existingPaths) {
      this.resolved.add(p);
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
