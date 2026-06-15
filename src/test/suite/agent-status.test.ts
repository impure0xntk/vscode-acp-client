import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { AgentStatusTracker } from "../../adapter/agent/status";
import type {
  AgentStatus,
  SessionStatusInfo,
  AgentConnectionState,
} from "../../adapter/agent/status";

// ============================================================================
// AgentStatusTracker Tests
// ============================================================================

function makeSessionStatus(
  overrides: Partial<SessionStatusInfo> = {}
): SessionStatusInfo {
  return {
    sessionId: "sess-1",
    title: "Test Session",
    status: "idle",
    lastTurnOutcome: null,
    isActive: false,
    messageCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    ...overrides,
  };
}

describe("AgentStatusTracker — Agent Status", () => {
  let tracker: AgentStatusTracker;

  beforeEach(() => {
    tracker = new AgentStatusTracker();
  });

  it("updateAgentStatus creates a new status entry", () => {
    tracker.updateAgentStatus("claude", { state: "connected" });
    const status = tracker.getAgentStatus("claude");
    assert.ok(status);
    assert.strictEqual(status!.agentId, "claude");
    assert.strictEqual(status!.state, "connected");
  });

  it("updateAgentStatus merges with existing status", () => {
    tracker.updateAgentStatus("claude", { state: "connected" });
    tracker.updateAgentStatus("claude", { state: "busy" });
    const status = tracker.getAgentStatus("claude");
    assert.strictEqual(status!.state, "busy");
  });

  it("updateAgentStatus sets lastActivity", () => {
    const before = new Date();
    tracker.updateAgentStatus("claude", { state: "connected" });
    const status = tracker.getAgentStatus("claude")!;
    assert.ok(status.lastActivity >= before);
  });

  it("getAgentStatus returns undefined for unknown agent", () => {
    assert.strictEqual(tracker.getAgentStatus("unknown"), undefined);
  });

  it("getAllAgentStatuses returns all tracked agents", () => {
    tracker.updateAgentStatus("claude", { state: "connected" });
    tracker.updateAgentStatus("gpt4", { state: "idle" });
    const all = tracker.getAllAgentStatuses();
    assert.strictEqual(all.length, 2);
    const ids = all.map((s) => s.agentId);
    assert.ok(ids.includes("claude"));
    assert.ok(ids.includes("gpt4"));
  });

  it("removeAgent deletes the status entry", () => {
    tracker.updateAgentStatus("claude", { state: "connected" });
    tracker.removeAgent("claude");
    assert.strictEqual(tracker.getAgentStatus("claude"), undefined);
  });
});

describe("AgentStatusTracker — Active Session", () => {
  let tracker: AgentStatusTracker;

  beforeEach(() => {
    tracker = new AgentStatusTracker();
    tracker.updateAgentStatus("claude", {
      state: "connected",
      sessions: [
        makeSessionStatus({ sessionId: "sess-1", isActive: false }),
        makeSessionStatus({ sessionId: "sess-2", isActive: false }),
      ],
    });
  });

  it("setActiveSession updates activeSessionId", () => {
    tracker.setActiveSession("claude", "sess-2");
    const status = tracker.getAgentStatus("claude")!;
    assert.strictEqual(status.activeSessionId, "sess-2");
  });

  it("setActiveSession sets isActive on the correct session", () => {
    tracker.setActiveSession("claude", "sess-2");
    const status = tracker.getAgentStatus("claude")!;
    const active = status.sessions.find((s) => s.sessionId === "sess-2");
    const inactive = status.sessions.find((s) => s.sessionId === "sess-1");
    assert.strictEqual(active!.isActive, true);
    assert.strictEqual(inactive!.isActive, false);
  });

  it("setActiveSession is a no-op for unknown agent", () => {
    tracker.setActiveSession("unknown", "sess-1");
    // Should not throw
  });

  it("setActiveSession with undefined clears active session", () => {
    tracker.setActiveSession("claude", "sess-1");
    tracker.setActiveSession("claude", undefined);
    const status = tracker.getAgentStatus("claude")!;
    assert.strictEqual(status.activeSessionId, undefined);
  });
});

