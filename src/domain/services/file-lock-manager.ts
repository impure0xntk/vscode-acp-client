// ============================================================================
// FileLockManager — optimistic file-level locking for concurrent agents
//
// refs: docs/p2p-mesh-design.md Section 4.2
// ============================================================================

import type { FileLockEntry } from "../models/mesh";
import { getLogger } from "../../platform/backends";

const log = getLogger("mesh.filelock");

// ----------------------------------------------------------------------------
// FileLockManager
// ----------------------------------------------------------------------------

export class FileLockManager {
  // filePath → FileLockEntry
  private locks: Map<string, FileLockEntry> = new Map();
  private readonly defaultTTL: number;

  constructor(defaultTTLMs = 300_000) {
    // 5 min default
    this.defaultTTL = defaultTTLMs;
  }

  // -----------------------------------------------------------------------
  // Acquire
  // -----------------------------------------------------------------------

  async acquire(
    filePath: string,
    agentId: string,
    lockType: "read" | "write" = "write",
    ttlMs?: number
  ): Promise<boolean> {
    const existing = this.locks.get(filePath);

    if (existing) {
      // Same agent can re-acquire (idempotent)
      if (existing.lockedBy === agentId) {
        existing.expiresAt = new Date(Date.now() + (ttlMs ?? this.defaultTTL));
        log.debug("lock refreshed", { filePath, agentId });
        return true;
      }

      // Expired → steal
      if (existing.expiresAt && existing.expiresAt < new Date()) {
        log.debug("lock expired, stealing", { filePath, previousAgentId: existing.lockedBy, newAgentId: agentId });
        this.locks.delete(filePath);
      } else {
        log.debug("lock denied", { filePath, requestedBy: agentId, lockedBy: existing.lockedBy });
        return false;
      }
    }

    this.locks.set(filePath, {
      filePath,
      lockedBy: agentId,
      lockedAt: new Date(),
      lockType,
      expiresAt: new Date(Date.now() + (ttlMs ?? this.defaultTTL)),
    });

    log.info("lock acquired", { filePath, agentId, lockType });
    return true;
  }

  // -----------------------------------------------------------------------
  // Release
  // -----------------------------------------------------------------------

  async release(filePath: string, agentId: string): Promise<boolean> {
    const existing = this.locks.get(filePath);
    if (existing && existing.lockedBy === agentId) {
      this.locks.delete(filePath);
      log.info("lock released", { filePath, agentId });
      return true;
    }
    return false;
  }

  async releaseAll(agentId: string): Promise<string[]> {
    const released: string[] = [];
    for (const [path, lock] of this.locks) {
      if (lock.lockedBy === agentId) {
        this.locks.delete(path);
        released.push(path);
      }
    }
    if (released.length > 0) {
      log.info("all locks released", { agentId, count: released.length });
    }
    return released;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getLock(filePath: string): FileLockEntry | undefined {
    const entry = this.locks.get(filePath);
    if (entry?.expiresAt && entry.expiresAt < new Date()) {
      this.locks.delete(filePath);
      return undefined;
    }
    return entry;
  }

  isLocked(filePath: string): boolean {
    return this.getLock(filePath) !== undefined;
  }

  getLocksForAgent(agentId: string): FileLockEntry[] {
    const result: FileLockEntry[] = [];
    for (const [, entry] of this.locks) {
      if (entry.lockedBy === agentId) {
        result.push(entry);
      }
    }
    return result;
  }

  getAllLocks(): FileLockEntry[] {
    // Purge expired first
    const now = new Date();
    for (const [path, entry] of this.locks) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.locks.delete(path);
      }
    }
    return Array.from(this.locks.values());
  }

  // -----------------------------------------------------------------------
  // Teardown
  // -----------------------------------------------------------------------

  dispose(): void {
    this.locks.clear();
  }
}
