import * as assert from "assert";
import { describe, it } from "mocha";
import type { ChatMessage } from "../../types";

// ── Pure function under test (extracted from SessionView logic) ─────────────

interface UnreadResult {
  unreadCount: number;
  firstUnreadId: string | null;
}

function deriveUnread(
  readUpToId: string | null,
  messages: ChatMessage[]
): UnreadResult {
  if (messages.length === 0) {
    return { unreadCount: 0, firstUnreadId: null };
  }
  if (!readUpToId) {
    return {
      unreadCount: messages.length,
      firstUnreadId: messages[0].id,
    };
  }
  const idx = messages.findIndex((m) => m.id === readUpToId);
  if (idx < 0 || idx + 1 >= messages.length) {
    return { unreadCount: 0, firstUnreadId: null };
  }
  return {
    unreadCount: messages.length - idx - 1,
    firstUnreadId: messages[idx + 1].id,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let counter = 0;
function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  counter++;
  return {
    id: `msg-${counter}`,
    role: "agent",
    content: `content-${counter}`,
    timestamp: Date.now() + counter,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("deriveUnread", () => {
  it("returns 0 unread when messages array is empty", () => {
    const result = deriveUnread(null, []);
    assert.strictEqual(result.unreadCount, 0);
    assert.strictEqual(result.firstUnreadId, null);
  });

  it("returns all messages as unread when readUpToId is null", () => {
    const msgs = [makeMessage(), makeMessage(), makeMessage()];
    const result = deriveUnread(null, msgs);
    assert.strictEqual(result.unreadCount, 3);
    assert.strictEqual(result.firstUnreadId, msgs[0].id);
  });

  it("returns 0 unread when readUpToId is the last message", () => {
    const msgs = [makeMessage(), makeMessage(), makeMessage()];
    const result = deriveUnread(msgs[2].id, msgs);
    assert.strictEqual(result.unreadCount, 0);
    assert.strictEqual(result.firstUnreadId, null);
  });

  it("returns correct count when readUpToId is in the middle", () => {
    const msgs = [makeMessage(), makeMessage(), makeMessage(), makeMessage()];
    const result = deriveUnread(msgs[1].id, msgs);
    assert.strictEqual(result.unreadCount, 2);
    assert.strictEqual(result.firstUnreadId, msgs[2].id);
  });

  it("returns 1 unread when readUpToId is second-to-last", () => {
    const msgs = [makeMessage(), makeMessage(), makeMessage()];
    const result = deriveUnread(msgs[1].id, msgs);
    assert.strictEqual(result.unreadCount, 1);
    assert.strictEqual(result.firstUnreadId, msgs[2].id);
  });

  it("returns 0 unread when readUpToId is not found in messages", () => {
    const msgs = [makeMessage(), makeMessage()];
    const result = deriveUnread("nonexistent-id", msgs);
    assert.strictEqual(result.unreadCount, 0);
    assert.strictEqual(result.firstUnreadId, null);
  });

  it("handles single message with null readUpToId", () => {
    const msgs = [makeMessage()];
    const result = deriveUnread(null, msgs);
    assert.strictEqual(result.unreadCount, 1);
    assert.strictEqual(result.firstUnreadId, msgs[0].id);
  });

  it("handles single message read (readUpToId = only message)", () => {
    const msgs = [makeMessage()];
    const result = deriveUnread(msgs[0].id, msgs);
    assert.strictEqual(result.unreadCount, 0);
    assert.strictEqual(result.firstUnreadId, null);
  });

  it("handles readUpToId being the first message", () => {
    const msgs = [makeMessage(), makeMessage(), makeMessage()];
    const result = deriveUnread(msgs[0].id, msgs);
    assert.strictEqual(result.unreadCount, 2);
    assert.strictEqual(result.firstUnreadId, msgs[1].id);
  });

  it("handles large message arrays", () => {
    const msgs = Array.from({ length: 100 }, () => makeMessage());
    const result = deriveUnread(msgs[49].id, msgs);
    assert.strictEqual(result.unreadCount, 50);
    assert.strictEqual(result.firstUnreadId, msgs[50].id);
  });
});
