import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { SessionManager } from "../../domain/services/session-manager";
import { StateManager } from "../../domain/services/state-manager";

// ============================================================================
// Session Manager Tests
// ============================================================================

describe("SessionManager — CRUD", () => {
  let sm: StateManager;
  let manager: SessionManager;

  beforeEach(() => {
    sm = new StateManager();
    manager = new SessionManager(sm);
  });

  it("createSession creates a new idle session", () => {
    const session = manager.createSession("claude", "sess-1");
    assert.strictEqual(session.id, "sess-1");
    assert.strictEqual(session.agentId, "claude");
    assert.strictEqual(session.status, "idle");
    assert.deepStrictEqual(session.context.childSessionIds, []);
  });

  it("createSession auto-activates first session for agent", () => {
    manager.createSession("claude", "sess-1");
    assert.strictEqual(manager.getActiveSessionId("claude"), "sess-1");
  });

  it("createSession does not override active session", () => {
    manager.createSession("claude", "sess-1");
    manager.createSession("claude", "sess-2");
    assert.strictEqual(manager.getActiveSessionId("claude"), "sess-1");
  });

  it("getSession retrieves an existing session", () => {
    manager.createSession("claude", "sess-1");
    const session = manager.getSession("claude", "sess-1");
    assert.ok(session);
    assert.strictEqual(session!.id, "sess-1");
  });

  it("getSession returns unknown for non-existent session", () => {
    assert.strictEqual(manager.getSession("claude", "unknown"), undefined);
  });
});

describe("SessionManager — Status Updates", () => {
  let manager: SessionManager;

  beforeEach(() => {
    const sm = new StateManager();
    manager = new SessionManager(sm);
    manager.createSession("claude", "sess-1");
  });

  it("updateSessionStatus changes status", () => {
    manager.updateSessionStatus("claude", "sess-1", "running");
    assert.strictEqual(
      manager.getSession("claude", "sess-1")!.status,
      "running"
    );
  });

  it("updateSessionStatus updates updatedAt timestamp", () => {
    const before = new Date();
    manager.updateSessionStatus("claude", "sess-1", "running");
    const after = new Date();
    const session = manager.getSession("claude", "sess-1")!;
    assert.ok(session.updatedAt >= before && session.updatedAt <= after);
  });

  it("updateSessionStatus throws for non-existent session", () => {
    assert.throws(
      () => manager.updateSessionStatus("claude", "unknown", "running"),
      /Session unknown not found/
    );
  });
});

describe("SessionManager — Active Session", () => {
  let manager: SessionManager;

  beforeEach(() => {
    const sm = new StateManager();
    manager = new SessionManager(sm);
    manager.createSession("claude", "sess-1");
    manager.createSession("claude", "sess-2");
  });

  it("setActiveSession changes the active session", () => {
    manager.setActiveSession("claude", "sess-2");
    assert.strictEqual(manager.getActiveSessionId("claude"), "sess-2");
  });

  it("setActiveSession throws for non-existent session", () => {
    assert.throws(
      () => manager.setActiveSession("claude", "unknown"),
      /Session unknown not found/
    );
  });

  it("destroySession auto-activates next session when active is destroyed", () => {
    manager.setActiveSession("claude", "sess-1");
    manager.createSession("claude", "sess-3");
    manager.destroySession("claude", "sess-1");
    // sess-2 was created first (first in getSessionsForAgent), becomes active
    const active = manager.getActiveSessionId("claude");
    assert.ok(active);
    assert.notStrictEqual(active, "sess-1");
  });

  it("destroySession clears active when destroying the active session", () => {
    manager.destroySession("claude", "sess-1");
    // sess-2 was created second, but sess-1 was deleted, so only sess-2 remains
    manager.destroySession("claude", "sess-2");
    assert.strictEqual(manager.getActiveSessionId("claude"), undefined);
  });

  it("destroySession is a no-op for unknown session", () => {
    manager.destroySession("claude", "unknown"); // should not throw
    assert.strictEqual(manager.getSession("claude", "sess-1")!.status, "idle");
  });
});

