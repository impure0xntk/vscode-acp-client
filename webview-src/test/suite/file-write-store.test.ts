import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { useFileWriteStore } from "../../store/fileWriteStore";

describe("fileWriteStore", () => {
  beforeEach(() => {
    useFileWriteStore.setState({ writes: {}, nextSeq: 0 });
  });

  // ── addWrite ───────────────────────────────────────────────────────

  describe("addWrite", () => {
    it("stores a single write with seq=0", () => {
      useFileWriteStore.getState().addWrite("a1", "s1", "/foo.ts", "hello");
      const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(writes[0].path, "/foo.ts");
      assert.strictEqual(writes[0].content, "hello");
      assert.strictEqual(writes[0].seq, 0);
    });

    it("increments seq across writes", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "aaa");
      store.addWrite("a1", "s1", "/b.ts", "bbb");
      store.addWrite("a1", "s2", "/c.ts", "ccc");
      const s1 = useFileWriteStore.getState().getWritesForSession("a1", "s1");
      const s2 = useFileWriteStore.getState().getWritesForSession("a1", "s2");
      assert.strictEqual(s1[0].seq, 0);
      assert.strictEqual(s1[1].seq, 1);
      assert.strictEqual(s2[0].seq, 2); // global counter
    });

    it("appends multiple writes to the same session", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "aaa");
      store.addWrite("a1", "s1", "/b.ts", "bbb");
      const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
      assert.strictEqual(writes.length, 2);
    });

    it("isolates writes across different sessions", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "aaa");
      store.addWrite("a1", "s2", "/b.ts", "bbb");
      assert.strictEqual(
        useFileWriteStore.getState().getWritesForSession("a1", "s1").length, 1
      );
      assert.strictEqual(
        useFileWriteStore.getState().getWritesForSession("a1", "s2").length, 1
      );
    });
  });

  // ── currentSeq ────────────────────────────────────────────────────

  describe("currentSeq", () => {
    it("returns 0 initially", () => {
      assert.strictEqual(useFileWriteStore.getState().currentSeq(), 0);
    });

    it("increments after each addWrite", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "a");
      assert.strictEqual(useFileWriteStore.getState().currentSeq(), 1);
      store.addWrite("a1", "s1", "/b.ts", "b");
      assert.strictEqual(useFileWriteStore.getState().currentSeq(), 2);
    });
  });

  // ── getWritesForSession ────────────────────────────────────────────

  describe("getWritesForSession", () => {
    it("returns empty array for unknown session", () => {
      const writes = useFileWriteStore.getState().getWritesForSession("x", "y");
      assert.deepStrictEqual(writes, []);
    });
  });

  // ── clearSession ──────────────────────────────────────────────────

  describe("clearSession", () => {
    it("removes all writes for a session", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "a");
      store.addWrite("a1", "s1", "/b.ts", "b");
      store.clearSession("a1", "s1");
      assert.deepStrictEqual(
        useFileWriteStore.getState().getWritesForSession("a1", "s1"), []
      );
    });

    it("preserves seq counter after clear", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "a");
      store.clearSession("a1", "s1");
      store.addWrite("a1", "s1", "/b.ts", "b");
      const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(writes[0].seq, 1); // seq continues from global counter
    });

    it("does not affect other sessions", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "a");
      store.addWrite("a1", "s2", "/b.ts", "b");
      store.clearSession("a1", "s1");
      assert.strictEqual(
        useFileWriteStore.getState().getWritesForSession("a1", "s2").length, 1
      );
    });

    it("turn boundary: add → clear → add accumulates only post-clear writes", () => {
      const store = useFileWriteStore.getState();
      store.addWrite("a1", "s1", "/a.ts", "a");
      store.clearSession("a1", "s1");
      store.addWrite("a1", "s1", "/b.ts", "b");
      const writes = useFileWriteStore.getState().getWritesForSession("a1", "s1");
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(writes[0].path, "/b.ts");
    });
  });
});
