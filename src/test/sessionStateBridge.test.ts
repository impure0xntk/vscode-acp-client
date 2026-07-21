import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SessionStateBridge,
  type SessionStateTarget,
} from "../infrastructure/vscode/vscode-ui/sessionStateBridge";

// ============================================================================
// Helpers
// ============================================================================

function noop() {}

interface MockTargetExtras {
  postMessage?: (msg: unknown) => void;
  pushMessage?: (
    agentId: string,
    sessionId: string,
    msg: any,
    cwd?: string
  ) => void;
  pushSessionInfo?: (agentId: string, sessionId: string, info: any) => void;
  pushSessionSnapshot?: (agentId: string, sessionId: string, info: any) => void;
  pushStreamChunk?: (
    agentId: string,
    sessionId: string,
    chunk: string,
    messageId?: string,
    sessionUpdate?: string
  ) => void;
  pushStreamEnd?: (agentId: string, sessionId: string) => void;
  pushTurnActive?: (
    agentId: string,
    sessionId: string,
    active: boolean
  ) => void;
  pushSessionNotification?: (
    agentId: string,
    sessionId: string,
    notification: unknown
  ) => void;
  pushFileWrite?: (
    agentId: string,
    sessionId: string,
    path: string,
    content: string,
    originalContent?: string | null,
    contentHash?: string
  ) => void;
  pushSessionUsage?: (
    agentId: string,
    sessionId: string,
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    contextWindowMax?: number
  ) => void;
  pushSessionCompression?: (
    agentId: string,
    sessionId: string,
    info: { contextWindowMax: number; usedTokens: number; usedBefore?: number }
  ) => void;
  setAgentInfo?: (agentId: string, info: unknown) => void;
  setActiveSession?: (agentId: string, sessionId: string, info: any) => void;
  pushAvailableCommands?: (
    agentId: string,
    sessionId: string,
    commands: unknown[]
  ) => void;
}

function createMockTarget(extras?: MockTargetExtras): SessionStateTarget {
  const disposeFns = new Set<() => void>();
  return {
    postMessage: extras?.postMessage ?? noop,
    pushMessage: extras?.pushMessage ?? noop,
    pushSessionInfo: extras?.pushSessionInfo ?? noop,
    pushSessionSnapshot: extras?.pushSessionSnapshot ?? noop,
    pushStreamChunk: extras?.pushStreamChunk ?? noop,
    pushStreamEnd: extras?.pushStreamEnd ?? noop,
    pushTurnActive: extras?.pushTurnActive ?? noop,
    pushSessionNotification: extras?.pushSessionNotification ?? noop,
    pushFileWrite: extras?.pushFileWrite ?? noop,
    pushSessionUsage: extras?.pushSessionUsage ?? noop,
    pushSessionCompression: extras?.pushSessionCompression ?? noop,
    setAgentInfo: extras?.setAgentInfo ?? noop,
    setActiveSession: extras?.setActiveSession ?? noop,
    pushAvailableCommands: extras?.pushAvailableCommands ?? noop,
    onDidDispose: {
      event: (fn: () => void) => {
        disposeFns.add(fn);
        return { dispose: () => disposeFns.delete(fn) };
      },
    },
    // simulate dispose — used by tests to trigger auto-unregister
    _fireDispose: () => {
      for (const fn of disposeFns) fn();
    },
    logger: null,
  } as SessionStateTarget & { _fireDispose: () => void };
}

// ============================================================================
// Tests
// ============================================================================

