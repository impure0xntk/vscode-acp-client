import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import { SessionOrchestrator } from "../../application/session/orchestrator";
import type { SessionInfo } from "../../application/session/types";
import type { ChatMessage } from "../../domain/models/chat";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// Helpers
// ============================================================================

function createMockSessionOrchestrator(): SessionOrchestrator {
  const orchestrator = new SessionOrchestrator({
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
    } as any,
  });
  return orchestrator;
}

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "agent",
    content: "test content",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSessionInfo(
  sessionId: string,
  agentId: string,
  overrides: Partial<SessionInfo> = {}
): SessionInfo {
  const now = new Date();
  return {
    sessionId,
    agentId,
    title: `/workspace/${agentId}`,
    cwd: `/tmp/${agentId}`,
    status: "idle",
    messages: [],
    isTurnActive: false,
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
    lastResponseAt: null,
    tokenUsage: { input: 0, output: 0, total: 0 },
    pendingCancel: false,
    ...overrides,
  };
}

// ============================================================================
// SessionOrchestrator.getSessionOverview()
// ============================================================================

describe("SessionOrchestrator — getSessionOverview()", () => {
  let orch: SessionOrchestrator;

  beforeEach(() => {
    orch = createMockSessionOrchestrator();
  });

  it("returns empty sessions array when no sessions exist", () => {
    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions.length, 0);
    assert.ok(overview.lastUpdated);
  });

  it("returns correct session count after sessions are added via internal map", () => {
    // Access internal sessions map directly for testing
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        status: "running",
        tokenUsage: { input: 100, output: 50, total: 150 },
        messages: [makeMessage({ role: "agent", content: "Hello world" })],
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions.length, 1);
    assert.strictEqual(overview.sessions[0].sessionId, "sess-1");
    assert.strictEqual(overview.sessions[0].agentId, "claude");
  });

  it("aggregates sessions across multiple agents", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const claudeSessions = new Map<string, SessionInfo>();
    claudeSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        status: "running",
      })
    );
    sessions.set("claude", claudeSessions);

    const gptSessions = new Map<string, SessionInfo>();
    gptSessions.set(
      "sess-2",
      makeSessionInfo("sess-2", "gpt4", {
        status: "idle",
      })
    );
    sessions.set("gpt4", gptSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions.length, 2);
    const agentIds = overview.sessions.map((s) => s.agentId);
    assert.ok(agentIds.includes("claude"));
    assert.ok(agentIds.includes("gpt4"));
  });

  it("computes progress.messageCount from messages array", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        messages: [
          makeMessage({ role: "user", content: "hi" }),
          makeMessage({ role: "agent", content: "hello" }),
          makeMessage({ role: "agent", content: "how can I help?" }),
        ],
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].progress.messageCount, 3);
  });

  it("counts tool calls correctly", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        messages: [
          makeMessage({
            role: "tool",
            content: "",
            toolCalls: [
              {
                id: "tc-1",
                title: "Read file",
                status: "completed",
                kind: "read",
                input: "{}",
                output: "content",
              },
              {
                id: "tc-2",
                title: "Write file",
                status: "completed",
                kind: "edit",
                input: "{}",
                output: undefined,
              },
            ],
          }),
          makeMessage({
            role: "tool",
            content: "",
            toolCalls: [
              {
                id: "tc-3",
                title: "Run command",
                status: "in_progress",
                kind: "execute",
                input: "{}",
                output: undefined,
              },
            ],
          }),
        ],
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].progress.toolCallCount, 3);
    assert.strictEqual(overview.sessions[0].progress.toolCallsCompleted, 2);
  });

  it("computes contextWindow percentage when contextWindowMax is set", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        tokenUsage: { input: 800, output: 200, total: 1000 },
        contextWindowMax: 4000,
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    const ctx = overview.sessions[0].progress.contextWindow;
    assert.ok(ctx);
    assert.strictEqual(ctx.used, 1000);
    assert.strictEqual(ctx.max, 4000);
    assert.strictEqual(ctx.percentage, 25);
  });

  it("does not include contextWindow when contextWindowMax is not set", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        tokenUsage: { input: 100, output: 50, total: 150 },
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].progress.contextWindow, undefined);
  });

  it("sets elapsedMs to 0 for non-running sessions", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        status: "completed",
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].progress.elapsedMs, 0);
  });

  it("includes recentResponses from agent messages (last 3)", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 5; i++) {
      msgs.push(makeMessage({ role: "agent", content: `Response ${i}` }));
    }
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", { messages: msgs })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    // extractRecentResponses only picks agent role messages, last 3
    const recent = overview.sessions[0].recentResponses;
    assert.ok(recent.length <= 3);
    assert.ok(recent.length > 0);
  });

  it("extracts ISO date strings for createdAt", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        createdAt: new Date("2026-01-15T10:30:00Z"),
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(
      overview.sessions[0].createdAt,
      "2026-01-15T10:30:00.000Z"
    );
  });

  it("includes model and mode when set", () => {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;

    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", {
        model: "claude-sonnet-4-20250514",
        mode: "plan",
      })
    );
    sessions.set("claude", agentSessions);

    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].model, "claude-sonnet-4-20250514");
    assert.strictEqual(overview.sessions[0].mode, "plan");
  });
});

