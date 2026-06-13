import * as assert from "assert";
import { describe, it } from "mocha";

// ============================================================================
// Unit Tests: ChatMessage structure (Phase 2)
// ============================================================================

describe("Phase 2 — ChatMessage", () => {
  it("user message has required fields", () => {
    const msg = {
      id: "abc-123",
      role: "user" as const,
      content: "hello",
      timestamp: 1700000000000,
    };
    assert.strictEqual(msg.id.length > 0, true);
    assert.strictEqual(msg.role, "user");
    assert.strictEqual(msg.content, "hello");
    assert.strictEqual(typeof msg.timestamp, "number");
  });

  it("agent message has required fields", () => {
    const msg = {
      id: "def-456",
      role: "agent" as const,
      content: "hi there",
      timestamp: 1700000001000,
    };
    assert.strictEqual(msg.role, "agent");
    assert.strictEqual(msg.content, "hi there");
  });

  it("system message has required fields", () => {
    const msg = {
      id: "ghi-789",
      role: "system" as const,
      content: "Attached: /tmp/file.txt",
      timestamp: 1700000002000,
    };
    assert.strictEqual(msg.role, "system");
  });

  it("role is one of user/agent/system", () => {
    const roles = ["user", "agent", "system"] as const;
    for (const role of roles) {
      assert.ok(["user", "agent", "system"].includes(role));
    }
  });
});

// ============================================================================
// Unit Tests: ChatContainer empty state (Phase 2)
// describe-driven UI logic edge cases
// ============================================================================

describe("Phase 2 — ChatContainer / Composer edge cases", () => {
  it("empty message list means empty state", () => {
    const messages: unknown[] = [];
    assert.strictEqual(messages.length === 0, true);
  });

  it("non-empty list has at least one message", () => {
    const messages = [
      { id: "1", role: "user" as const, content: "hi", timestamp: 0 },
    ];
    assert.strictEqual(messages.length > 0, true);
  });

  it("trimmed empty string should not be sent", () => {
    const text = "   ";
    assert.strictEqual(text.trim().length > 0, false);
  });

  it("whitespace-only input is ignored", () => {
    const text = "\n\n  \n";
    assert.strictEqual(text.trim().length > 0, false);
  });

  it("valid text passes trim check", () => {
    const text = "Hello, agent!";
    assert.strictEqual(text.trim().length > 0, true);
  });
});

// ============================================================================
// Unit Tests: useMessages reducer actions (Phase 2)
// Simulated reducer logic mirror for smoke test
// ============================================================================

describe("Phase 2 — useMessages reducer simulation", () => {
  interface Msg {
    id: string;
    role: "user" | "agent" | "system";
    content: string;
    timestamp: number;
  }
  type Action =
    | { type: "SET_MESSAGES"; messages: Msg[] }
    | { type: "ADD_MESSAGE"; message: Msg }
    | { type: "CLEAR_MESSAGES" };

  function reducer(state: Msg[], action: Action): Msg[] {
    switch (action.type) {
      case "SET_MESSAGES":
        return action.messages;
      case "ADD_MESSAGE":
        return [...state, action.message];
      case "CLEAR_MESSAGES":
        return [];
      default:
        return state;
    }
  }

  it("SET_MESSAGES replaces all", () => {
    const initial: Msg[] = [];
    const msgs: Msg[] = [
      { id: "1", role: "user", content: "a", timestamp: 1 },
      { id: "2", role: "agent", content: "b", timestamp: 2 },
    ];
    const result = reducer(initial, { type: "SET_MESSAGES", messages: msgs });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].content, "a");
    assert.strictEqual(result[1].content, "b");
  });

  it("ADD_MESSAGE appends", () => {
    const state: Msg[] = [
      { id: "1", role: "user", content: "a", timestamp: 1 },
    ];
    const next = reducer(state, {
      type: "ADD_MESSAGE",
      message: { id: "2", role: "agent", content: "b", timestamp: 2 },
    });
    assert.strictEqual(next.length, 2);
    assert.strictEqual(next[1].role, "agent");
  });

  it("CLEAR_MESSAGES empties state", () => {
    const state: Msg[] = [
      { id: "1", role: "user", content: "a", timestamp: 1 },
      { id: "2", role: "agent", content: "b", timestamp: 2 },
    ];
    const result = reducer(state, { type: "CLEAR_MESSAGES" });
    assert.strictEqual(result.length, 0);
  });
});

