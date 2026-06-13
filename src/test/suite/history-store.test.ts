import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import type { HistoryEntry } from "../../application/session/historyStore";

// ============================================================================
// SessionHistoryStore Tests (pure logic, no Memento dependency)
// ============================================================================

/**
 * In-memory implementation of the history store logic for testing.
 * Mirrors SessionHistoryStore behavior without VS Code Memento.
 */
class InMemoryHistoryStore {
  private entries: HistoryEntry[] = [];

  addEntry(entry: HistoryEntry): void {
    const sanitized = {
      ...entry,
      lastMessage: entry.lastMessage
        ? entry.lastMessage.length > 200
          ? entry.lastMessage.slice(0, 200)
          : entry.lastMessage
        : undefined,
    };
    this.entries.unshift(sanitized);
    if (this.entries.length > 200) {
      this.entries.length = 200;
    }
  }

  getEntries(): HistoryEntry[] {
    return [...this.entries];
  }

  search(query: string): HistoryEntry[] {
    const q = query.toLowerCase();
    return this.entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.lastMessage?.toLowerCase().includes(q) ?? false) ||
        e.agentId.toLowerCase().includes(q) ||
        e.sessionId.toLowerCase().includes(q)
    );
  }

  getEntriesByAgent(agentId: string): HistoryEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  getEntry(sessionId: string): HistoryEntry | undefined {
    return this.entries.find((e) => e.sessionId === sessionId);
  }

  upsertEntry(entry: HistoryEntry): void {
    const idx = this.entries.findIndex((e) => e.sessionId === entry.sessionId);
    const sanitized = {
      ...entry,
      lastMessage: entry.lastMessage
        ? entry.lastMessage.length > 200
          ? entry.lastMessage.slice(0, 200)
          : entry.lastMessage
        : undefined,
    };
    if (idx >= 0) {
      this.entries[idx] = sanitized;
    } else {
      this.addEntry(entry);
    }
  }

  removeEntry(sessionId: string): void {
    this.entries = this.entries.filter((e) => e.sessionId !== sessionId);
  }

  clear(): void {
    this.entries = [];
  }
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sessionId: "sess-1",
    agentId: "claude",
    title: "Test Session",
    cwd: "/home/user/project",
    status: "idle",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    messageCount: 5,
    tokenUsage: { input: 100, output: 50, total: 150 },
    ...overrides,
  };
}

describe("InMemoryHistoryStore — CRUD", () => {
  let store: InMemoryHistoryStore;

  beforeEach(() => {
    store = new InMemoryHistoryStore();
  });

  it("addEntry prepends entry", () => {
    store.addEntry(makeEntry({ sessionId: "s1" }));
    store.addEntry(makeEntry({ sessionId: "s2" }));
    const entries = store.getEntries();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].sessionId, "s2");
    assert.strictEqual(entries[1].sessionId, "s1");
  });

  it("getEntries returns empty initially", () => {
    assert.strictEqual(store.getEntries().length, 0);
  });

  it("getEntry finds by sessionId", () => {
    store.addEntry(makeEntry({ sessionId: "target" }));
    const entry = store.getEntry("target");
    assert.ok(entry);
    assert.strictEqual(entry!.sessionId, "target");
  });

  it("getEntry returns undefined for unknown sessionId", () => {
    assert.strictEqual(store.getEntry("unknown"), undefined);
  });

  it("removeEntry removes by sessionId", () => {
    store.addEntry(makeEntry({ sessionId: "keep" }));
    store.addEntry(makeEntry({ sessionId: "remove" }));
    store.removeEntry("remove");
    assert.strictEqual(store.getEntries().length, 1);
    assert.strictEqual(store.getEntries()[0].sessionId, "keep");
  });

  it("clear removes all entries", () => {
    store.addEntry(makeEntry({ sessionId: "s1" }));
    store.addEntry(makeEntry({ sessionId: "s2" }));
    store.clear();
    assert.strictEqual(store.getEntries().length, 0);
  });
});

describe("InMemoryHistoryStore — Upsert", () => {
  let store: InMemoryHistoryStore;

  beforeEach(() => {
    store = new InMemoryHistoryStore();
  });

  it("upsertEntry inserts when not exists", () => {
    store.upsertEntry(makeEntry({ sessionId: "new" }));
    assert.strictEqual(store.getEntries().length, 1);
  });

  it("upsertEntry replaces when exists", () => {
    store.addEntry(makeEntry({ sessionId: "s1", title: "Original" }));
    store.upsertEntry(makeEntry({ sessionId: "s1", title: "Updated" }));
    assert.strictEqual(store.getEntries().length, 1);
    assert.strictEqual(store.getEntries()[0].title, "Updated");
  });
});

describe("InMemoryHistoryStore — Search", () => {
  let store: InMemoryHistoryStore;

  beforeEach(() => {
    store = new InMemoryHistoryStore();
    store.addEntry(
      makeEntry({ sessionId: "s1", title: "React Project", agentId: "claude" })
    );
    store.addEntry(
      makeEntry({ sessionId: "s2", title: "Python API", agentId: "gpt4" })
    );
    store.addEntry(
      makeEntry({ sessionId: "s3", title: "Rust CLI", agentId: "claude" })
    );
  });

  it("search by title", () => {
    const results = store.search("react");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].sessionId, "s1");
  });

  it("search by agentId", () => {
    const results = store.search("claude");
    assert.strictEqual(results.length, 2);
  });

  it("search is case-insensitive", () => {
    const results = store.search("PYTHON");
    assert.strictEqual(results.length, 1);
  });

  it("search returns empty for no match", () => {
    assert.strictEqual(store.search("nonexistent").length, 0);
  });

  it("getEntriesByAgent filters correctly", () => {
    assert.strictEqual(store.getEntriesByAgent("claude").length, 2);
    assert.strictEqual(store.getEntriesByAgent("gpt4").length, 1);
    assert.strictEqual(store.getEntriesByAgent("unknown").length, 0);
  });
});

describe("InMemoryHistoryStore — Truncation", () => {
  it("truncates lastMessage to 200 characters", () => {
    const store = new InMemoryHistoryStore();
    const longMsg = "a".repeat(300);
    store.addEntry(makeEntry({ lastMessage: longMsg }));
    const entry = store.getEntries()[0];
    assert.strictEqual(entry.lastMessage!.length, 200);
  });

  it("does not truncate short messages", () => {
    const store = new InMemoryHistoryStore();
    store.addEntry(makeEntry({ lastMessage: "short" }));
    assert.strictEqual(store.getEntries()[0].lastMessage, "short");
  });
});

describe("InMemoryHistoryStore — FIFO Eviction", () => {
  it("evicts oldest when exceeding 200 entries", () => {
    const store = new InMemoryHistoryStore();
    for (let i = 0; i < 205; i++) {
      store.addEntry(makeEntry({ sessionId: `s${i}` }));
    }
    const entries = store.getEntries();
    assert.strictEqual(entries.length, 200);
    // Newest should be first
    assert.strictEqual(entries[0].sessionId, "s204");
    // Oldest 5 should be evicted (s0-s4)
    assert.strictEqual(store.getEntry("s0"), undefined);
    assert.strictEqual(store.getEntry("s4"), undefined);
    // s5 should still exist
    assert.ok(store.getEntry("s5"));
  });
});
