import * as assert from "assert";
import { describe, it } from "mocha";
import { deriveStreamingState } from "../../../components/sessions/SessionStatusBar";

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE = {
  sessionKey: "agent1:sess-abc",
  active: false,
  action: undefined as string | undefined,
  turnStartedAt: undefined as string | undefined,
  pending: false,
  sessionStatus: "idle" as string | undefined,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SessionStatusBar deriveStreamingState", () => {
  // ── Idle ──────────────────────────────────────────────────────────────────

  describe("idle", () => {
    it("returns idle when nothing is happening", () => {
      const result = deriveStreamingState({ ...BASE });
      assert.strictEqual(result.phase, "idle");
      assert.strictEqual(result.actionLabel, null);
    });

    it("returns idle when sessionStatus is completed", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionStatus: "completed",
      });
      assert.strictEqual(result.phase, "idle");
    });

    it("returns idle when sessionStatus is error", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionStatus: "error",
      });
      assert.strictEqual(result.phase, "idle");
    });

    it("returns idle when pending is true but turnStartedAt is missing", () => {
      const result = deriveStreamingState({
        ...BASE,
        pending: true,
      });
      assert.strictEqual(result.phase, "idle");
    });
  });

  // ── Sending ───────────────────────────────────────────────────────────────

  describe("sending", () => {
    it("returns sending when pending and turnStartedAt are set", () => {
      const ts = new Date().toISOString();
      const result = deriveStreamingState({
        ...BASE,
        pending: true,
        turnStartedAt: ts,
      });
      assert.strictEqual(result.phase, "sending");
      assert.strictEqual(result.actionLabel, null);
      assert.strictEqual(result.anchorMs, new Date(ts).getTime());
    });

    it("returns sending even when session is already running (race condition)", () => {
      const ts = new Date().toISOString();
      const result = deriveStreamingState({
        ...BASE,
        pending: true,
        turnStartedAt: ts,
        sessionStatus: "running",
      });
      assert.strictEqual(result.phase, "sending");
    });

    it("returns sending even when active prop is true", () => {
      const ts = new Date().toISOString();
      const result = deriveStreamingState({
        ...BASE,
        pending: true,
        turnStartedAt: ts,
        active: true,
      });
      assert.strictEqual(result.phase, "sending");
    });

    it("does NOT return sending when isCancelling", () => {
      const ts = new Date().toISOString();
      const result = deriveStreamingState({
        ...BASE,
        pending: true,
        turnStartedAt: ts,
        sessionStatus: "cancelling",
      });
      assert.strictEqual(result.phase, "cancelling");
    });
  });

  // ── Waiting ───────────────────────────────────────────────────────────────

  describe("waiting", () => {
    it("returns waiting when sessionStatus is running", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionStatus: "running",
      });
      assert.strictEqual(result.phase, "waiting");
      assert.ok(result.actionLabel?.startsWith("Waiting for"));
    });

    it("returns waiting when active prop is true", () => {
      const result = deriveStreamingState({
        ...BASE,
        active: true,
      });
      assert.strictEqual(result.phase, "waiting");
    });

    it("uses custom action label when provided", () => {
      const result = deriveStreamingState({
        ...BASE,
        active: true,
        action: "Reading src/auth.ts",
      });
      assert.strictEqual(result.phase, "waiting");
      assert.strictEqual(result.actionLabel, "Reading src/auth.ts");
    });

    it("extracts agent name from sessionKey for default label", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionKey: "myagent:sess-xyz",
        sessionStatus: "running",
      });
      assert.strictEqual(result.actionLabel, "Waiting for myagent\u2026");
    });

    it("uses generic label when sessionKey is null", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionKey: null,
        active: true,
      });
      assert.strictEqual(result.actionLabel, "Waiting\u2026");
    });

    it("does NOT return waiting when pending is true but session is running (sending takes priority only with turnStartedAt)", () => {
      const result = deriveStreamingState({
        ...BASE,
        pending: true,
        sessionStatus: "running",
      });
      // Without turnStartedAt, showSending is false → waiting
      assert.strictEqual(result.phase, "waiting");
    });
  });

  // ── Cancelling ────────────────────────────────────────────────────────────

  describe("cancelling", () => {
    it("returns cancelling when sessionStatus is cancelling", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionStatus: "cancelling",
      });
      assert.strictEqual(result.phase, "cancelling");
      assert.strictEqual(result.actionLabel, null);
    });

    it("cancelling takes priority over sending", () => {
      const ts = new Date().toISOString();
      const result = deriveStreamingState({
        ...BASE,
        pending: true,
        turnStartedAt: ts,
        sessionStatus: "cancelling",
      });
      assert.strictEqual(result.phase, "cancelling");
    });

    it("cancelling takes priority over waiting", () => {
      const result = deriveStreamingState({
        ...BASE,
        active: true,
        sessionStatus: "cancelling",
      });
      assert.strictEqual(result.phase, "cancelling");
    });
  });

  // ── Transition scenarios (the bug that was fixed) ─────────────────────────

  describe("transition: sending → waiting (unfocused session)", () => {
    it("transitions from sending to waiting when pending is cleared externally", () => {
      const ts = new Date().toISOString();

      // User sends a message → pending=true, turnStartedAt set
      const sending = deriveStreamingState({
        ...BASE,
        pending: true,
        turnStartedAt: ts,
        sessionStatus: "idle",
      });
      assert.strictEqual(sending.phase, "sending");

      // User switches to another session. UnifiedMode clears pending for the
      // unfocused session once status becomes "running". The component no
      // longer receives pending=true, so deriveStreamingState returns waiting.
      const waiting = deriveStreamingState({
        ...BASE,
        pending: false, // cleared by UnifiedMode subscription
        turnStartedAt: ts,
        sessionStatus: "running",
      });
      assert.strictEqual(waiting.phase, "waiting");
    });

    it("stays at sending if pending is NOT cleared (the original bug)", () => {
      const ts = new Date().toISOString();

      // If UnifiedMode fails to clear pending, the component stays at sending
      // even though the agent is already running — this was the reported bug.
      const stuck = deriveStreamingState({
        ...BASE,
        pending: true, // never cleared
        turnStartedAt: ts,
        sessionStatus: "running",
      });
      assert.strictEqual(stuck.phase, "sending");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns idle for null sessionKey even when sessionStatus is running (no key → no storedActive)", () => {
      // When sessionKey is null, storedActive cannot be resolved from the
      // session store, so effectiveActive falls back to the `active` prop.
      // With active=false and no sessionKey, the phase is idle.
      const result = deriveStreamingState({
        ...BASE,
        sessionKey: null,
        sessionStatus: "running",
      });
      assert.strictEqual(result.phase, "idle");
    });

    it("returns waiting for null sessionKey when active prop is true", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionKey: null,
        active: true,
      });
      assert.strictEqual(result.phase, "waiting");
      assert.strictEqual(result.actionLabel, "Waiting\u2026");
    });

    it("handles undefined sessionStatus", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionStatus: undefined,
      });
      assert.strictEqual(result.phase, "idle");
    });

    it("handles sessionKey without colon", () => {
      const result = deriveStreamingState({
        ...BASE,
        sessionKey: "noColon",
        sessionStatus: "running",
      });
      assert.strictEqual(result.phase, "waiting");
      assert.strictEqual(result.actionLabel, "Waiting for noColon\u2026");
    });
  });
});