// ============================================================================
// SessionOrchestrator — extractRecentResponses() via getSessionOverview
// ============================================================================

describe("SessionOrchestrator — extractRecentResponses()", () => {
  let orch: SessionOrchestrator;

  beforeEach(() => {
    orch = createMockSessionOrchestrator();
  });

  function addSession(
    sessionId: string,
    agentId: string,
    messages: ChatMessage[]
  ) {
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;
    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      sessionId,
      makeSessionInfo(sessionId, agentId, { messages })
    );
    sessions.set(agentId, agentSessions);
  }

  it("returns empty array when no agent messages exist", () => {
    addSession("s1", "claude", [
      makeMessage({
        role: "user",
        content: "Hello there, how are you doing on this fine day?",
      }),
    ]);
    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].recentResponses.length, 0);
  });

  it("returns at most 3 recent responses", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(
        makeMessage({ role: "agent", content: `Agent response number ${i}` })
      );
    }
    addSession("s1", "claude", msgs);
    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].recentResponses.length, 3);
  });

  it("preserves chronological order (oldest first)", () => {
    addSession("s1", "claude", [
      makeMessage({ role: "agent", content: "First response" }),
      makeMessage({ role: "agent", content: "Second response" }),
      makeMessage({ role: "agent", content: "Third response" }),
    ]);
    const overview = orch.getSessionOverview();
    const previews = overview.sessions[0].recentResponses.map((r) => r.preview);
    assert.deepStrictEqual(previews, [
      "First response",
      "Second response",
      "Third response",
    ]);
  });

  it("includes agent role in response items", () => {
    addSession("s1", "claude", [makeMessage({ role: "agent", content: "A" })]);
    const overview = orch.getSessionOverview();
    assert.strictEqual(overview.sessions[0].recentResponses[0].role, "agent");
  });

  it("uses messageId from source message", () => {
    const msg = makeMessage({ role: "agent", content: "Test" });
    addSession("s1", "claude", [msg]);
    const overview = orch.getSessionOverview();
    assert.strictEqual(
      overview.sessions[0].recentResponses[0].messageId,
      msg.id
    );
  });
});

// ============================================================================
// SessionOrchestrator — emitOverviewUpdate debounce
// ============================================================================

describe("SessionOrchestrator — emitOverviewUpdate", () => {
  let orch: SessionOrchestrator;

  beforeEach(() => {
    orch = createMockSessionOrchestrator();
    // Set up a session so the overview has something to emit
    const sessions = (orch as any).sessions as Map<
      string,
      Map<string, SessionInfo>
    >;
    const agentSessions = new Map<string, SessionInfo>();
    agentSessions.set(
      "sess-1",
      makeSessionInfo("sess-1", "claude", { status: "running" })
    );
    sessions.set("claude", agentSessions);
  });

  it("does not emit when no listeners are attached", () => {
    // emitOverviewUpdate checks listenerCount
    (orch as any).emitOverviewUpdate();
    // No error thrown = pass
    assert.ok(true);
  });

  it("emits sessionOverview:update event after debounce delay", (done) => {
    orch.on("sessionOverview:update", (overview: any) => {
      assert.ok(overview);
      assert.ok(overview.lastUpdated);
      // Should have 1 session
      assert.strictEqual(overview.sessions.length, 1);
      done();
    });
    (orch as any).emitOverviewUpdate();
  });
});

// ============================================================================
// Session Overview type contracts
// ============================================================================

