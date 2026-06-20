import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure logic mirror of SingleSessionLayout ──────────────────────────────
// This mirrors the exact effect bodies and return values in
// SingleSessionLayout.tsx so we can unit-test the state machine without
// React rendering.

type SessionStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "done"
  | "error"
  | "cancelled";

interface LayoutState {
  pending: boolean;
  turnStartedAt: string | undefined;
}

// ── Effect: terminal status clears pending ────────────────────────────────

function applyTerminalEffect(
  status: SessionStatus,
  state: LayoutState
): LayoutState {
  const isTerminal =
    status === "completed" ||
    status === "done" ||
    status === "error" ||
    status === "cancelled";

  if (isTerminal && state.pending) {
    return { pending: false, turnStartedAt: undefined };
  }
  return state;
}

// ── Effect: running + pending → 400ms timer (simulated as immediate) ──────
// In the real component, a 400ms timer fires setPending(false).  For
// testing we simulate the timer firing immediately when conditions are met.

function applyRunningTimer(
  status: SessionStatus,
  state: LayoutState,
  timerFired: boolean
): LayoutState {
  const isTurnActive = status === "running";
  if (isTurnActive && state.pending && timerFired) {
    return { ...state, pending: false };
  }
  return state;
}

// ── Effect: !isTurnActive → clear turnStartedAt if pending is false ──────

function applyIdleCleanup(
  status: SessionStatus,
  state: LayoutState
): LayoutState {
  const isTurnActive = status === "running";
  if (!isTurnActive && !state.pending && state.turnStartedAt) {
    return { ...state, turnStartedAt: undefined };
  }
  return state;
}

// ── Derive props passed to SessionStatusBar ──────────────────────────────

interface StatusBarProps {
  active: boolean;
  action: string | undefined;
  turnStartedAt: string | undefined;
  pending: boolean;
}