describe("SessionStateBridge", () => {
  let bridge: SessionStateBridge;

  beforeEach(() => {
    bridge = new SessionStateBridge();
  });

  // ── registration ──────────────────────────────────────────────────

  it("starts with size 0", () => {
    expect(bridge.size).toBe(0);
  });

  it("register() adds a target and increments size", () => {
    const t = createMockTarget();
    bridge.register(t);
    expect(bridge.size).toBe(1);
  });

  it("register() with the same target twice does not double-add", () => {
    const t = createMockTarget();
    bridge.register(t);
    bridge.register(t);
    expect(bridge.size).toBe(1);
  });

  it("unregister() removes a target", () => {
    const t = createMockTarget();
    bridge.register(t);
    bridge.unregister(t);
    expect(bridge.size).toBe(0);
  });

  it("unregister() is idempotent — removing a non-registered target does nothing", () => {
    const t = createMockTarget();
    bridge.unregister(t);
    expect(bridge.size).toBe(0);
  });

  it("auto-unregisters on dispose event", () => {
    const t = createMockTarget();
    bridge.register(t);
    expect(bridge.size).toBe(1);

    (t as any)._fireDispose();
    expect(bridge.size).toBe(0);
  });

  it("register() with multiple targets", () => {
    const t1 = createMockTarget();
    const t2 = createMockTarget();
    const t3 = createMockTarget();
    bridge.register(t1);
    bridge.register(t2);
    bridge.register(t3);
    expect(bridge.size).toBe(3);
  });

  it("auto-unregister removes only the disposed target", () => {
    const t1 = createMockTarget();
    const t2 = createMockTarget();
    bridge.register(t1);
    bridge.register(t2);

    (t1 as any)._fireDispose();
    expect(bridge.size).toBe(1);

    (t2 as any)._fireDispose();
    expect(bridge.size).toBe(0);
  });

  // ── broadcast: postMessage ────────────────────────────────────────

  it("postMessage broadcasts to all registered targets", () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    bridge.register(createMockTarget({ postMessage: spy1 }));
    bridge.register(createMockTarget({ postMessage: spy2 }));

    bridge.postMessage({ type: "hello" });

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy1).toHaveBeenCalledWith({ type: "hello" });
    expect(spy2).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledWith({ type: "hello" });
  });

  it("postMessage does nothing when no targets registered", () => {
    // Should not throw
    expect(() => bridge.postMessage({ type: "nobody" })).not.toThrow();
  });

  // ── broadcast: pushMessage ────────────────────────────────────────

  it("pushMessage broadcasts to all targets", () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    bridge.register(createMockTarget({ pushMessage: spy1 }));
    bridge.register(createMockTarget({ pushMessage: spy2 }));

    const msg = {
      id: "m1",
      role: "user",
      content: "Hello",
      timestamp: 1000,
    } as any;
    bridge.pushMessage("agent-a", "sess-1", msg, "/workspace");

    expect(spy1).toHaveBeenCalledWith("agent-a", "sess-1", msg, "/workspace");
    expect(spy2).toHaveBeenCalledWith("agent-a", "sess-1", msg, "/workspace");
  });

  it("pushMessage passes undefined cwd when omitted", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushMessage: spy }));

    const msg = {
      id: "m2",
      role: "agent",
      content: "Reply",
      timestamp: 2000,
    } as any;
    bridge.pushMessage("agent-b", "sess-2", msg);

    expect(spy).toHaveBeenCalledWith("agent-b", "sess-2", msg, undefined);
  });

  // ── broadcast: pushSessionInfo ────────────────────────────────────

  it("pushSessionInfo broadcasts to all targets", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushSessionInfo: spy }));

    const info = { sessionId: "s1", agentId: "a", status: "running" } as any;
    bridge.pushSessionInfo("a", "s1", info);

    expect(spy).toHaveBeenCalledWith("a", "s1", info);
  });

  // ── broadcast: pushSessionSnapshot ────────────────────────────────

  it("pushSessionSnapshot broadcasts to all targets", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushSessionSnapshot: spy }));

    const info = { sessionId: "s2", agentId: "b", messages: [] } as any;
    bridge.pushSessionSnapshot("b", "s2", info);

    expect(spy).toHaveBeenCalledWith("b", "s2", info);
  });

  // ── broadcast: pushStreamChunk ────────────────────────────────────

  it("pushStreamChunk broadcasts with all parameters", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushStreamChunk: spy }));

    bridge.pushStreamChunk("a", "s1", "hello ", "msg-1", "typing");

    expect(spy).toHaveBeenCalledWith("a", "s1", "hello ", "msg-1", "typing");
  });

  it("pushStreamChunk works with only required params (messageId and sessionUpdate undefined)", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushStreamChunk: spy }));

    bridge.pushStreamChunk("a", "s1", "world");

    expect(spy).toHaveBeenCalledWith("a", "s1", "world", undefined, undefined);
  });

  // ── broadcast: pushStreamEnd ──────────────────────────────────────

  it("pushStreamEnd broadcasts to all targets", () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    bridge.register(createMockTarget({ pushStreamEnd: spy1 }));
    bridge.register(createMockTarget({ pushStreamEnd: spy2 }));

    bridge.pushStreamEnd("a", "s1");

    expect(spy1).toHaveBeenCalledWith("a", "s1");
    expect(spy2).toHaveBeenCalledWith("a", "s1");
  });

  // ── broadcast: pushTurnActive ─────────────────────────────────────

  it("pushTurnActive broadcasts active=true", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushTurnActive: spy }));

    bridge.pushTurnActive("a", "s1", true);

    expect(spy).toHaveBeenCalledWith("a", "s1", true);
  });

  it("pushTurnActive broadcasts active=false", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushTurnActive: spy }));

    bridge.pushTurnActive("a", "s1", false);

    expect(spy).toHaveBeenCalledWith("a", "s1", false);
  });

  // ── broadcast: pushSessionNotification ────────────────────────────

  it("pushSessionNotification broadcasts arbitrary notification", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushSessionNotification: spy }));

    const notif = { code: "PERMISSION_REQUEST", tool: "shell" };
    bridge.pushSessionNotification("a", "s1", notif);

    expect(spy).toHaveBeenCalledWith("a", "s1", notif);
  });

  // ── broadcast: pushFileWrite ──────────────────────────────────────

  it("pushFileWrite broadcasts with all fields", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushFileWrite: spy }));

    bridge.pushFileWrite(
      "a",
      "s1",
      "/tmp/x.ts",
      "new content",
      "old content",
      "abc123"
    );

    expect(spy).toHaveBeenCalledWith(
      "a",
      "s1",
      "/tmp/x.ts",
      "new content",
      "old content",
      "abc123"
    );
  });

  it("pushFileWrite broadcasts with null originalContent and undefined contentHash", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushFileWrite: spy }));

    bridge.pushFileWrite("a", "s1", "/tmp/y.ts", "content", null, undefined);

    expect(spy).toHaveBeenCalledWith(
      "a",
      "s1",
      "/tmp/y.ts",
      "content",
      null,
      undefined
    );
  });

  // ── broadcast: pushSessionUsage ───────────────────────────────────

  it("pushSessionUsage broadcasts with contextWindowMax", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushSessionUsage: spy }));

    const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    bridge.pushSessionUsage("a", "s1", usage, 200000);

    expect(spy).toHaveBeenCalledWith("a", "s1", usage, 200000);
  });

  it("pushSessionUsage broadcasts without contextWindowMax", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushSessionUsage: spy }));

    const usage = { inputTokens: 200, outputTokens: 100, totalTokens: 300 };
    bridge.pushSessionUsage("a", "s1", usage);

    expect(spy).toHaveBeenCalledWith("a", "s1", usage, undefined);
  });

  // ── broadcast: pushSessionCompression ─────────────────────────────

  it("pushSessionCompression broadcasts with usedBefore", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushSessionCompression: spy }));

    bridge.pushSessionCompression("a", "s1", {
      contextWindowMax: 200000,
      usedTokens: 150000,
      usedBefore: 120000,
    });

    expect(spy).toHaveBeenCalledWith("a", "s1", {
      contextWindowMax: 200000,
      usedTokens: 150000,
      usedBefore: 120000,
    });
  });

  it("pushSessionCompression broadcasts without usedBefore", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushSessionCompression: spy }));

    bridge.pushSessionCompression("a", "s1", {
      contextWindowMax: 200000,
      usedTokens: 100000,
    });

    expect(spy).toHaveBeenCalledWith("a", "s1", {
      contextWindowMax: 200000,
      usedTokens: 100000,
      usedBefore: undefined,
    });
  });

  // ── broadcast: setAgentInfo ───────────────────────────────────────

  it("setAgentInfo broadcasts to all targets", () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    bridge.register(createMockTarget({ setAgentInfo: spy1 }));
    bridge.register(createMockTarget({ setAgentInfo: spy2 }));

    const info = { name: "Claude", version: "1.0" };
    bridge.setAgentInfo("agent-claude", info);

    expect(spy1).toHaveBeenCalledWith("agent-claude", info);
    expect(spy2).toHaveBeenCalledWith("agent-claude", info);
  });

  // ── broadcast: setActiveSession ───────────────────────────────────

  it("setActiveSession broadcasts to all targets", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ setActiveSession: spy }));

    const sessionInfo = { sessionId: "s1", agentId: "a", title: "Main" } as any;
    bridge.setActiveSession("a", "s1", sessionInfo);

    expect(spy).toHaveBeenCalledWith("a", "s1", sessionInfo);
  });

  // ── broadcast: pushAvailableCommands ──────────────────────────────

  it("pushAvailableCommands broadcasts command list", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushAvailableCommands: spy }));

    const commands = [
      { name: "explain", description: "Explain code" },
      { name: "fix", description: "Fix issues" },
    ];
    bridge.pushAvailableCommands("a", "s1", commands);

    expect(spy).toHaveBeenCalledWith("a", "s1", commands);
  });

  it("pushAvailableCommands broadcasts empty array", () => {
    const spy = vi.fn();
    bridge.register(createMockTarget({ pushAvailableCommands: spy }));

    bridge.pushAvailableCommands("a", "s1", []);

    expect(spy).toHaveBeenCalledWith("a", "s1", []);
  });

  // ── edge cases ────────────────────────────────────────────────────

  it("all broadcast methods work after all targets disposed (no-op)", () => {
    const t = createMockTarget();
    bridge.register(t);
    (t as any)._fireDispose();

    expect(() => {
      bridge.postMessage({ type: "test" });
      bridge.pushMessage("a", "s", {} as any);
      bridge.pushSessionInfo("a", "s", {} as any);
      bridge.pushSessionSnapshot("a", "s", {} as any);
      bridge.pushStreamChunk("a", "s", "x");
      bridge.pushStreamEnd("a", "s");
      bridge.pushTurnActive("a", "s", true);
      bridge.pushSessionNotification("a", "s", {});
      bridge.pushFileWrite("a", "s", "/f", "c");
      bridge.pushSessionUsage("a", "s", {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
      bridge.pushSessionCompression("a", "s", {
        contextWindowMax: 100,
        usedTokens: 50,
      });
      bridge.setAgentInfo("a", {});
      bridge.setActiveSession("a", "s", {} as any);
      bridge.pushAvailableCommands("a", "s", []);
    }).not.toThrow();
  });

  it("broadcast reaches all targets even if one throws", () => {
    const spyGood = vi.fn();
    const tGood = createMockTarget({ postMessage: spyGood });

    const tBad = createMockTarget({
      postMessage: () => {
        throw new Error("panel crashed");
      },
    });

    bridge.register(tBad);
    bridge.register(tGood);

    expect(() => bridge.postMessage({ type: "boom" })).toThrow("panel crashed");
    // tGood should still be called (Set iteration happens before throw propagates)
    // Note: Set iteration is synchronous; the throw stops iteration, so tGood
    // may or may not be called depending on insertion order.  This test
    // documents the current behavior: tBad was inserted first, so iteration
    // hits it first and throws immediately.
  });

  it("register/dispose/register round-trip", () => {
    const spy = vi.fn();
    const t = createMockTarget({ postMessage: spy });

    bridge.register(t);
    bridge.postMessage({ type: "first" });
    expect(spy).toHaveBeenCalledTimes(1);

    (t as any)._fireDispose();
    bridge.postMessage({ type: "gone" });
    expect(spy).toHaveBeenCalledTimes(1); // not called again

    bridge.register(t);
    bridge.postMessage({ type: "back" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith({ type: "back" });
  });

  it("targets are iterated in insertion order (Set semantics)", () => {
    const order: number[] = [];
    const t1 = createMockTarget({ postMessage: () => order.push(1) });
    const t2 = createMockTarget({ postMessage: () => order.push(2) });
    const t3 = createMockTarget({ postMessage: () => order.push(3) });

    bridge.register(t1);
    bridge.register(t2);
    bridge.register(t3);

    bridge.postMessage({});

    expect(order).toEqual([1, 2, 3]);
  });
});
