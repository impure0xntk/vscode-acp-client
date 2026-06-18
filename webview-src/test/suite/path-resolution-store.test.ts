import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { usePathResolutionStore } from "../../store/pathResolutionStore";

// ── Store reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  usePathResolutionStore.setState({ resolvedPaths: {} });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pathResolutionStore", () => {
  // ── addResolvedPaths ──────────────────────────────────────────────────

  describe("addResolvedPaths", () => {
    it("stores paths under a sessionKey", () => {
      usePathResolutionStore
        .getState()
        .addResolvedPaths("agent1:session1", ["/src/foo.ts", "/src/bar.ts"]);
      const state = usePathResolutionStore.getState();
      const paths = state.resolvedPaths["agent1:session1"];
      assert.ok(paths instanceof Set);
      assert.strictEqual(paths.size, 2);
      assert.ok(paths.has("/src/foo.ts"));
      assert.ok(paths.has("/src/bar.ts"));
    });

    it("uses agentId:sessionId format as key", () => {
      usePathResolutionStore
        .getState()
        .addResolvedPaths("claude:abc123", ["/README.md"]);
      const state = usePathResolutionStore.getState();
      assert.ok("claude:abc123" in state.resolvedPaths);
      assert.strictEqual(state.resolvedPaths["claude:abc123"].size, 1);
    });

    it("appends new paths without duplicating existing ones", () => {
      const s = usePathResolutionStore.getState();
      s.addResolvedPaths("a:1", ["/a.ts", "/b.ts"]);
      s.addResolvedPaths("a:1", ["/b.ts", "/c.ts"]);
      const paths = usePathResolutionStore.getState().resolvedPaths["a:1"];
      assert.strictEqual(paths.size, 3);
      assert.ok(paths.has("/a.ts"));
      assert.ok(paths.has("/b.ts"));
      assert.ok(paths.has("/c.ts"));
    });

    it("is a no-op when all paths already exist (referential equality)", () => {
      const s = usePathResolutionStore.getState();
      s.addResolvedPaths("a:1", ["/x.ts"]);
      const ref = usePathResolutionStore.getState();
      s.addResolvedPaths("a:1", ["/x.ts"]);
      assert.strictEqual(usePathResolutionStore.getState(), ref);
    });

    it("creates separate entries for different sessionKeys", () => {
      const s = usePathResolutionStore.getState();
      s.addResolvedPaths("agent1:session1", ["/a.ts"]);
      s.addResolvedPaths("agent1:session2", ["/b.ts"]);
      s.addResolvedPaths("agent2:session1", ["/c.ts"]);
      const state = usePathResolutionStore.getState();
      assert.strictEqual(state.resolvedPaths["agent1:session1"].size, 1);
      assert.ok(state.resolvedPaths["agent1:session1"].has("/a.ts"));
      assert.strictEqual(state.resolvedPaths["agent1:session2"].size, 1);
      assert.ok(state.resolvedPaths["agent1:session2"].has("/b.ts"));
      assert.strictEqual(state.resolvedPaths["agent2:session1"].size, 1);
      assert.ok(state.resolvedPaths["agent2:session1"].has("/c.ts"));
    });

    it("does not merge paths across different sessionKeys", () => {
      const s = usePathResolutionStore.getState();
      s.addResolvedPaths("agent1:session1", ["/shared.ts"]);
      s.addResolvedPaths("agent1:session2", ["/shared.ts"]);
      const state = usePathResolutionStore.getState();
      assert.ok(state.resolvedPaths["agent1:session1"].has("/shared.ts"));
      assert.ok(state.resolvedPaths["agent1:session2"].has("/shared.ts"));
      // Verify they are different Set instances
      assert.notStrictEqual(
        state.resolvedPaths["agent1:session1"],
        state.resolvedPaths["agent1:session2"]
      );
    });

    it("handles empty paths array without creating an entry", () => {
      const s = usePathResolutionStore.getState();
      s.addResolvedPaths("a:1", []);
      const state = usePathResolutionStore.getState();
      // Empty array: no existing, newPaths is empty → returns early (no-op)
      assert.strictEqual(state.resolvedPaths["a:1"], undefined);
    });

    it("handles paths with special characters", () => {
      const specialPaths = [
        "/src/my-file.ts",
        "/src/(special).ts",
        "/src/[bracket].ts",
        "/src/file with spaces.ts",
      ];
      usePathResolutionStore.getState().addResolvedPaths("a:1", specialPaths);
      const paths = usePathResolutionStore.getState().resolvedPaths["a:1"];
      assert.strictEqual(paths.size, 4);
      for (const p of specialPaths) {
        assert.ok(paths.has(p), `Expected ${p} in set`);
      }
    });
  });

  // ── clearSession ─────────────────────────────────────────────────────

  describe("clearSession", () => {
    it("removes resolved paths for a given sessionKey", () => {
      usePathResolutionStore
        .getState()
        .addResolvedPaths("agent1:session1", ["/a.ts"]);
      usePathResolutionStore.getState().clearSession("agent1:session1");
      const state = usePathResolutionStore.getState();
      assert.strictEqual(state.resolvedPaths["agent1:session1"], undefined);
    });

    it("does not affect other sessions", () => {
      const s = usePathResolutionStore.getState();
      s.addResolvedPaths("agent1:session1", ["/a.ts"]);
      s.addResolvedPaths("agent1:session2", ["/b.ts"]);
      s.clearSession("agent1:session1");
      const state = usePathResolutionStore.getState();
      assert.strictEqual(state.resolvedPaths["agent1:session1"], undefined);
      assert.ok(state.resolvedPaths["agent1:session2"].has("/b.ts"));
    });

    it("is a no-op for non-existent key", () => {
      usePathResolutionStore
        .getState()
        .addResolvedPaths("agent1:session1", ["/a.ts"]);
      const ref = usePathResolutionStore.getState();
      usePathResolutionStore.getState().clearSession("nonexistent");
      assert.strictEqual(usePathResolutionStore.getState(), ref);
    });
  });

  // ── clearAll ─────────────────────────────────────────────────────────

  describe("clearAll", () => {
    it("removes all resolved paths", () => {
      const s = usePathResolutionStore.getState();
      s.addResolvedPaths("agent1:session1", ["/a.ts"]);
      s.addResolvedPaths("agent2:session2", ["/b.ts"]);
      s.clearAll();
      const state = usePathResolutionStore.getState();
      assert.deepStrictEqual(state.resolvedPaths, {});
    });

    it("is a no-op when store is already empty", () => {
      usePathResolutionStore.getState().clearAll();
      const state = usePathResolutionStore.getState();
      assert.deepStrictEqual(state.resolvedPaths, {});
    });
  });

  // ── Bug regression: sessionId-only key vs agentId:sessionId key ──────

  describe("bug regression: key format matters for path lookup", () => {
    it("paths stored under 'agentId:sessionId' are NOT found under sessionId alone", () => {
      // This was the root bug: Message.tsx used sessionId as lookup key
      // but ChatPanel sends resolved paths keyed by 'agentId:sessionId'
      usePathResolutionStore
        .getState()
        .addResolvedPaths("claude:session-abc", ["/src/foo.ts"]);
      const state = usePathResolutionStore.getState();

      // Correct key works
      assert.ok(state.resolvedPaths["claude:session-abc"].has("/src/foo.ts"));

      // Wrong key (sessionId only) does NOT have the paths
      assert.strictEqual(state.resolvedPaths["session-abc"], undefined);

      // Wrong key (agentId only) does NOT have the paths
      assert.strictEqual(state.resolvedPaths["claude"], undefined);
    });

    it("after fix, Message component must pass agentId:sessionId to lookup", () => {
      // Simulate the fixed behavior: component constructs sessionKey internally
      const agentId = "codex";
      const sessionId = "sess-xyz";
      const sessionKey = `${agentId}:${sessionId}`; // sessionKeyOf()

      usePathResolutionStore
        .getState()
        .addResolvedPaths(sessionKey, ["/app/main.ts"]);

      // Lookup with correct composite key
      const paths = usePathResolutionStore.getState().resolvedPaths[sessionKey];
      assert.ok(paths instanceof Set);
      assert.ok(paths.has("/app/main.ts"));
    });
  });

  // ── Incremental resolution simulation ─────────────────────────────────

  describe("incremental resolution (simulates BatchedPathResolver to webview)", () => {
    it("accumulates paths across multiple pushResolved messages for same session", () => {
      const sk = "agent1:sess-1";
      const s = usePathResolutionStore.getState();

      // First batch from extension
      s.addResolvedPaths(sk, ["/src/a.ts", "/src/b.ts"]);
      assert.strictEqual(
        usePathResolutionStore.getState().resolvedPaths[sk].size,
        2
      );

      // Second batch (new paths only, duplicates ignored)
      s.addResolvedPaths(sk, ["/src/b.ts", "/src/c.ts", "/src/d.ts"]);
      const finalPaths = usePathResolutionStore.getState().resolvedPaths[sk];
      assert.strictEqual(finalPaths.size, 4);
      assert.ok(finalPaths.has("/src/a.ts"));
      assert.ok(finalPaths.has("/src/b.ts"));
      assert.ok(finalPaths.has("/src/c.ts"));
      assert.ok(finalPaths.has("/src/d.ts"));
    });

    it("different agents with same sessionId maintain separate path sets", () => {
      usePathResolutionStore
        .getState()
        .addResolvedPaths("claude:sess-1", ["/shared.ts"]);
      usePathResolutionStore
        .getState()
        .addResolvedPaths("codex:sess-1", ["/shared.ts", "/codex-only.ts"]);

      const state = usePathResolutionStore.getState();
      assert.strictEqual(state.resolvedPaths["claude:sess-1"].size, 1);
      assert.strictEqual(state.resolvedPaths["codex:sess-1"].size, 2);
    });
  });
});