function deriveStatusBarProps(
  activeKey: string | null,
  status: SessionStatus,
  state: LayoutState
): StatusBarProps {
  const isTurnActive = status === "running";
  return {
    active: isTurnActive,
    action: isTurnActive
      ? `Waiting for ${activeKey?.split(":")[0] ?? "agent"}\u2026`
      : undefined,
    turnStartedAt: state.turnStartedAt,
    pending: state.pending,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TS = new Date().toISOString();

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SingleSessionLayout: terminal status clears pending/turnStartedAt", () => {
  // ── Bug scenario: "done" status while pending ──────────────────────────────

  describe("done status clears pending (the reported bug)", () => {
    it("clears pending when status is done and pending is true", () => {
      const result = applyTerminalEffect("done", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, undefined);
    });

    it("clears turnStartedAt when status is done and pending is true", () => {
      const result = applyTerminalEffect("done", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.turnStartedAt, undefined);
    });
  });

  describe("completed status clears pending", () => {
    it("clears pending when status is completed and pending is true", () => {
      const result = applyTerminalEffect("completed", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, undefined);
    });
  });

  describe("error status clears pending", () => {
    it("clears pending when status is error and pending is true", () => {
      const result = applyTerminalEffect("error", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, undefined);
    });
  });

  describe("cancelled status clears pending", () => {
    it("clears pending when status is cancelled and pending is true", () => {
      const result = applyTerminalEffect("cancelled", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, undefined);
    });
  });

  // ── Non-terminal states must NOT clear pending ─────────────────────────────

  describe("non-terminal states do NOT clear pending", () => {
    it("keeps pending=true when status is running and pending is true", () => {
      const result = applyTerminalEffect("running", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, true);
      assert.strictEqual(result.turnStartedAt, TS);
    });

    it("keeps pending=true when status is idle and pending is true", () => {
      const result = applyTerminalEffect("idle", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, true);
      assert.strictEqual(result.turnStartedAt, TS);
    });
  });

  // ── Idempotent: pending already false ──────────────────────────────────────

  describe("no-op when pending is already false", () => {
    it("does nothing when pending is false (done)", () => {
      const result = applyTerminalEffect("done", {
        pending: false,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, TS);
    });

    it("does nothing when pending is false (completed)", () => {
      const result = applyTerminalEffect("completed", {
        pending: false,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, TS);
    });

    it("does nothing when pending is false (error)", () => {
      const result = applyTerminalEffect("error", {
        pending: false,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, TS);
    });
  });

  // ── Simulated transition sequences ────────────────────────────────────────

  describe("transition: sending → terminal (real-world sequence)", () => {
    it("simulates send → stream → done (exact bug sequence)", () => {
      let state: LayoutState = { pending: true, turnStartedAt: TS };

      // Agent starts running (but terminal effect hasn't fired yet)
      state = applyRunningTimer("running", state, false);
      assert.strictEqual(state.pending, true);

      // session/completed arrives with "done" status
      state = applyTerminalEffect("done", state);
      assert.strictEqual(state.pending, false);
      assert.strictEqual(state.turnStartedAt, undefined);
    });

    it("simulates send → stream → completed", () => {
      let state: LayoutState = { pending: true, turnStartedAt: TS };

      state = applyTerminalEffect("completed", state);
      assert.strictEqual(state.pending, false);
      assert.strictEqual(state.turnStartedAt, undefined);
    });

    it("simulates send (no response yet) → done (fast agent)", () => {
      let state: LayoutState = { pending: true, turnStartedAt: TS };

      // Status jumps straight to done without ever being "running"
      state = applyTerminalEffect("done", state);
      assert.strictEqual(state.pending, false);
      assert.strictEqual(state.turnStartedAt, undefined);
    });
  });

  // ── Regression: "done" string is handled (not just enum) ───────────────────

  describe("done string literal (not in SessionStatus union)", () => {
    it("treats 'done' as terminal even though it's cast from string", () => {
      const result = applyTerminalEffect("done", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(result.pending, false);
      assert.strictEqual(result.turnStartedAt, undefined);
    });
  });
});

// ── Tests for running-timer effect (400ms pending clear) ────────────────────

describe("SingleSessionLayout: running timer clears pending after delay", () => {
  it("clears pending when running + timer fired", () => {
    const state: LayoutState = { pending: true, turnStartedAt: TS };
    const result = applyRunningTimer("running", state, true);
    assert.strictEqual(result.pending, false);
  });

  it("does NOT clear pending when running but timer has not fired yet", () => {
    const state: LayoutState = { pending: true, turnStartedAt: TS };
    const result = applyRunningTimer("running", state, false);
    assert.strictEqual(result.pending, true);
    assert.strictEqual(result.turnStartedAt, TS);
  });

  it("does NOT clear pending when not running (timer should not fire)", () => {
    const state: LayoutState = { pending: true, turnStartedAt: TS };
    const result = applyRunningTimer("idle", state, true);
    assert.strictEqual(result.pending, true);
  });
});

// ── Tests for idle cleanup effect ───────────────────────────────────────────

describe("SingleSessionLayout: idle cleanup clears turnStartedAt", () => {
  it("clears turnStartedAt when idle + pending is false", () => {
    const state: LayoutState = { pending: false, turnStartedAt: TS };
    const result = applyIdleCleanup("idle", state);
    assert.strictEqual(result.turnStartedAt, undefined);
  });

  it("keeps turnStartedAt when idle but pending is still true", () => {
    const state: LayoutState = { pending: true, turnStartedAt: TS };
    const result = applyIdleCleanup("idle", state);
    assert.strictEqual(result.turnStartedAt, TS);
  });

  it("keeps turnStartedAt when running (timer still active)", () => {
    const state: LayoutState = { pending: false, turnStartedAt: TS };
    const result = applyIdleCleanup("running", state);
    assert.strictEqual(result.turnStartedAt, TS);
  });
});

// ── Tests for SessionStatusBar props derivation ─────────────────────────────

describe("SingleSessionLayout: SessionStatusBar props derivation", () => {
  // ── "Waiting for {agent}…" cases ────────────────────────────────────────

  describe("waiting for agent (active turn)", () => {
    it("sets active=true and action='Waiting for {agent}…' when running", () => {
      const props = deriveStatusBarProps("claude:session-1", "running", {
        pending: false,
        turnStartedAt: TS,
      });
      assert.strictEqual(props.active, true);
      assert.strictEqual(props.action, "Waiting for claude\u2026");
    });

    it("extracts agent name from complex sessionKey", () => {
      const props = deriveStatusBarProps("my-agent:abc-123", "running", {
        pending: false,
        turnStartedAt: undefined,
      });
      assert.strictEqual(props.action, "Waiting for my-agent\u2026");
    });

    it("uses 'agent' as fallback when activeKey is null", () => {
      const props = deriveStatusBarProps(null, "running", {
        pending: false,
        turnStartedAt: undefined,
      });
      assert.strictEqual(props.action, "Waiting for agent\u2026");
    });

    it("sets pending=false when running (timer already fired)", () => {
      const props = deriveStatusBarProps("claude:sess-1", "running", {
        pending: false,
        turnStartedAt: TS,
      });
      assert.strictEqual(props.pending, false);
    });

    it("keeps turnStartedAt when running (for elapsed timer)", () => {
      const props = deriveStatusBarProps("claude:sess-1", "running", {
        pending: false,
        turnStartedAt: TS,
      });
      assert.strictEqual(props.turnStartedAt, TS);
    });
  });

  // ── Sending cases (pending + turnStartedAt, not yet running) ─────────────

  describe("sending (pending, not yet running)", () => {
    it("sets active=false, pending=true, turnStartedAt set", () => {
      const props = deriveStatusBarProps("claude:session-1", "idle", {
        pending: true,
        turnStartedAt: TS,
      });
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.pending, true);
      assert.strictEqual(props.turnStartedAt, TS);
      assert.strictEqual(props.action, undefined);
    });

    it("action is undefined even when pending (sending takes priority)", () => {
      const props = deriveStatusBarProps("claude:session-1", "idle", {
        pending: true,
        turnStartedAt: TS,
      });
      // SessionStatusBar itself decides to show "Sending…" based on pending+turnStartedAt
      assert.strictEqual(props.action, undefined);
    });
  });

  // ── Cancelling cases ─────────────────────────────────────────────────────

  describe("cancelling", () => {
    it("sets active=false and action=undefined when cancelling", () => {
      // When status is "cancelling", isTurnActive is false (only "running" is active).
      // SessionStatusBar reads sessionInfo.status directly to show "Cancelling…".
      const props = deriveStatusBarProps("claude:session-1", "cancelling", {
        pending: false,
        turnStartedAt: undefined,
      });
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.action, undefined);
    });

    it("cancelling after pending clears pending", () => {
      // Terminal effect fires first, then props are derived
      const cleared = applyTerminalEffect("cancelling", {
        pending: true,
        turnStartedAt: TS,
      });
      const props = deriveStatusBarProps(
        "claude:session-1",
        "cancelling",
        cleared
      );
      assert.strictEqual(props.pending, false);
      assert.strictEqual(props.turnStartedAt, undefined);
      assert.strictEqual(props.active, false);
    });
  });

  // ── Idle / terminal states ───────────────────────────────────────────────

  describe("idle (no active turn, no pending)", () => {
    it("sets active=false, pending=false, action=undefined", () => {
      const props = deriveStatusBarProps("claude:session-1", "idle", {
        pending: false,
        turnStartedAt: undefined,
      });
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.pending, false);
      assert.strictEqual(props.action, undefined);
      assert.strictEqual(props.turnStartedAt, undefined);
    });
  });

  describe("completed (terminal, no pending)", () => {
    it("sets active=false, pending=false after terminal clear", () => {
      const cleared = applyTerminalEffect("completed", {
        pending: true,
        turnStartedAt: TS,
      });
      const props = deriveStatusBarProps(
        "claude:session-1",
        "completed",
        cleared
      );
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.pending, false);
      assert.strictEqual(props.turnStartedAt, undefined);
    });
  });

  describe("error (terminal, no pending)", () => {
    it("sets active=false, pending=false after terminal clear", () => {
      const cleared = applyTerminalEffect("error", {
        pending: true,
        turnStartedAt: TS,
      });
      const props = deriveStatusBarProps("claude:session-1", "error", cleared);
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.pending, false);
    });
  });

  // ── Full lifecycle simulation ────────────────────────────────────────────

  describe("full lifecycle: send → running → done → idle", () => {
    it("transitions through all phases correctly", () => {
      // 1. User sends message
      let state: LayoutState = { pending: true, turnStartedAt: TS };
      let props = deriveStatusBarProps("claude:sess-1", "idle", state);
      assert.strictEqual(props.pending, true);
      assert.strictEqual(props.active, false);
      assert.ok(props.turnStartedAt);

      // 2. Agent starts running (timer fires after 400ms)
      state = applyRunningTimer("running", state, true);
      props = deriveStatusBarProps("claude:sess-1", "running", state);
      assert.strictEqual(props.pending, false);
      assert.strictEqual(props.active, true);
      assert.strictEqual(props.action, "Waiting for claude\u2026");

      // 3. Session completes with "done"
      state = applyTerminalEffect("done", state);
      props = deriveStatusBarProps("claude:sess-1", "done", state);
      assert.strictEqual(props.pending, false);
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.action, undefined);
      assert.strictEqual(props.turnStartedAt, undefined);
    });

    it("full lifecycle: send → done (fast agent, no running state)", () => {
      let state: LayoutState = { pending: true, turnStartedAt: TS };
      // Fast agent: status goes idle → done without ever being "running"
      state = applyTerminalEffect("done", state);
      const props = deriveStatusBarProps("claude:sess-1", "done", state);
      assert.strictEqual(props.pending, false);
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.turnStartedAt, undefined);
    });

    it("full lifecycle: send → running → cancelled", () => {
      let state: LayoutState = { pending: true, turnStartedAt: TS };
      // Agent running
      state = applyRunningTimer("running", state, true);
      // User cancels
      state = applyTerminalEffect("cancelled", state);
      const props = deriveStatusBarProps("claude:sess-1", "cancelled", state);
      assert.strictEqual(props.pending, false);
      assert.strictEqual(props.active, false);
      assert.strictEqual(props.turnStartedAt, undefined);
    });
  });
});