describe("SessionManager — Listing", () => {
  let manager: SessionManager;

  beforeEach(() => {
    const sm = new StateManager();
    manager = new SessionManager(sm);
  });

  it("getSessionsForAgent returns sessions for specific agent", () => {
    manager.createSession("claude", "sess-1");
    manager.createSession("claude", "sess-2");
    manager.createSession("gpt4", "sess-3");

    const claudeSessions = manager.getSessionsForAgent("claude");
    assert.strictEqual(claudeSessions.length, 2);
    const gpt4Sessions = manager.getSessionsForAgent("gpt4");
    assert.strictEqual(gpt4Sessions.length, 1);
  });

  it("getSessionsForAgent returns empty for unknown agent", () => {
    assert.strictEqual(manager.getSessionsForAgent("unknown").length, 0);
  });

  it("getAllSessions returns sessions grouped by agent", () => {
    manager.createSession("claude", "sess-1");
    manager.createSession("gpt4", "sess-2");

    const all = manager.getAllSessions();
    assert.strictEqual(all.size, 2);
    assert.strictEqual(all.get("claude")!.length, 1);
    assert.strictEqual(all.get("gpt4")!.length, 1);
  });
});

describe("SessionManager — Child Sessions", () => {
  let manager: SessionManager;

  beforeEach(() => {
    const sm = new StateManager();
    manager = new SessionManager(sm);
  });

  it("getChildSessions returns sessions with matching parentSessionId", () => {
    manager.createSession("claude", "parent-1");
    manager.createSession("claude", "child-1", {
      parentSessionId: "parent-1",
    } as any);
    manager.createSession("claude", "child-2", {
      parentSessionId: "parent-1",
    } as any);

    const children = manager.getChildSessions("parent-1");
    assert.strictEqual(children.length, 2);
    const ids = children.map((s) => s.id);
    assert.ok(ids.includes("child-1"));
    assert.ok(ids.includes("child-2"));
  });

  it("getChildSessions returns empty for session with no children", () => {
    manager.createSession("claude", "lonely");
    assert.strictEqual(manager.getChildSessions("lonely").length, 0);
  });
});

describe("SessionManager — Events", () => {
  let manager: SessionManager;

  beforeEach(() => {
    const sm = new StateManager();
    manager = new SessionManager(sm);
  });

  it("emits sessionCreated on createSession", () => {
    let event: any = null;
    manager.on("sessionCreated", (e) => {
      event = e;
    });
    manager.createSession("claude", "sess-1");
    assert.ok(event);
    assert.strictEqual(event.agentId, "claude");
    assert.strictEqual(event.sessionId, "sess-1");
  });

  it("emits sessionStatusChanged on updateSessionStatus", () => {
    manager.createSession("claude", "sess-1");
    let event: any = null;
    manager.on("sessionStatusChanged", (e) => {
      event = e;
    });
    manager.updateSessionStatus("claude", "sess-1", "running");
    assert.ok(event);
    assert.strictEqual(event.status, "running");
  });

  it("emits sessionClosed on destroySession", () => {
    manager.createSession("claude", "sess-1");
    let event: any = null;
    manager.on("sessionClosed", (e) => {
      event = e;
    });
    manager.destroySession("claude", "sess-1");
    assert.ok(event);
    assert.strictEqual(event.sessionId, "sess-1");
  });

  it("emits sessionActiveChanged on setActiveSession", () => {
    manager.createSession("claude", "sess-1");
    manager.createSession("claude", "sess-2");
    let event: any = null;
    manager.on("sessionActiveChanged", (e) => {
      event = e;
    });
    manager.setActiveSession("claude", "sess-2");
    assert.ok(event);
    assert.strictEqual(event.sessionId, "sess-2");
  });

  it("onSessionEvent subscribes via stateManager", () => {
    let received = false;
    manager.onSessionEvent("session.created", () => {
      received = true;
    });
    manager.createSession("claude", "sess-1");
    assert.strictEqual(received, true);
  });
});

describe("SessionManager — Cleanup", () => {
  it("dispose clears all sessions and listeners", () => {
    const sm = new StateManager();
    const manager = new SessionManager(sm);
    manager.createSession("claude", "sess-1");
    let count = 0;
    manager.on("sessionCreated", () => {
      count++;
    });
    manager.dispose();
    assert.strictEqual(manager.getSessionsForAgent("claude").length, 0);
  });
});