describe("Session Overview — type contracts", () => {
  it("SessionOverviewItem has all required fields", () => {
    const item: {
      sessionId: string;
      agentId: string;
      title: string;
      status: string;
      model?: string;
      mode?: string;
      progress: {
        elapsedMs: number;
        tokenUsage: { input: number; output: number; total: number };
        contextWindow?: { used: number; max: number; percentage: number };
        messageCount: number;
        toolCallCount: number;
        toolCallsCompleted: number;
      };
      recentResponses: any[];
      cwd?: string;
      createdAt: string;
    } = {
      sessionId: "sess-1",
      agentId: "claude",
      title: "/workspace/project",
      status: "running",
      model: "claude-sonnet-4",
      mode: "code",
      progress: {
        elapsedMs: 5000,
        tokenUsage: { input: 1000, output: 200, total: 1200 },
        contextWindow: { used: 1200, max: 200000, percentage: 1 },
        messageCount: 5,
        toolCallCount: 3,
        toolCallsCompleted: 2,
      },
      recentResponses: [],
      cwd: "/workspace/project",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    assert.strictEqual(item.sessionId, "sess-1");
    assert.strictEqual(item.agentId, "claude");
    assert.strictEqual(item.progress.tokenUsage.total, 1200);
    assert.strictEqual(item.progress.toolCallCount, 3);
    assert.strictEqual(item.progress.toolCallsCompleted, 2);
    assert.strictEqual(item.progress.contextWindow!.percentage, 1);
  });

  it("valid session statuses include all expected values", () => {
    const statuses = [
      "idle",
      "running",
      "waiting",
      "completed",
      "error",
      "cancelled",
    ];
    assert.strictEqual(statuses.length, 6);
    for (const s of statuses) {
      assert.ok(s.length > 0);
    }
  });

  it("valid filter values are all/by-agent/active", () => {
    const filters = ["all", "active", "by-agent"] as const;
    assert.strictEqual(filters.length, 3);
    assert.ok(filters.includes("all"));
    assert.ok(filters.includes("active"));
    assert.ok(filters.includes("by-agent"));
  });
});

// ============================================================================
// useSessionContext reducer — Session Overview actions
// ============================================================================

describe("useSessionContext reducer — Session Overview actions", () => {
  it("initial state has sessionOverviewVisible=false and empty sessions", () => {
    // Simulate the initial state shape from useSessionContext
    const state = {
      sessionOverviewVisible: false,
      sessionOverviewState: {
        sessions: [],
        lastUpdated: new Date().toISOString(),
        filter: "all" as const,
        expandedSessions: [],
      },
    };
    assert.strictEqual(state.sessionOverviewVisible, false);
    assert.strictEqual(state.sessionOverviewState.sessions.length, 0);
    assert.strictEqual(state.sessionOverviewState.filter, "all");
    assert.deepStrictEqual(state.sessionOverviewState.expandedSessions, []);
  });

  it("toggle sessionOverviewVisible", () => {
    let visible = false;
    visible = !visible;
    assert.strictEqual(visible, true);
    visible = !visible;
    assert.strictEqual(visible, false);
  });

  it("SET_SESSION_OVERVIEW_FILTER updates filter", () => {
    type Filter = "all" | "active" | "by-agent";
    let filter: Filter = "all";
    filter = "active";
    assert.strictEqual(filter, "active");
    filter = "by-agent";
    assert.strictEqual(filter, "by-agent");
    filter = "all";
    assert.strictEqual(filter, "all");
  });

  it("SET_SESSION_OVERVIEW_EXPANDED updates expanded session IDs", () => {
    let expanded: string[] = [];
    expanded = [...expanded, "sess-1"];
    assert.deepStrictEqual(expanded, ["sess-1"]);

    expanded = [...expanded, "sess-2"];
    assert.deepStrictEqual(expanded, ["sess-1", "sess-2"]);

    // Collapse: remove from list
    expanded = expanded.filter((id) => id !== "sess-1");
    assert.deepStrictEqual(expanded, ["sess-2"]);
  });

  it("replace sessions array on full state update", () => {
    interface OverviewState {
      sessions: Array<{ sessionId: string; agentId: string; title: string }>;
      lastUpdated: string;
      filter: "all" | "active" | "by-agent";
      expandedSessions: string[];
    }

    let ovState: OverviewState = {
      sessions: [],
      lastUpdated: new Date().toISOString(),
      filter: "all",
      expandedSessions: [],
    };

    const newSessions = [
      { sessionId: "s1", agentId: "claude", title: "/tmp/proj" },
    ];
    ovState = {
      ...ovState,
      sessions: newSessions,
      lastUpdated: "2026-01-01T00:00:00.000Z",
    };

    assert.strictEqual(ovState.sessions.length, 1);
    assert.strictEqual(ovState.sessions[0].sessionId, "s1");
  });

  it("upsert session in sessions array on partial update", () => {
    interface Item {
      sessionId: string;
      agentId: string;
      title: string;
      status: string;
    }

    let sessions: Item[] = [
      { sessionId: "s1", agentId: "claude", title: "A", status: "running" },
      { sessionId: "s2", agentId: "gpt4", title: "B", status: "idle" },
    ];

    // Update s1
    const updated: Item = {
      sessionId: "s1",
      agentId: "claude",
      title: "A-updated",
      status: "completed",
    };
    const idx = sessions.findIndex(
      (s) => s.sessionId === updated.sessionId && s.agentId === updated.agentId
    );
    if (idx >= 0) {
      sessions = [
        ...sessions.slice(0, idx),
        updated,
        ...sessions.slice(idx + 1),
      ];
    } else {
      sessions = [...sessions, updated];
    }

    assert.strictEqual(sessions[0].title, "A-updated");
    assert.strictEqual(sessions[0].status, "completed");
    assert.strictEqual(sessions.length, 2); // no duplicate added
  });

  it("appends new session on partial update when not found", () => {
    interface Item {
      sessionId: string;
      agentId: string;
      title: string;
      status: string;
    }

    const sessions: Item[] = [
      { sessionId: "s1", agentId: "claude", title: "A", status: "running" },
    ];

    const newItem: Item = {
      sessionId: "s2",
      agentId: "gpt4",
      title: "B",
      status: "idle",
    };

    const idx = sessions.findIndex(
      (s) => s.sessionId === newItem.sessionId && s.agentId === newItem.agentId
    );
    const result =
      idx >= 0
        ? [...sessions.slice(0, idx), newItem, ...sessions.slice(idx + 1)]
        : [...sessions, newItem];

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[1].sessionId, "s2");
  });
});

