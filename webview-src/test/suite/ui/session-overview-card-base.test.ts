import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure functions from SessionOverviewCardBase ─────────────────────────────

type SessionColorGroup = "active" | "waiting" | "done";

function sessionColorGroup(status: string): SessionColorGroup {
  if (status === "running") return "active";
  if (status === "waiting" || status === "waiting_for_input") return "waiting";
  return "done";
}

type ElapsedTier = "normal" | "warning" | "critical";

const ELAPSED_WARNING_MS = 10_000;
const ELAPSED_CRITICAL_MS = 30_000;

function elapsedTier(elapsedMs: number): ElapsedTier {
  if (elapsedMs >= ELAPSED_CRITICAL_MS) return "critical";
  if (elapsedMs >= ELAPSED_WARNING_MS) return "warning";
  return "normal";
}

type StatusIconType = string;
type TurnOutcome = "completed" | "error" | "cancelled";

function effectiveStatus(
  status: string,
  lastTurnOutcome: TurnOutcome | null
): StatusIconType {
  if (status === "running") return "running";
  if (lastTurnOutcome) return lastTurnOutcome;
  if (
    status === "idle" ||
    status === "waiting" ||
    status === "waiting_for_input"
  )
    return status;
  return "idle";
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function contextColor(ratio: number): "normal" | "warning" | "critical" {
  if (ratio >= 0.85) return "critical";
  if (ratio >= 0.7) return "warning";
  return "normal";
}

interface ToolbarMeta {
  key: string;
  label: string;
  value: string;
  category?: string;
  contextColor?: "normal" | "warning" | "critical";
  barPct?: number;
}

interface SessionProgress {
  elapsedMs: number;
  tokenUsage: { input: number; output: number; total: number };
  contextWindow?: { used: number; max: number; percentage: number };
  messageCount: number;
  toolCallCount?: number;
  toolCallsCompleted?: number;
}

interface SessionOverviewItem {
  sessionId: string;
  agentId: string;
  title: string;
  status: string;
  lastTurnOutcome: TurnOutcome | null;
  model?: string;
  progress: SessionProgress;
  recentResponses: unknown[];
  createdAt: string;
  lastResponseAt: string | null;
}

function sessionToChips(session: SessionOverviewItem): ToolbarMeta[] {
  const chips: ToolbarMeta[] = [];
  const { progress } = session;

  if (progress.elapsedMs > 0) {
    chips.push({
      key: "dur",
      label: "Duration",
      value: fmtDuration(progress.elapsedMs),
      category: "metrics",
    });
  }

  chips.push({
    key: "tokens",
    label: "Tokens",
    value: `↑${fmt(progress.tokenUsage.input)} ↓${fmt(progress.tokenUsage.output)}`,
    category: "metrics",
  });

  if (progress.contextWindow) {
    const pct = progress.contextWindow.percentage;
    chips.push({
      key: "context",
      label: "Context",
      value: `${pct}%`,
      category: "metrics",
      contextColor: contextColor(pct / 100),
      barPct: pct,
    });
  }

  if (progress.messageCount > 0) {
    chips.push({
      key: "msgs",
      label: "Messages",
      value: `msg:${progress.messageCount}`,
      category: "metrics",
    });
  }

  return chips;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(
  overrides: Partial<SessionOverviewItem> = {}
): SessionOverviewItem {
  return {
    sessionId: "sess-1",
    agentId: "agent1",
    title: "Test Session",
    status: "idle",
    lastTurnOutcome: null,
    model: "claude-3",
    progress: {
      elapsedMs: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
      messageCount: 0,
      toolCallCount: 0,
      toolCallsCompleted: 0,
    },
    recentResponses: [],
    createdAt: new Date().toISOString(),
    lastResponseAt: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("sessionColorGroup", () => {
  it("returns 'active' for running", () => {
    assert.strictEqual(sessionColorGroup("running"), "active");
  });

  it("returns 'waiting' for waiting", () => {
    assert.strictEqual(sessionColorGroup("waiting"), "waiting");
  });

  it("returns 'waiting' for waiting_for_input", () => {
    assert.strictEqual(sessionColorGroup("waiting_for_input"), "waiting");
  });

  it("returns 'done' for idle", () => {
    assert.strictEqual(sessionColorGroup("idle"), "done");
  });

  it("returns 'done' for completed", () => {
    assert.strictEqual(sessionColorGroup("completed"), "done");
  });

  it("returns 'done' for error", () => {
    assert.strictEqual(sessionColorGroup("error"), "done");
  });

  it("returns 'done' for cancelled", () => {
    assert.strictEqual(sessionColorGroup("cancelled"), "done");
  });
});

describe("elapsedTier", () => {
  it("returns 'normal' for 0ms", () => {
    assert.strictEqual(elapsedTier(0), "normal");
  });

  it("returns 'normal' for < 10s", () => {
    assert.strictEqual(elapsedTier(9_999), "normal");
  });

  it("returns 'warning' for exactly 10s", () => {
    assert.strictEqual(elapsedTier(10_000), "warning");
  });

  it("returns 'warning' for 10s-29.9s", () => {
    assert.strictEqual(elapsedTier(29_999), "warning");
  });

  it("returns 'critical' for exactly 30s", () => {
    assert.strictEqual(elapsedTier(30_000), "critical");
  });

  it("returns 'critical' for > 30s", () => {
    assert.strictEqual(elapsedTier(60_000), "critical");
  });
});

describe("effectiveStatus", () => {
  it("returns 'running' when status is running (ignores outcome)", () => {
    assert.strictEqual(effectiveStatus("running", "completed"), "running");
    assert.strictEqual(effectiveStatus("running", "error"), "running");
    assert.strictEqual(effectiveStatus("running", null), "running");
  });

  it("returns lastTurnOutcome when status is idle and outcome is set", () => {
    assert.strictEqual(effectiveStatus("idle", "completed"), "completed");
    assert.strictEqual(effectiveStatus("idle", "error"), "error");
    assert.strictEqual(effectiveStatus("idle", "cancelled"), "cancelled");
  });

  it("returns status when idle and no outcome", () => {
    assert.strictEqual(effectiveStatus("idle", null), "idle");
  });

  it("returns status for waiting states", () => {
    assert.strictEqual(effectiveStatus("waiting", null), "waiting");
    assert.strictEqual(
      effectiveStatus("waiting_for_input", null),
      "waiting_for_input"
    );
  });

  it("returns 'idle' for terminal states without outcome (idle fallback)", () => {
    // When lastTurnOutcome is null, terminal states fall back to "idle"
    assert.strictEqual(effectiveStatus("completed", null), "idle");
    assert.strictEqual(effectiveStatus("error", null), "idle");
    assert.strictEqual(effectiveStatus("cancelled", null), "idle");
  });
});

describe("sessionToChips", () => {
  it("returns tokens chip even for zero usage", () => {
    const session = makeSession();
    const chips = sessionToChips(session);
    const tokenChip = chips.find((c) => c.key === "tokens");
    assert.ok(tokenChip, "tokens chip should exist");
    assert.strictEqual(tokenChip!.category, "metrics");
  });

  it("includes duration chip when elapsedMs > 0", () => {
    const session = makeSession({
      progress: {
        elapsedMs: 5000,
        tokenUsage: { input: 0, output: 0, total: 0 },
        messageCount: 0,
        toolCallCount: 0,
        toolCallsCompleted: 0,
      },
    });
    const chips = sessionToChips(session);
    const durChip = chips.find((c) => c.key === "dur");
    assert.ok(durChip, "duration chip should exist when elapsedMs > 0");
    assert.strictEqual(durChip!.value, "5s");
  });

  it("omits duration chip when elapsedMs is 0", () => {
    const session = makeSession();
    const chips = sessionToChips(session);
    const durChip = chips.find((c) => c.key === "dur");
    assert.strictEqual(durChip, undefined);
  });

  it("includes context chip with percentage when contextWindow is set", () => {
    const session = makeSession({
      progress: {
        elapsedMs: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
        messageCount: 0,
        toolCallCount: 0,
        toolCallsCompleted: 0,
        contextWindow: { used: 700, max: 1000, percentage: 70 },
      },
    });
    const chips = sessionToChips(session);
    const ctxChip = chips.find((c) => c.key === "context");
    assert.ok(ctxChip, "context chip should exist");
    assert.strictEqual(ctxChip!.value, "70%");
    assert.strictEqual(ctxChip!.barPct, 70);
    assert.strictEqual(ctxChip!.contextColor, "warning");
  });

  it("context chip shows critical color at >= 85%", () => {
    const session = makeSession({
      progress: {
        elapsedMs: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
        messageCount: 0,
        toolCallCount: 0,
        toolCallsCompleted: 0,
        contextWindow: { used: 900, max: 1000, percentage: 90 },
      },
    });
    const chips = sessionToChips(session);
    const ctxChip = chips.find((c) => c.key === "context");
    assert.strictEqual(ctxChip!.contextColor, "critical");
  });

  it("context chip shows normal color at < 70%", () => {
    const session = makeSession({
      progress: {
        elapsedMs: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
        messageCount: 0,
        toolCallCount: 0,
        toolCallsCompleted: 0,
        contextWindow: { used: 500, max: 1000, percentage: 50 },
      },
    });
    const chips = sessionToChips(session);
    const ctxChip = chips.find((c) => c.key === "context");
    assert.strictEqual(ctxChip!.contextColor, "normal");
  });

  it("includes messages chip when messageCount > 0", () => {
    const session = makeSession({
      progress: {
        elapsedMs: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
        messageCount: 5,
        toolCallCount: 0,
        toolCallsCompleted: 0,
      },
    });
    const chips = sessionToChips(session);
    const msgChip = chips.find((c) => c.key === "msgs");
    assert.ok(msgChip, "messages chip should exist when messageCount > 0");
    assert.strictEqual(msgChip!.value, "msg:5");
  });

  it("omits messages chip when messageCount is 0", () => {
    const session = makeSession();
    const chips = sessionToChips(session);
    const msgChip = chips.find((c) => c.key === "msgs");
    assert.strictEqual(msgChip, undefined);
  });

  it("all chips have category 'metrics'", () => {
    const session = makeSession({
      progress: {
        elapsedMs: 1000,
        tokenUsage: { input: 500, output: 300, total: 800 },
        messageCount: 3,
        toolCallCount: 1,
        toolCallsCompleted: 1,
        contextWindow: { used: 500, max: 1000, percentage: 50 },
      },
    });
    const chips = sessionToChips(session);
    for (const chip of chips) {
      assert.strictEqual(chip.category, "metrics");
    }
  });
});

describe("fmt (session overview)", () => {
  it("returns plain string for < 1000", () => {
    assert.strictEqual(fmt(0), "0");
    assert.strictEqual(fmt(999), "999");
  });

  it("formats thousands with 'k'", () => {
    assert.strictEqual(fmt(1000), "1.0k");
    assert.strictEqual(fmt(1500), "1.5k");
  });

  it("formats millions with 'm'", () => {
    assert.strictEqual(fmt(1_000_000), "1.0m");
    assert.strictEqual(fmt(2_500_000), "2.5m");
  });
});

describe("fmtDuration (session overview)", () => {
  it("formats seconds", () => {
    assert.strictEqual(fmtDuration(0), "0s");
    assert.strictEqual(fmtDuration(5000), "5s");
  });

  it("formats minutes and seconds", () => {
    assert.strictEqual(fmtDuration(60_000), "1m 0s");
    assert.strictEqual(fmtDuration(90_000), "1m 30s");
  });

  it("formats hours and minutes", () => {
    assert.strictEqual(fmtDuration(3_600_000), "1h 0m");
    assert.strictEqual(fmtDuration(3_660_000), "1h 1m");
  });
});
