import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useScrollStateStore } from "../../store/scrollStateStore";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeScrollState(
  overrides: {
    scrollTop?: number;
    readUpToMessageId?: string | null;
    isAtBottom?: boolean;
  } = {}
) {
  return {
    scrollTop: overrides.scrollTop ?? 0,
    readUpToMessageId: overrides.readUpToMessageId ?? null,
    isAtBottom: overrides.isAtBottom ?? true,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("scrollStateStore", () => {
  beforeEach(() => {
    useScrollStateStore.setState({ perSession: {} });
  });

  // ── setScrollTop ──────────────────────────────────────────────────────

  describe("setScrollTop", () => {
    it("sets scrollTop for a new session key", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 150);
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].scrollTop, 150);
    });

    it("updates scrollTop for an existing session key", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 100);
      useScrollStateStore.getState().setScrollTop("a:1", 200);
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].scrollTop, 200);
    });

    it("is a no-op when setting the same scrollTop value", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 100);
      const ref1 = useScrollStateStore.getState().perSession;
      useScrollStateStore.getState().setScrollTop("a:1", 100);
      const ref2 = useScrollStateStore.getState().perSession;
      assert.strictEqual(ref1, ref2);
    });

    it("preserves other fields when updating scrollTop", () => {
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-5");
      useScrollStateStore.getState().setIsAtBottom("a:1", false);
      useScrollStateStore.getState().setScrollTop("a:1", 42);
      const entry = useScrollStateStore.getState().perSession["a:1"];
      assert.strictEqual(entry.scrollTop, 42);
      assert.strictEqual(entry.readUpToMessageId, "msg-5");
      assert.strictEqual(entry.isAtBottom, false);
    });
  });

  // ── setReadUpTo ───────────────────────────────────────────────────────

  describe("setReadUpTo", () => {
    it("sets readUpToMessageId for a new session key", () => {
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-10");
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].readUpToMessageId, "msg-10");
    });

    it("updates readUpToMessageId", () => {
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-1");
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-99");
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].readUpToMessageId, "msg-99");
    });

    it("can set readUpToMessageId to null", () => {
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-1");
      useScrollStateStore.getState().setReadUpTo("a:1", null);
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].readUpToMessageId, null);
    });

    it("is a no-op when setting the same readUpToMessageId", () => {
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-5");
      const ref1 = useScrollStateStore.getState().perSession;
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-5");
      const ref2 = useScrollStateStore.getState().perSession;
      assert.strictEqual(ref1, ref2);
    });
  });

  // ── setIsAtBottom ─────────────────────────────────────────────────────

  describe("setIsAtBottom", () => {
    it("sets isAtBottom for a new session key", () => {
      useScrollStateStore.getState().setIsAtBottom("a:1", false);
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].isAtBottom, false);
    });

    it("updates isAtBottom", () => {
      useScrollStateStore.getState().setIsAtBottom("a:1", true);
      useScrollStateStore.getState().setIsAtBottom("a:1", false);
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].isAtBottom, false);
    });

    it("is a no-op when setting the same isAtBottom value", () => {
      useScrollStateStore.getState().setIsAtBottom("a:1", false);
      const ref1 = useScrollStateStore.getState().perSession;
      useScrollStateStore.getState().setIsAtBottom("a:1", false);
      const ref2 = useScrollStateStore.getState().perSession;
      assert.strictEqual(ref1, ref2);
    });
  });

  // ── removeSession ─────────────────────────────────────────────────────

  describe("removeSession", () => {
    it("removes a session entry", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 100);
      useScrollStateStore.getState().removeSession("a:1");
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"], undefined);
    });

    it("is a no-op when removing a non-existent key", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 100);
      const ref1 = useScrollStateStore.getState().perSession;
      useScrollStateStore.getState().removeSession("nonexistent");
      const ref2 = useScrollStateStore.getState().perSession;
      assert.strictEqual(ref1, ref2);
    });

    it("does not affect other sessions", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 100);
      useScrollStateStore.getState().setScrollTop("b:2", 200);
      useScrollStateStore.getState().removeSession("a:1");
      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"], undefined);
      assert.strictEqual(state["b:2"].scrollTop, 200);
    });
  });

  // ── Cross-session isolation ───────────────────────────────────────────

  describe("cross-session isolation", () => {
    it("maintains independent state per session key", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 10);
      useScrollStateStore.getState().setScrollTop("b:2", 20);
      useScrollStateStore.getState().setReadUpTo("a:1", "m1");
      useScrollStateStore.getState().setReadUpTo("b:2", "m2");
      useScrollStateStore.getState().setIsAtBottom("a:1", true);
      useScrollStateStore.getState().setIsAtBottom("b:2", false);

      const state = useScrollStateStore.getState().perSession;
      assert.strictEqual(state["a:1"].scrollTop, 10);
      assert.strictEqual(state["a:1"].readUpToMessageId, "m1");
      assert.strictEqual(state["a:1"].isAtBottom, true);
      assert.strictEqual(state["b:2"].scrollTop, 20);
      assert.strictEqual(state["b:2"].readUpToMessageId, "m2");
      assert.strictEqual(state["b:2"].isAtBottom, false);
    });
  });

  // ── Default values ────────────────────────────────────────────────────

  describe("default values for new entries", () => {
    it("initializes with default scrollTop=0 when setting readUpTo first", () => {
      useScrollStateStore.getState().setReadUpTo("a:1", "msg-1");
      const entry = useScrollStateStore.getState().perSession["a:1"];
      assert.strictEqual(entry.scrollTop, 0);
      assert.strictEqual(entry.isAtBottom, true);
    });

    it("initializes with default isAtBottom=true when setting scrollTop first", () => {
      useScrollStateStore.getState().setScrollTop("a:1", 50);
      const entry = useScrollStateStore.getState().perSession["a:1"];
      assert.strictEqual(entry.isAtBottom, true);
      assert.strictEqual(entry.readUpToMessageId, null);
    });
  });
});