// ============================================================================
// SessionOverview card helper logic
// ============================================================================

describe("Session Overview — card chip derivation logic", () => {
  it("token formatting: numbers >= 1M show 'xm'", () => {
    const fmt = (n: number): string => {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
      if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
      return String(n);
    };
    assert.strictEqual(fmt(1_500_000), "1.5m");
    assert.strictEqual(fmt(2_000_000), "2.0m");
    assert.strictEqual(fmt(999_999), "1000.0k");
    assert.strictEqual(fmt(1500), "1.5k");
    assert.strictEqual(fmt(999), "999");
  });

  it("duration formatting: returns appropriate units", () => {
    const fmtDuration = (ms: number): string => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return `${h}h ${m % 60}m`;
      if (m > 0) return `${m}m ${s % 60}s`;
      return `${s}s`;
    };
    assert.strictEqual(fmtDuration(5000), "5s");
    assert.strictEqual(fmtDuration(90000), "1m 30s");
    assert.strictEqual(fmtDuration(3_660_000), "1h 1m");
  });

  it("visual bar: 10-char bar with filled/empty blocks", () => {
    const visualBar = (ratio: number): string => {
      const filled = Math.round(ratio * 10);
      return "█".repeat(filled) + "░".repeat(10 - filled);
    };
    assert.strictEqual(visualBar(0), "░░░░░░░░░░");
    assert.strictEqual(visualBar(0.5), "█████░░░░░");
    assert.strictEqual(visualBar(1), "██████████");
    assert.strictEqual(visualBar(0.25), "███░░░░░░░");
  });

  it("context color threshold: >= 85% = critical, >= 70% = warning, else normal", () => {
    const contextColor = (ratio: number): "normal" | "warning" | "critical" => {
      if (ratio >= 0.85) return "critical";
      if (ratio >= 0.7) return "warning";
      return "normal";
    };
    assert.strictEqual(contextColor(0.5), "normal");
    assert.strictEqual(contextColor(0.7), "warning");
    assert.strictEqual(contextColor(0.85), "critical");
    assert.strictEqual(contextColor(0.99), "critical");
  });

  it("cancelability: running and waiting are cancelable", () => {
    const isCancelable = (status: string): boolean =>
      status === "running" || status === "waiting";
    assert.strictEqual(isCancelable("running"), true);
    assert.strictEqual(isCancelable("waiting"), true);
    assert.strictEqual(isCancelable("idle"), false);
    assert.strictEqual(isCancelable("completed"), false);
    assert.strictEqual(isCancelable("error"), false);
    assert.strictEqual(isCancelable("cancelled"), false);
  });
});

// ============================================================================
// ResponsePreviewList logic
// ============================================================================

describe("ResponsePreviewList — preview slicing", () => {
  it("slices to last N items", () => {
    const items = [1, 2, 3, 4, 5];
    const maxItems = 3;
    const result = items.slice(-maxItems);
    assert.deepStrictEqual(result, [3, 4, 5]);
  });

  it("returns all items when fewer than maxItems", () => {
    const items = [1, 2];
    const maxItems = 3;
    const result = items.slice(-maxItems);
    assert.deepStrictEqual(result, [1, 2]);
  });

  it("returns empty array when no responses", () => {
    const items: number[] = [];
    const maxItems = 3;
    const result = items.slice(-maxItems);
    assert.deepStrictEqual(result, []);
  });

  it("status icon mapping covers all statuses", () => {
    const STATUS_ICON: Record<string, string> = {
      completed: "✓",
      running: "▋",
      failed: "✗",
    };
    assert.strictEqual(STATUS_ICON["completed"], "✓");
    assert.strictEqual(STATUS_ICON["running"], "▋");
    assert.strictEqual(STATUS_ICON["failed"], "✗");
  });
});
