import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import initSqlJs from "sql.js";
import { PersistentHistoryStore } from "../../application/session/persistentHistory";
import { SCHEMA_SQL } from "../../application/session/schema";
import type { ChatMessage, TokenUsage }from "../../domain/models/chat";
import type { SessionInfo } from "../../application/session/types";

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 10)}`,
    role: "user",
    content: "Hello",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: "sess-original",
    agentId: "claude",
    title: "Test Session",
    cwd: "/home/user/project",
    status: "completed",
    messages: [],
    isTurnActive: false,
    isStreaming: false,
    tokenUsage: { input: 100, output: 50, total: 150 },
    createdAt: new Date(),
    updatedAt: new Date(),
    pendingCancel: false,
    ...overrides,
  };
}

/**
 * Create a temporary PersistentHistoryStore with an in-memory database.
 * Uses sql.js directly to avoid WASM file resolution issues in tests.
 */
async function createTempStore(): Promise<{
  store: PersistentHistoryStore;
  dbPath: string;
  cleanup: () => void;
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-test-"));
  const dbPath = path.join(tmpDir, "test.db");

  // Pre-initialize with schema using raw sql.js
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(SCHEMA_SQL);

  // Write initial DB to disk so PersistentHistoryStore can load it
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();

  const store = new PersistentHistoryStore();
  // Override the internal dbPath after initialize
  await store.initialize(tmpDir);

  return {
    store,
    dbPath,
    cleanup: () => {
      store.dispose();
      try {
        fs.unlinkSync(dbPath);
        fs.rmdirSync(tmpDir);
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

// ============================================================================
// Data Model Compatibility: PersistentHistory → SessionInfo
// ============================================================================

describe("PersistentHistory → SessionInfo data model compatibility", () => {
  /**
   * The restore flow reads messages from PersistentHistoryStore and appends
   * them to a new SessionInfo via appendMessageSilent. This test verifies
   * that the types are structurally compatible for that operation.
   */

  it("rowToMessage produces a structurally valid ChatMessage", () => {
    const msg = makeMessage({
      id: "test-msg-1",
      role: "agent",
      content: "Hello from agent",
      timestamp: 1700000000000,
      toolCalls: [
        {
          id: "tc-1",
          title: "Read file",
          status: "completed",
          kind: "read",
          input: '{"path": "src/index.ts"}',
          output: "file content",
        },
      ],
      agentId: "claude",
      sessionId: "sess-1",
    });

    // Simulate what serializeMessageForStorage does
    const serialized: ChatMessage = { ...msg };
    if (msg.toolCalls) {
      serialized.toolCallsJson = JSON.stringify(msg.toolCalls);
    }

    // Simulate what PersistentHistoryStore.rowToMessage does on retrieval
    const restored: ChatMessage = {
      id: serialized.id,
      role: serialized.role,
      content: serialized.content,
      timestamp: serialized.timestamp,
      toolCallsJson: serialized.toolCallsJson,
      agentId: serialized.agentId,
      sessionId: serialized.sessionId,
    };

    assert.strictEqual(restored.id, msg.id);
    assert.strictEqual(restored.role, msg.role);
    assert.strictEqual(restored.content, msg.content);
    assert.strictEqual(restored.timestamp, msg.timestamp);
    assert.strictEqual(restored.agentId, "claude");
    assert.strictEqual(restored.sessionId, "sess-1");
    assert.ok(restored.toolCallsJson);

    // Verify the JSON can be parsed back to the original tool calls
    const parsed = JSON.parse(restored.toolCallsJson!);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].id, "tc-1");
    assert.strictEqual(parsed[0].kind, "read");
  });

  it("serialized round-trip preserves role, content, timestamp", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Hi", timestamp: 1000 },
      { id: "m2", role: "agent", content: "Hello!", timestamp: 1001 },
      { id: "m3", role: "system", content: "Context attached", timestamp: 999 },
      { id: "m4", role: "tool", content: "", timestamp: 1002 },
    ];

    for (const msg of messages) {
      // serialize (as PersistentHistoryStore.saveMessages does)
      const serialized: ChatMessage = { ...msg };
      if (msg.toolCalls) {
        serialized.toolCallsJson = JSON.stringify(msg.toolCalls);
      }

      // deserialize (as rowToMessage does)
      const restored: ChatMessage = {
        id: serialized.id,
        role: serialized.role,
        content: serialized.content,
        timestamp: serialized.timestamp,
        toolCallsJson: serialized.toolCallsJson,
      };

      assert.strictEqual(restored.role, msg.role);
      assert.strictEqual(restored.content, msg.content);
      assert.strictEqual(restored.timestamp, msg.timestamp);
    }
  });

  it("TokenUsage types are compatible between PersistentSessionEntry and SessionInfo", () => {
    const entryTokenUsage: TokenUsage = { input: 500, output: 200, total: 700 };
    const sessionTokenUsage: TokenUsage = { input: 0, output: 0, total: 0 };

    // Verify structural compatibility (both have input/output/total: number)
    sessionTokenUsage.input = entryTokenUsage.input;
    sessionTokenUsage.output = entryTokenUsage.output;
    sessionTokenUsage.total = entryTokenUsage.total;

    assert.strictEqual(sessionTokenUsage.input, 500);
    assert.strictEqual(sessionTokenUsage.output, 200);
    assert.strictEqual(sessionTokenUsage.total, 700);
  });

  it("SessionStatus values are compatible between PersistentSessionEntry and SessionInfo", () => {
    const validStatuses = ["idle", "running", "completed", "error", "cancelled"];
    for (const status of validStatuses) {
      // Both types accept the same status strings
      const entryStatus = status as SessionInfo["status"];
      assert.ok(validStatuses.includes(entryStatus));
    }
  });

  it("ChatMessage roles match across storage and runtime", () => {
    const validRoles: ChatMessage["role"][] = [
      "user",
      "agent",
      "system",
      "tool",
    ];
    for (const role of validRoles) {
      const msg: ChatMessage = { id: "x", role, content: "", timestamp: 0 };
      assert.strictEqual(msg.role, role);
    }
  });
});

// ============================================================================
// Restore Integration: save session → store → retrieve → reconstruct
// ============================================================================

describe("Restore Integration — save, retrieve, reconstruct", () => {
  let cleanup: (() => void) | null = null;
  let store: PersistentHistoryStore;

  beforeEach(async () => {
    const result = await createTempStore();
    store = result.store;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup?.();
  });

  it("full round-trip: SessionInfo → save → getSessionMessages → ChatMessage[]", async () => {
    const messages = [
      makeMessage({ id: "m1", role: "user", content: "Hello", timestamp: 1000 }),
      makeMessage({ id: "m2", role: "agent", content: "Hi there!", timestamp: 1001 }),
      makeMessage({ id: "m3", role: "user", content: "What is 2+2?", timestamp: 1002 }),
      makeMessage({ id: "m4", role: "agent", content: "4", timestamp: 1003 }),
    ];

    const session = makeSession({
      sessionId: "sess-restore-1",
      messages,
      tokenUsage: { input: 300, output: 150, total: 450 },
    });

    // saveSession is debounced (1000ms) — flush first so the session row
    // with correct tokenUsage exists before saveMessages updates message_count.
    store.saveSession(session);
    await new Promise((r) => setTimeout(r, 1100));

    // serializeMessageForStorage: toolCalls → toolCallsJson
    const serialized = messages.map((m) => {
      const s: ChatMessage = { ...m };
      if (m.toolCalls) s.toolCallsJson = JSON.stringify(m.toolCalls);
      return s;
    });
    await store.saveMessages("sess-restore-1", serialized);

    // Retrieve (as restore command does)
    const { messages: retrieved, tokenUsage } =
      store.getSessionMessages("sess-restore-1");

    assert.strictEqual(retrieved.length, 4);
    assert.strictEqual(retrieved[0].content, "Hello");
    assert.strictEqual(retrieved[1].content, "Hi there!");
    assert.strictEqual(retrieved[2].content, "What is 2+2?");
    assert.strictEqual(retrieved[3].content, "4");

    // Token usage from session metadata (written by saveSession flush)
    assert.strictEqual(tokenUsage.input, 300);
    assert.strictEqual(tokenUsage.output, 150);
    assert.strictEqual(tokenUsage.total, 450);
  });

  it("restore preserves message order (timestamp ASC)", async () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "First", timestamp: 3000 },
      { id: "m2", role: "user", content: "Second", timestamp: 1000 },
      { id: "m3", role: "user", content: "Third", timestamp: 2000 },
    ];

    const session = makeSession({ sessionId: "sess-order" });
    store.saveSession(session);
    await new Promise((r) => setTimeout(r, 1100));
    await store.saveMessages("sess-order", messages);

    const { messages: retrieved } = store.getSessionMessages("sess-order");

    // Should be ordered by timestamp ASC regardless of insertion order
    assert.strictEqual(retrieved[0].content, "Second");
    assert.strictEqual(retrieved[1].content, "Third");
    assert.strictEqual(retrieved[2].content, "First");
  });

  it("restore preserves tool calls via JSON serialization", async () => {
    const toolCalls = [
      {
        id: "tc-1",
        title: "Edit file",
        status: "completed" as const,
        kind: "edit",
        input: '{"path": "src/main.ts"}',
        output: "File updated",
        locations: [{ path: "src/main.ts", line: 10 }],
        diffContent: { newText: "new line", oldText: "old line", path: "src/main.ts" },
      },
    ];

    // Build messages as they would look after serializeMessageForStorage
    // (saveMessages reads toolCallsJson from the message, not toolCalls)
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Fix the bug", timestamp: 1000 },
      {
        id: "m2",
        role: "tool",
        content: "",
        timestamp: 1001,
        toolCallsJson: JSON.stringify(toolCalls),
      },
      { id: "m3", role: "agent", content: "Done!", timestamp: 1002 },
    ];

    const session = makeSession({ sessionId: "sess-toolcalls" });
    store.saveSession(session);
    await new Promise((r) => setTimeout(r, 1100));
    await store.saveMessages("sess-toolcalls", messages);

    const { messages: retrieved } = store.getSessionMessages("sess-toolcalls");

    assert.strictEqual(retrieved.length, 3);

    // The tool message should have toolCallsJson (serialized form)
    const toolMsg = retrieved[1];
    assert.strictEqual(toolMsg.role, "tool");
    assert.ok(toolMsg.toolCallsJson);

    const parsed = JSON.parse(toolMsg.toolCallsJson!);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].id, "tc-1");
    assert.strictEqual(parsed[0].kind, "edit");
    assert.strictEqual(parsed[0].status, "completed");
    assert.deepStrictEqual(parsed[0].locations, [{ path: "src/main.ts", line: 10 }]);
    assert.deepStrictEqual(parsed[0].diffContent, {
      newText: "new line",
      oldText: "old line",
      path: "src/main.ts",
    });
  });

  it("restore preserves inlineFilePaths and sessionCwd", async () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: "Check these files",
        timestamp: 1000,
        inlineFilePaths: ["src/a.ts", "src/b.ts"],
        sessionCwd: "/home/user/project",
      },
    ];

    const session = makeSession({ sessionId: "sess-meta" });
    store.saveSession(session);
    await new Promise((r) => setTimeout(r, 1100));
    await store.saveMessages("sess-meta", messages);

    const { messages: retrieved } = store.getSessionMessages("sess-meta");

    assert.strictEqual(retrieved[0].inlineFilePaths?.length, 2);
    assert.strictEqual(retrieved[0].inlineFilePaths?.[0], "src/a.ts");
    assert.strictEqual(retrieved[0].sessionCwd, "/home/user/project");
  });

  it("restore reconstructs SessionInfo-compatible message array", async () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Hi", timestamp: 1000 },
      { id: "m2", role: "agent", content: "Hello!", timestamp: 1001 },
    ];

    const session = makeSession({ sessionId: "sess-reconstruct" });
    store.saveSession(session);
    await new Promise((r) => setTimeout(r, 1100));
    await store.saveMessages("sess-reconstruct", messages);

    const { messages: retrieved } = store.getSessionMessages("sess-reconstruct");

    // Simulate what the restore command does: appendMessageSilent for each
    const newSession = makeSession({
      sessionId: "sess-new",
      messages: [],
    });

    for (const msg of retrieved) {
      newSession.messages.push(msg);
    }

    assert.strictEqual(newSession.messages.length, 2);
    assert.strictEqual(newSession.messages[0].role, "user");
    assert.strictEqual(newSession.messages[1].role, "agent");
  });

  it("getSessionMessages returns empty for unknown session", () => {
    const result = store.getSessionMessages("nonexistent");
    assert.strictEqual(result.messages.length, 0);
    assert.deepStrictEqual(result.tokenUsage, { input: 0, output: 0, total: 0 });
  });

  it("saveMessages is idempotent (duplicate calls don't duplicate)", async () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", content: "Hi", timestamp: 1000 },
    ];

    const session = makeSession({ sessionId: "sess-idempotent" });
    store.saveSession(session);
    await new Promise((r) => setTimeout(r, 1100));

    // Save same messages twice
    await store.saveMessages("sess-idempotent", messages);
    await store.saveMessages("sess-idempotent", messages);

    const { messages: retrieved } = store.getSessionMessages("sess-idempotent");
    assert.strictEqual(retrieved.length, 1);
  });
});

// ============================================================================
// Restore Command Logic (pure function test)
// ============================================================================

describe("Restore command — message reconstruction logic", () => {
  it("serialized ChatMessage can be appended to SessionInfo.messages", () => {
    // Simulates the full restore pipeline:
    // 1. Create original messages with tool calls
    const originalMessages: ChatMessage[] = [
      {
        id: "msg-1",
        role: "user",
        content: "Fix the bug in src/main.ts",
        timestamp: 1000,
        agentId: "claude",
        sessionId: "sess-original",
      },
      {
        id: "msg-2",
        role: "agent",
        content: "Let me read the file first.",
        timestamp: 1001,
        agentId: "claude",
        sessionId: "sess-original",
      },
      {
        id: "msg-3",
        role: "tool",
        content: "",
        timestamp: 1002,
        agentId: "claude",
        sessionId: "sess-original",
        toolCalls: [
          {
            id: "tc-read-1",
            title: "Read file",
            status: "completed",
            kind: "read",
            input: '{"path": "src/main.ts"}',
            output: "const x = 1;\nconst y = 2;",
          },
        ],
      },
      {
        id: "msg-4",
        role: "agent",
        content: "I found the bug. Let me fix it.",
        timestamp: 1003,
        agentId: "claude",
        sessionId: "sess-original",
      },
    ];

    // 2. Serialize for storage (as serializeMessageForStorage does)
    const serialized = originalMessages.map((msg) => {
      const stored: ChatMessage = { ...msg };
      if (msg.toolCalls) {
        stored.toolCallsJson = JSON.stringify(msg.toolCalls);
      }
      return stored;
    });

    // 3. Deserialize from storage (as rowToMessage does)
    const restored = serialized.map((s) => ({
      id: s.id,
      role: s.role,
      content: s.content,
      timestamp: s.timestamp,
      toolCallsJson: s.toolCallsJson,
      agentId: s.agentId,
      sessionId: s.sessionId,
    }));

    // 4. Append to new session (as appendMessageSilent does)
    const newMessages: ChatMessage[] = [];
    for (const msg of restored) {
      newMessages.push(msg);
    }

    assert.strictEqual(newMessages.length, 4);
    assert.strictEqual(newMessages[0].role, "user");
    assert.strictEqual(newMessages[1].role, "agent");
    assert.strictEqual(newMessages[2].role, "tool");
    assert.strictEqual(newMessages[3].role, "agent");

    // Verify tool call data survived the round-trip
    const toolMsg = newMessages[2];
    assert.ok(toolMsg.toolCallsJson);
    const parsedTC = JSON.parse(toolMsg.toolCallsJson!);
    assert.strictEqual(parsedTC[0].title, "Read file");
    assert.strictEqual(parsedTC[0].kind, "read");
  });

  it("messages without toolCalls don't get toolCallsJson", () => {
    const msg: ChatMessage = {
      id: "plain-msg",
      role: "user",
      content: "Hello",
      timestamp: 1000,
    };

    const serialized: ChatMessage = { ...msg };
    if (msg.toolCalls) {
      serialized.toolCallsJson = JSON.stringify(msg.toolCalls);
    }

    assert.strictEqual(serialized.toolCallsJson, undefined);
  });

  it("empty content messages are preserved (tool messages)", () => {
    const msg: ChatMessage = {
      id: "tool-msg",
      role: "tool",
      content: "",
      timestamp: 1000,
      toolCallsJson: '[{"id":"tc-1"}]',
    };

    const restored = {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      toolCallsJson: msg.toolCallsJson,
    };

    assert.strictEqual(restored.content, "");
    assert.strictEqual(restored.role, "tool");
    assert.ok(restored.toolCallsJson);
  });
});
