import * as assert from "assert";
import { describe, it, beforeEach, afterEach } from "mocha";
import { SessionOrchestrator } from "../../application/session/orchestrator";
import { wireSessionEvents } from "../../application/handlers";
import type { AppSessionInfo } from "../../application/session/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// Helpers
// ============================================================================

function createMockOrchestrator(): SessionOrchestrator {
  return new SessionOrchestrator({
    fs: {
      readFile: async () => "",
      writeFile: async () => {},
      exists: async () => false,
    } as any,
    ui: {
      showQuickPick: async () => null,
      showInputBox: async () => undefined,
      showErrorMessage: async () => {},
      showWarningMessage: async () => {},
      showInformationMessage: async () => {},
      withProgress: async (_opts: any, task: any) =>
        task(
          { report: () => {} } as any,
          { isCancellationRequested: false } as any
        ),
      createOutputChannel: () =>
        ({ appendLine: () => {}, dispose: () => {} }) as any,
      showOutputChannel: () => {},
      getConfiguration: () => false as any,
    } as any,
  });
}

function injectIdleSession(
  orch: SessionOrchestrator,
  agentId: string,
  sessionId: string
): AppSessionInfo {
  const sessions = (orch as any).getInternalState().sessions as Map<
    string,
    Map<string, AppSessionInfo>
  >;
  const agentSessions =
    sessions.get(agentId) ?? new Map<string, AppSessionInfo>();
  const now = new Date();
  const info: AppSessionInfo = {
    sessionId,
    agentId,
    title: "test-session",
    cwd: "/tmp/test",
    status: "idle",
    lastTurnOutcome: null,
    messages: [],
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
    lastResponseAt: null,
    tokenUsage: { input: 0, output: 0, total: 0 },
    pendingCancel: false,
  };
  agentSessions.set(sessionId, info);
  sessions.set(agentId, agentSessions);
  return info;
}

function wireCountingConnection(orch: SessionOrchestrator): {
  promptCalls: string[];
} {
  const promptCalls: string[] = [];
  (orch as any).agentConnectionRef.value = {
    getConnection: (_agentId: string) => ({
      prompt: async (req: {
        prompt: Array<{ type: string; text?: string }>;
      }) => {
        const text = req.prompt
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        promptCalls.push(text);
        return { stopReason: "end_turn" as const, usage: undefined };
      },
      cancel: async () => {},
    }),
  };
  return { promptCalls };
}

// ============================================================================
// Turn start: sessionTurnActiveChanged(active:true)
// ============================================================================

