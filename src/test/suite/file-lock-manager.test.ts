// ============================================================================
// FileLockManager unit tests
// ============================================================================

import * as assert from "assert";
import { FileLockManager } from "../../domain/services/file-lock-manager";

describe("FileLockManager", () => {
  let mgr: FileLockManager;

  beforeEach(() => {
    mgr = new FileLockManager(5000); // 5 s TTL for testing
  });

  afterEach(() => {
    mgr.dispose();
  });

  describe("acquire", () => {
    it("should acquire a lock on an unlocked file", async () => {
      const ok = await mgr.acquire("src/foo.ts", "agent-a");
      assert.strictEqual(ok, true);
    });

    it("should deny lock when another agent holds it", async () => {
      await mgr.acquire("src/foo.ts", "agent-a");
      const ok = await mgr.acquire("src/foo.ts", "agent-b");
      assert.strictEqual(ok, false);
    });

    it("should allow same agent to re-acquire (idempotent)", async () => {
      await mgr.acquire("src/foo.ts", "agent-a");
      const ok = await mgr.acquire("src/foo.ts", "agent-a");
      assert.strictEqual(ok, true);
    });

    it("should steal lock when existing lock is expired", async () => {
      const shortMgr = new FileLockManager(1); // 1 ms TTL
      await shortMgr.acquire("src/foo.ts", "agent-a");

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));

      const ok = await shortMgr.acquire("src/foo.ts", "agent-b");
      assert.strictEqual(ok, true);
      shortMgr.dispose();
    });

    it("should track lock type", async () => {
      await mgr.acquire("src/foo.ts", "agent-a", "read");
      const lock = mgr.getLock("src/foo.ts");
      assert.strictEqual(lock?.lockType, "read");
    });
  });

  describe("release", () => {
    it("should release a held lock", async () => {
      await mgr.acquire("src/foo.ts", "agent-a");
      const ok = await mgr.release("src/foo.ts", "agent-a");
      assert.strictEqual(ok, true);
      assert.strictEqual(mgr.isLocked("src/foo.ts"), false);
    });

    it("should return false when releasing a lock held by another agent", async () => {
      await mgr.acquire("src/foo.ts", "agent-a");
      const ok = await mgr.release("src/foo.ts", "agent-b");
      assert.strictEqual(ok, false);
      assert.strictEqual(mgr.isLocked("src/foo.ts"), true);
    });

    it("should return false for a non-existent lock", async () => {
      const ok = await mgr.release("src/missing.ts", "agent-a");
      assert.strictEqual(ok, false);
    });
  });

  describe("releaseAll", () => {
    it("should release all locks held by an agent", async () => {
      await mgr.acquire("src/a.ts", "agent-a");
      await mgr.acquire("src/b.ts", "agent-a");
      await mgr.acquire("src/c.ts", "agent-b");

      const released = await mgr.releaseAll("agent-a");
      assert.strictEqual(released.length, 2);
      assert.ok(released.includes("src/a.ts"));
      assert.ok(released.includes("src/b.ts"));
      // agent-b's lock remains
      assert.strictEqual(mgr.isLocked("src/c.ts"), true);
    });
  });

  describe("query", () => {
    it("should return undefined for unlocked file", () => {
      assert.strictEqual(mgr.getLock("src/foo.ts"), undefined);
    });

    it("should return lock entry for locked file", async () => {
      await mgr.acquire("src/foo.ts", "agent-a", "write");
      const lock = mgr.getLock("src/foo.ts");
      assert.ok(lock);
      assert.strictEqual(lock.lockedBy, "agent-a");
      assert.strictEqual(lock.filePath, "src/foo.ts");
    });

    it("isLocked should return true for locked file", async () => {
      await mgr.acquire("src/foo.ts", "agent-a");
      assert.strictEqual(mgr.isLocked("src/foo.ts"), true);
    });

    it("isLocked should return false for expired lock", async () => {
      const shortMgr = new FileLockManager(1);
      await shortMgr.acquire("src/foo.ts", "agent-a");
      await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(shortMgr.isLocked("src/foo.ts"), false);
      shortMgr.dispose();
    });

    it("should return locks filtered by agent", async () => {
      await mgr.acquire("src/a.ts", "agent-a");
      await mgr.acquire("src/b.ts", "agent-a");
      await mgr.acquire("src/c.ts", "agent-b");

      const locksA = mgr.getLocksForAgent("agent-a");
      assert.strictEqual(locksA.length, 2);
      assert.ok(locksA.every((l) => l.lockedBy === "agent-a"));
    });

    it("getAllLocks should purge expired locks", async () => {
      const shortMgr = new FileLockManager(1);
      await shortMgr.acquire("src/a.ts", "agent-a");
      await shortMgr.acquire("src/b.ts", "agent-b");
      await new Promise((r) => setTimeout(r, 10));

      const all = shortMgr.getAllLocks();
      assert.strictEqual(all.length, 0);
      shortMgr.dispose();
    });
  });

  describe("dispose", () => {
    it("should clear all locks", async () => {
      await mgr.acquire("src/a.ts", "agent-a");
      await mgr.acquire("src/b.ts", "agent-b");
      mgr.dispose();
      assert.strictEqual(mgr.getAllLocks().length, 0);
    });
  });
});