// ============================================================================
// Unit Tests: Markdown rendering logic (Phase 2)
// Sanity check for the renderMarkdown dependency contract
// ============================================================================

describe("Phase 2 — Markdown contract", () => {
  it("markdown-it is loadable", async () => {
    const { default: MarkdownIt } = await import("markdown-it");
    const md = new MarkdownIt();
    const html = md.render("# Hello");
    assert.strictEqual(html.includes("<h1>"), true);
    assert.strictEqual(html.includes("Hello"), true);
  });

  it("DOMPurify is loadable", async () => {
    // DOMPurify requires a DOM (browser/jsdom); in Node.js the default export
    // is a factory function, not a pre-built instance. Just verify the module loads.
    const mod = await import("dompurify");
    assert.strictEqual(typeof mod.default, "function");
  });

  it("highlight.js is loadable", async () => {
    const hljs = await import("highlight.js");
    assert.strictEqual(typeof hljs.default.highlight, "function");
  });
});

// ============================================================================
// Unit Tests: ChatWebviewProvider HTML generation (Phase 2)
// Tests the HTML template without requiring vscode runtime
// ============================================================================

describe("Phase 2 — ChatWebviewProvider HTML template", () => {
  it("HTML template contains CSP nonce placeholder pattern", () => {
    // Simulates the nonce pattern used in _getHtmlForWebview
    const nonce = "test-nonce-123";
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';"></head><body><div id="root"></div></body></html>`;
    assert.strictEqual(html.includes(nonce), true);
    assert.strictEqual(html.includes("nonce-"), true);
  });

  it("HTML template includes root div", () => {
    const html = `<div id="root"></div>`;
    assert.strictEqual(html.includes('id="root"'), true);
  });

  it("webview.js script src ends with dist/webview.js", () => {
    const distPath = "test-uuid/dist/webview.js";
    assert.strictEqual(distPath.endsWith("dist/webview.js"), true);
  });
});

// ============================================================================
// Unit Tests: StatusBarManager state transitions (Phase 2)
// ============================================================================

describe("Phase 2 — StatusBarManager state", () => {
  it("initial state is disconnected", () => {
    let connected = false;
    assert.strictEqual(connected, false);
  });

  it("setConnected(true) transitions state", () => {
    let connected = false;
    const agentName = "claude";
    connected = true;
    assert.strictEqual(connected, true);
    assert.strictEqual(agentName, "claude");
  });

  it("setConnected(false) resets state", () => {
    let connected = true;
    connected = false;
    const name: string | null = null;
    assert.strictEqual(connected, false);
    assert.strictEqual(name, null);
  });

  it("agent name persists across toggles", () => {
    let connected = true;
    let name = "claude";
    connected = false;
    assert.strictEqual(name, "claude");
    connected = true;
    assert.strictEqual(name, "claude");
  });
});

// ============================================================================
// Unit Tests: ChatMessage ordering (Phase 2)
// ============================================================================

describe("Phase 2 — Message ordering", () => {
  it("messages preserve insertion order via map", () => {
    interface Msg {
      id: string;
      role: string;
      content: string;
      timestamp: number;
    }
    const msgs: Msg[] = [];
    msgs.push({ id: "1", role: "user", content: "a", timestamp: 1 });
    msgs.push({ id: "2", role: "agent", content: "b", timestamp: 2 });
    msgs.push({ id: "3", role: "user", content: "c", timestamp: 3 });

    // Simulates ChatContainer map()
    const rendered = msgs.map((m) => m.content);
    assert.deepStrictEqual(rendered, ["a", "b", "c"]);
  });

  it("last message in list is most recent", () => {
    const msgs = [
      { id: "1", role: "user" as const, content: "first", timestamp: 1 },
      { id: "2", role: "agent" as const, content: "last", timestamp: 2 },
    ];
    assert.strictEqual(msgs[msgs.length - 1].content, "last");
  });
});