describe("Turn lifecycle — sessionTurnActiveChanged", () => {
  let orch: SessionOrchestrator;
  const agentId = "turn-agent";
  const sessionId = "turn-sess";

  beforeEach(() => {
    orch = createMockOrchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("emit active:true when a prompt begins executing", async () => {
    injectIdleSession(orch, agentId, sessionId);
    wireCountingConnection(orch);

    const events: Array<{
      active: boolean;
      stopReason?: string;
    }> = [];
    orch.on("sessionTurnActiveChanged", (e: any) => {
      events.push({ active: e.active, stopReason: e.stopReason });
    });

    await orch.prompt(agentId, sessionId, "こんにちは");

    // Expect two events: active:true at start, active:false at end
    assert.strictEqual(events.length, 2, "two events emitted");
    assert.strictEqual(
      events[0].active,
      true,
      "first event must be active:true"
    );
    assert.strictEqual(
      events[0].stopReason,
      undefined,
      "no stopReason on start"
    );
    assert.strictEqual(
      events[1].active,
      false,
      "second event must be active:false"
    );
    assert.strictEqual(events[1].stopReason, "end_turn", "stopReason on end");
  });

  it("does not emit active:true for queued prompts (only emit on actual execution)", async () => {
    injectIdleSession(orch, agentId, sessionId);
    wireCountingConnection(orch);

    // Mark session as running so the prompt is queued, not executed
    const info = orch.getSessionInfo(agentId, sessionId)!;
    info.status = "running";

    const turnEvents: Array<{ active: boolean }> = [];
    orch.on("sessionTurnActiveChanged", (e: any) => {
      turnEvents.push({ active: e.active });
    });

    // Queue two prompts while turn is running
    const q1 = await orch.prompt(agentId, sessionId, "keyed A");
    assert.ok(q1, "first prompt must be queued");

    const q2 = await orch.prompt(agentId, sessionId, "keyed B");
    assert.ok(q2, "second prompt must be queued");

    // No turn events should fire while just queuing
    assert.strictEqual(turnEvents.length, 0, "no events while queuing");

    // Now simulate turn end → queue drains → active:true fires for each execute
    info.status = "idle";
    (orch as any).promptExecution.processNextInQueue(agentId, sessionId);
    // Wait for the queue drain chain (A then B) to complete
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Each queued prompt → execute → active:true + active:false
    assert.strictEqual(turnEvents.length, 4, "two start + two end events");
    assert.strictEqual(turnEvents[0].active, true);
    assert.strictEqual(turnEvents[1].active, false);
    assert.strictEqual(turnEvents[2].active, true);
    assert.strictEqual(turnEvents[3].active, false);
  });
});

// ============================================================================
// wireSessionEvents: pushStreamEnd guard
// ============================================================================

describe("wireSessionEvents — pushStreamEnd is guarded by stopReason", () => {
  let orch: SessionOrchestrator;
  const agentId = "ws-agent";
  const sessionId = "ws-sess";

  beforeEach(() => {
    orch = createMockOrchestrator();
    injectIdleSession(orch, agentId, sessionId);
  });

  afterEach(() => {
    orch.dispose();
  });

  it("does NOT call pushStreamEnd when active:true (no stopReason)", () => {
    const pushStreamEndCalls: Array<{
      agentId: string;
      sessionId: string;
    }> = [];
    const chatPanel = {
      pushStreamEnd: (aId: string, sId: string) => {
        pushStreamEndCalls.push({ agentId: aId, sessionId: sId });
      },
      pushSessionInfo: () => {},
      pushTurnActive: () => {},
      postMessage: () => {},
      pushMessage: () => {},
      pushStreamChunk: () => {},
      setActiveSession: () => {},
      setAgentInfo: () => {},
      pushSessionNotification: () => {},
      pushSessionCompression: () => {},
      pushFileWrite: () => {},
    } as any;

    wireSessionEvents({
      orchestrator: orch,
      getChatPanel: () => chatPanel,
      presenter: {} as any,
      statusTracker: {} as any,
      historyStore: { addEntry: () => {} } as any,
      updateContext: () => {},
      sendTabs: () => {},
    });

    // Set session status to "running" so pushTurnActive sees the correct state.
    const info = orch.getSessionInfo(agentId, sessionId)!;
    info.status = "running";

    // Emit active:true (turn start) — no stopReason
    (orch as any).emit("sessionTurnActiveChanged", {
      agentId,
      sessionId,
      active: true,
      // no stopReason
    });

    assert.strictEqual(
      pushStreamEndCalls.length,
      0,
      "pushStreamEnd must NOT be called when active:true (no stopReason)"
    );
  });

  it("calls pushStreamEnd when active:false with stopReason (turn end)", () => {
    const pushStreamEndCalls: Array<{
      agentId: string;
      sessionId: string;
    }> = [];
    const chatPanel = {
      pushStreamEnd: (aId: string, sId: string) => {
        pushStreamEndCalls.push({ agentId: aId, sessionId: sId });
      },
      pushSessionInfo: () => {},
      pushTurnActive: () => {},
      postMessage: () => {},
      pushMessage: () => {},
      pushStreamChunk: () => {},
      setActiveSession: () => {},
      setAgentInfo: () => {},
      pushSessionNotification: () => {},
      pushSessionCompression: () => {},
      pushFileWrite: () => {},
    } as any;

    wireSessionEvents({
      orchestrator: orch,
      getChatPanel: () => chatPanel,
      presenter: {} as any,
      statusTracker: {} as any,
      historyStore: { addEntry: () => {} } as any,
      updateContext: () => {},
      sendTabs: () => {},
    });

    // Emit active:false with stopReason (turn end)
    (orch as any).emit("sessionTurnActiveChanged", {
      agentId,
      sessionId,
      active: false,
      stopReason: "end_turn",
    });

    assert.strictEqual(
      pushStreamEndCalls.length,
      1,
      "pushStreamEnd must be called when stopReason is present"
    );
    assert.strictEqual(pushStreamEndCalls[0].agentId, agentId);
    assert.strictEqual(pushStreamEndCalls[0].sessionId, sessionId);
  });

  it("calls pushTurnActive with isActive=true on active:true, isActive=false on active:false", () => {
    const pushTurnActiveCalls: Array<{
      agentId: string;
      sessionId: string;
      isActive: boolean;
    }> = [];
    const chatPanel = {
      pushStreamEnd: () => {},
      pushSessionInfo: () => {},
      pushTurnActive: (aId: string, sId: string, isActive: boolean) => {
        pushTurnActiveCalls.push({ agentId: aId, sessionId: sId, isActive });
      },
      postMessage: () => {},
      pushMessage: () => {},
      pushStreamChunk: () => {},
      setActiveSession: () => {},
      setAgentInfo: () => {},
      pushSessionNotification: () => {},
      pushSessionCompression: () => {},
      pushFileWrite: () => {},
    } as any;

    wireSessionEvents({
      orchestrator: orch,
      getChatPanel: () => chatPanel,
      presenter: {} as any,
      statusTracker: {} as any,
      historyStore: { addEntry: () => {} } as any,
      updateContext: () => {},
      sendTabs: () => {},
    });

    // Turn start — set status to running so pushTurnActive sees isActive=true
    const infoBeforeStart = orch.getSessionInfo(agentId, sessionId)!;
    infoBeforeStart.status = "running";

    // Turn start
    (orch as any).emit("sessionTurnActiveChanged", {
      agentId,
      sessionId,
      active: true,
    });

    // Turn end — set status to idle so pushTurnActive sees isActive=false
    const infoBeforeEnd = orch.getSessionInfo(agentId, sessionId)!;
    infoBeforeEnd.status = "idle";

    // Turn end
    (orch as any).emit("sessionTurnActiveChanged", {
      agentId,
      sessionId,
      active: false,
      stopReason: "end_turn",
    });

    assert.strictEqual(
      pushTurnActiveCalls.length,
      2,
      "two pushTurnActive calls"
    );
    assert.strictEqual(
      pushTurnActiveCalls[0].isActive,
      true,
      "start → isActive=true"
    );
    assert.strictEqual(
      pushTurnActiveCalls[1].isActive,
      false,
      "end → isActive=false"
    );
  });
});

// ============================================================================
// Integration: full turn lifecycle
// ============================================================================

describe("Integration — full turn lifecycle with sessionTurnActiveChanged", () => {
  let orch: SessionOrchestrator;
  const agentId = "full-agent";
  const sessionId = "full-sess";

  beforeEach(() => {
    orch = createMockOrchestrator();
  });

  afterEach(() => {
    orch.dispose();
  });

  it("fires active:true before prompt() resolves, active:false after stream end", async () => {
    injectIdleSession(orch, agentId, sessionId);
    wireCountingConnection(orch);

    const timeline: string[] = [];
    let promptResolved = false;

    orch.on("sessionTurnActiveChanged", (e: any) => {
      timeline.push(`turnActive:${e.active} promptResolved:${promptResolved}`);
    });

    await orch.prompt(agentId, sessionId, "hello");
    promptResolved = true;

    // After prompt() resolves:
    // turnActive:true was emitted (entry to execute())
    // execute() completed
    // turnActive:false was emitted (finally block)
    assert.deepStrictEqual(timeline, [
      "turnActive:true promptResolved:false",
      "turnActive:false promptResolved:false",
    ]);
  });

  it("sequence: pushTurnActive(true) → pushStreamEnd → pushTurnActive(false) during normal flow", async () => {
    injectIdleSession(orch, agentId, sessionId);
    wireCountingConnection(orch);

    const calls: string[] = [];
    const chatPanel = {
      pushStreamEnd: () => calls.push("pushStreamEnd"),
      pushSessionInfo: () => {},
      pushTurnActive: (_aId: string, _sId: string, isActive: boolean) => {
        calls.push(`pushTurnActive(${isActive})`);
      },
      postMessage: () => {},
      pushMessage: () => {},
      pushStreamChunk: () => {},
      setActiveSession: () => {},
      setAgentInfo: () => {},
      pushSessionNotification: () => {},
      pushSessionCompression: () => {},
      pushFileWrite: () => {},
    } as any;

    wireSessionEvents({
      orchestrator: orch,
      getChatPanel: () => chatPanel,
      presenter: {} as any,
      statusTracker: {} as any,
      historyStore: { addEntry: () => {} } as any,
      updateContext: () => {},
      sendTabs: () => {},
    });

    await orch.prompt(agentId, sessionId, "hello");

    // Expected sequence:
    // 1. pushTurnActive(true)  — turn start
    // 2. pushTurnActive(false) — turn end (status=idle → not running)
    // 3. pushStreamEnd        — called when stopReason is present
    // NOTE: order of pushTurnActive(false) vs pushStreamEnd depends on
    // how the handler processes them (info.status is checked for pushTurnActive).
    // Both are emitted in the same handler invocation for active:false with stopReason.
    assert.strictEqual(calls.length, 3, "three calls expected");
    assert.ok(calls.includes("pushTurnActive(true)"), "has turn start");
    assert.ok(calls.includes("pushTurnActive(false)"), "has turn end");
    assert.ok(calls.includes("pushStreamEnd"), "has stream end");

    // pushStreamEnd must come after pushTurnActive(true)
    const streamEndIdx = calls.indexOf("pushStreamEnd");
    const turnStartIdx = calls.indexOf("pushTurnActive(true)");
    assert.ok(
      streamEndIdx > turnStartIdx,
      "pushStreamEnd must come after pushTurnActive(true)"
    );
  });
});