describe("AgentStatusTracker — Session Status", () => {
  let tracker: AgentStatusTracker;

  beforeEach(() => {
    tracker = new AgentStatusTracker();
    tracker.updateAgentStatus("claude", {
      state: "connected",
      sessions: [makeSessionStatus({ sessionId: "sess-1" })],
    });
  });

  it("updateSessionStatus updates existing session", () => {
    tracker.updateSessionStatus("claude", "sess-1", { status: "running" });
    const status = tracker.getAgentStatus("claude")!;
    const session = status.sessions.find((s) => s.sessionId === "sess-1");
    assert.strictEqual(session!.status, "running");
  });

  it("updateSessionStatus adds new session if not found", () => {
    tracker.updateSessionStatus("claude", "sess-new", {
      sessionId: "sess-new",
      title: "New Session",
      status: "idle" as const,
      isActive: false,
      messageCount: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
    });
    const status = tracker.getAgentStatus("claude")!;
    assert.strictEqual(status.sessions.length, 2);
    assert.ok(status.sessions.some((s) => s.sessionId === "sess-new"));
  });

  it("updateSessionStatus is a no-op for unknown agent", () => {
    tracker.updateSessionStatus("unknown", "sess-1", { status: "running" });
    // Should not throw
  });
});

describe("AgentStatusTracker — Events", () => {
  let tracker: AgentStatusTracker;

  beforeEach(() => {
    tracker = new AgentStatusTracker();
  });

  it("emits agentStatusChanged on updateAgentStatus", () => {
    let receivedAgentId = "";
    let receivedState: AgentConnectionState = "disconnected";
    tracker.on("agentStatusChanged", (agentId, status) => {
      receivedAgentId = agentId;
      receivedState = status.state;
    });
    tracker.updateAgentStatus("claude", { state: "connected" });
    assert.strictEqual(receivedAgentId, "claude");
    assert.strictEqual(receivedState, "connected");
  });

  it("emits agentStatusChanged on setActiveSession", () => {
    tracker.updateAgentStatus("claude", {
      state: "connected",
      sessions: [makeSessionStatus({ sessionId: "sess-1" })],
    });
    let emitted = false;
    tracker.on("agentStatusChanged", () => {
      emitted = true;
    });
    tracker.setActiveSession("claude", "sess-1");
    assert.strictEqual(emitted, true);
  });

  it("emits sessionStatusChanged on updateSessionStatus", () => {
    tracker.updateAgentStatus("claude", {
      state: "connected",
      sessions: [makeSessionStatus({ sessionId: "sess-1" })],
    });
    let receivedSessionId = "";
    let receivedStatus = "";
    tracker.on("sessionStatusChanged", (agentId, sessionId, status) => {
      receivedSessionId = sessionId;
      receivedStatus = status.status;
    });
    tracker.updateSessionStatus("claude", "sess-1", { status: "running" });
    assert.strictEqual(receivedSessionId, "sess-1");
    assert.strictEqual(receivedStatus, "running");
  });
});

describe("AgentStatusTracker — Default Status Shape", () => {
  it("creates correct default shape for new agent", () => {
    const tracker = new AgentStatusTracker();
    tracker.updateAgentStatus("new-agent", {
      state: "connecting" as AgentConnectionState,
    });
    const status = tracker.getAgentStatus("new-agent")!;
    assert.strictEqual(status.agentId, "new-agent");
    assert.strictEqual(status.state, "connecting");
    assert.deepStrictEqual(status.sessions, []);
    assert.deepStrictEqual(status.totalTokenUsage, {
      input: 0,
      output: 0,
      total: 0,
    });
    assert.ok(status.lastActivity);
  });
});

describe("AgentStatusTracker — Cleanup", () => {
  it("dispose clears all statuses and listeners", () => {
    const tracker = new AgentStatusTracker();
    tracker.updateAgentStatus("claude", { state: "connected" });
    let count = 0;
    tracker.on("agentStatusChanged", () => {
      count++;
    });
    tracker.dispose();
    assert.strictEqual(tracker.getAllAgentStatuses().length, 0);
    // After dispose, events should not fire
    // (no way to re-add, but we verify internal state is cleared)
  });
});
