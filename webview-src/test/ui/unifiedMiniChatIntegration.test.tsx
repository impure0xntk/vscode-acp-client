import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { AppContainer } from "../../containers/AppContainer";
import { MiniChatContainer } from "../../containers/MiniChatContainer";
import { useSessionStore } from "../../store/sessionStore";
import { useUiStateStore } from "../../store/uiStateStore";
import { useMeshStore } from "../../store/meshStore";
import type { SessionInfoDTO } from "../../store/sessionStore";

const postMessage = vi.fn();
vi.stubGlobal("acquireVsCodeApi", () => ({
  postMessage,
  getState: () => ({}),
  setState: vi.fn(),
}));

function mkInfo(
  agentId: string,
  sessionId: string,
  title: string,
  overrides: Partial<SessionInfoDTO> = {}
): SessionInfoDTO {
  return {
    sessionId,
    agentId,
    title,
    status: "idle",
    lastTurnOutcome: null,
    isStreaming: false,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    createdAt: new Date().toISOString(),
    lastResponseAt: null,
    sessionColor: "#3b82f6",
    ...overrides,
  };
}

function resetAllStores(): void {
  useSessionStore.setState({
    sessionInfoMap: {},
    tabOrder: [],
    tabTitles: {},
    tabIcons: {},
    activeSessionKey: null,
    connectedAgents: [],
    agentInfoMap: {},
    workspaceFolders: [],
    sessionCommands: {},
    pinnedSessionKeys: [],
    currentPlan: null,
    planHistory: [],
    completionNotification: null,
  } as any);
  useUiStateStore.setState({
    overviewVisible: false,
    overviewWidth: 280,
    overviewPosition: "right",
    overviewFilter: "all",
    overviewExpandedSessions: [],
    overviewSelectedSessionIds: [],
    overviewSelectionMode: false,
  } as any);
  useMeshStore.setState({
    sendTargets: [],
    communicationMode: null,
    selectedTeam: null,
    meshPanelVisible: false,
  } as any);
}

function seedOneSession(): void {
  useSessionStore.getState().bulkSetTabs({
    tabs: [
      { agentId: "claude", sessionId: "session-1", title: "Main Session" },
    ],
    sessionInfoMap: {
      "claude:session-1": mkInfo("claude", "session-1", "Main Session"),
    },
    connectedAgents: [{ agentId: "claude", name: "Claude", color: "#3b82f6" }],
  });
  useSessionStore.getState().setActiveSession("claude:session-1");
}

function seedTwoSessions(): void {
  useSessionStore.getState().bulkSetTabs({
    tabs: [
      { agentId: "claude", sessionId: "session-1", title: "Main Session" },
      { agentId: "gpt", sessionId: "session-2", title: "Other Session" },
    ],
    sessionInfoMap: {
      "claude:session-1": mkInfo("claude", "session-1", "Main Session"),
      "gpt:session-2": mkInfo("gpt", "session-2", "Other Session"),
    },
    connectedAgents: [
      { agentId: "claude", name: "Claude", color: "#3b82f6" },
      { agentId: "gpt", name: "GPT", color: "#22c55e" },
    ],
  });
  useSessionStore.getState().setActiveSession("claude:session-1");
}

describe("UnifiedChat + MiniChat integration", () => {
  beforeEach(() => {
    cleanup();
    postMessage.mockClear();
    resetAllStores();
  });

  // ── Shared state: session list ──────────────────────────────────

  it("both panels show the same session in their overviews", () => {
    seedOneSession();
    const { container: unified } = render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    // Unified panel: session tab bar shows "Main Session"
    expect(unified.querySelector("div[role='button']")?.textContent).toContain(
      "Main Session"
    );

    // MiniChat panel: overview card shows "Main Session"
    expect(mini.querySelector(".session-overview-card")).toBeTruthy();
    expect(mini.textContent).toContain("Main Session");
  });

  it("both panels show two sessions", () => {
    seedTwoSessions();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    // MiniChat overview should list both sessions
    const cards = mini.querySelectorAll(".session-overview-card");
    expect(cards.length).toBe(2);
  });

  // ── Shared state: add session ───────────────────────────────────

  it("adding a session via store is reflected in both panels", () => {
    seedOneSession();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    // Add a new session via the store (simulating extension host message)
    act(() => {
      useSessionStore.getState().bulkSetTabs({
        tabs: [
          { agentId: "claude", sessionId: "session-1", title: "Main Session" },
          { agentId: "claude", sessionId: "session-3", title: "New Session" },
        ],
        sessionInfoMap: {
          "claude:session-1": mkInfo("claude", "session-1", "Main Session"),
          "claude:session-3": mkInfo("claude", "session-3", "New Session"),
        },
      });
    });

    const cards = mini.querySelectorAll(".session-overview-card");
    expect(cards.length).toBe(2);
    expect(mini.textContent).toContain("New Session");
  });

  // ── Shared state: remove session ────────────────────────────────

  it("removing a session via store is reflected in both panels", () => {
    seedTwoSessions();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    expect(mini.querySelectorAll(".session-overview-card").length).toBe(2);

    // Remove session-2 via the store
    act(() => {
      useSessionStore.getState().removeTab("gpt:session-2");
    });

    const cardsAfter = mini.querySelectorAll(".session-overview-card");
    expect(cardsAfter.length).toBe(1);
    expect(mini.textContent).not.toContain("Other Session");
    expect(mini.textContent).toContain("Main Session");
  });

  // ── Shared state: active session switch ─────────────────────────

  it("switching active session propagates to both panels", () => {
    seedTwoSessions();
    render(<AppContainer />);
    render(<MiniChatContainer />);

    // Switch active session via store (simulating extension host message).
    // Containers don't fire postMessage on store-only changes; that's done
    // by the switchTab callback which the extension host calls separately.
    act(() => {
      useSessionStore.getState().setActiveSession("gpt:session-2");
    });

    // Both panels read from the shared store.
    expect(useSessionStore.getState().activeSessionKey).toBe("gpt:session-2");

    // MiniChat renders the new active session's agent as a badge.
    const gptBadges = screen.getAllByText("gpt");
    expect(gptBadges.length).toBeGreaterThanOrEqual(2); // both panels
  });

  // ── Shared state: session status update ─────────────────────────

  it("session status change is reflected in both panels", () => {
    seedOneSession();
    render(<AppContainer />);
    render(<MiniChatContainer />);

    // Update session to running
    act(() => {
      useSessionStore
        .getState()
        .setSessionInfo(
          "claude",
          "session-1",
          mkInfo("claude", "session-1", "Main Session", { status: "running" })
        );
    });

    const info = useSessionStore.getState().sessionInfoMap["claude:session-1"];
    expect(info?.status).toBe("running");

    // MiniChat should show the stop button (running session has cancel)
    expect(
      screen.getAllByTitle(/Stop generation/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("session completion status is reflected", () => {
    seedOneSession();
    render(<AppContainer />);
    render(<MiniChatContainer />);

    act(() => {
      useSessionStore.getState().setSessionInfo(
        "claude",
        "session-1",
        mkInfo("claude", "session-1", "Main Session", {
          status: "completed",
          lastTurnOutcome: "completed",
        })
      );
    });

    const info = useSessionStore.getState().sessionInfoMap["claude:session-1"];
    expect(info?.status).toBe("completed");
    expect(info?.lastTurnOutcome).toBe("completed");
  });

  // ── Shared state: token usage ───────────────────────────────────

  it("token usage update is reflected in both panels", () => {
    seedOneSession();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    act(() => {
      useSessionStore.getState().setSessionInfo(
        "claude",
        "session-1",
        mkInfo("claude", "session-1", "Main Session", {
          tokenUsage: {
            inputTokens: 1500,
            outputTokens: 500,
            totalTokens: 2000,
          },
        })
      );
    });

    // MiniChat overview card shows per-session token usage
    expect(mini.textContent).toContain("1.5k");
    expect(mini.textContent).toContain("500");
  });

  // ── Shared state: connected agents ──────────────────────────────

  it("adding a new agent is visible in both panels", () => {
    seedOneSession();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    // Only Claude is connected initially
    expect(mini.textContent).toContain("claude");

    // Add a new agent via store
    act(() => {
      useSessionStore.getState().setConnectedAgents([
        { agentId: "claude", name: "Claude", color: "#3b82f6" },
        { agentId: "gemini", name: "Gemini", color: "#a855f7" },
      ]);
    });

    // Both panels should have both agents
    const agents = useSessionStore.getState().connectedAgents;
    expect(agents.length).toBe(2);
    expect(agents[1].agentId).toBe("gemini");
  });

  // ── Shared state: session info map updates ──────────────────────

  it("setSessionInfoMap merges into existing map and both panels reflect it", () => {
    seedTwoSessions();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    expect(mini.querySelectorAll(".session-overview-card").length).toBe(2);

    // setSessionInfoMap merges: updates keys present in input, preserves others.
    // Overview cards derive titles from tabTitles first, so we also set the tab title
    // to match what the extension host would do on a real session update.
    act(() => {
      useSessionStore.getState().setSessionInfoMap({
        "claude:session-1": mkInfo("claude", "session-1", "Renamed Session", {
          status: "running",
        }),
      });
      useSessionStore
        .getState()
        .setTabTitle("claude:session-1", "Renamed Session");
    });

    // session-1 title and status updated in infoMap
    expect(
      useSessionStore.getState().sessionInfoMap["claude:session-1"]?.title
    ).toBe("Renamed Session");
    expect(
      useSessionStore.getState().sessionInfoMap["claude:session-1"]?.status
    ).toBe("running");
    // session-2 preserved
    expect(
      useSessionStore.getState().sessionInfoMap["gpt:session-2"]
    ).toBeTruthy();

    // MiniChat cards reflect the title update
    expect(mini.textContent).toContain("Renamed Session");
  });

  // ── MiniChat-specific: drill-down history ───────────────────────

  it("MiniChat opens drill-down history when onExpand is triggered", () => {
    seedOneSession();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    // Before expand: no History text
    expect(mini.querySelector(".session-overview-card")).toBeTruthy();
    expect(mini.textContent).not.toContain("History");

    // Trigger expand via double-click on overview card
    const card = mini.querySelector(".session-overview-card")!;
    act(() => {
      card.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true })
      );
    });

    // History section appears
    expect(mini.textContent).toContain("History");
  });

  it("MiniChat drill-down history persists across store updates", () => {
    seedOneSession();
    render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    // Open drill-down
    const card = mini.querySelector(".session-overview-card")!;
    act(() => {
      card.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true })
      );
    });
    expect(mini.textContent).toContain("History");

    // Update session status — drill-down should stay open
    act(() => {
      useSessionStore
        .getState()
        .setSessionInfo(
          "claude",
          "session-1",
          mkInfo("claude", "session-1", "Main Session", { status: "running" })
        );
    });

    expect(mini.textContent).toContain("History");
  });

  // ── Overview filter sync ────────────────────────────────────────

  it("overview filter change in one panel is visible in the other", () => {
    seedTwoSessions();
    render(<AppContainer />);
    render(<MiniChatContainer />);

    act(() => {
      useUiStateStore.getState().setOverviewFilter("running");
    });

    // Both panels read from the same uiStateStore
    expect(useUiStateStore.getState().overviewFilter).toBe("running");

    // MiniChat shows the filter label
    expect(screen.getByText("Running")).toBeTruthy();
  });

  // ── Composer disabled state ─────────────────────────────────────

  it("both composers are disabled when no session is active", () => {
    render(<AppContainer />);
    render(<MiniChatContainer />);

    // MiniChat composer should show connect-first placeholder
    const miniPlaceholders = screen.getAllByPlaceholderText(
      /Connect to an agent first/
    );
    expect(miniPlaceholders.length).toBeGreaterThanOrEqual(1);

    // Unified panel also shows the empty-state message
    expect(screen.getByText(/No sessions pinned/i)).toBeTruthy();
  });

  // ── Multiple sessions across agents ─────────────────────────────

  it("handles sessions from multiple agents correctly", () => {
    seedTwoSessions();
    render(<AppContainer />);
    render(<MiniChatContainer />);

    // Both agents should appear
    expect(screen.getAllByText("claude").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("gpt").length).toBeGreaterThanOrEqual(1);

    // Both session titles should appear
    expect(screen.getAllByText("Main Session").length).toBeGreaterThanOrEqual(
      1
    );
    expect(screen.getAllByText("Other Session").length).toBeGreaterThanOrEqual(
      1
    );
  });

  // ── Edge: store reset ───────────────────────────────────────────

  it("clearing all sessions from store empties both panels", () => {
    seedTwoSessions();
    const { container: unified } = render(<AppContainer />);
    const { container: mini } = render(<MiniChatContainer />);

    expect(mini.querySelectorAll(".session-overview-card").length).toBe(2);

    // Clear everything
    act(() => {
      useSessionStore.setState({
        sessionInfoMap: {},
        tabOrder: [],
        activeSessionKey: null,
        connectedAgents: [],
        tabTitles: {},
        tabIcons: {},
        pinnedSessionKeys: [],
      } as any);
    });

    // Unified panel shows empty state
    expect(screen.getByText(/No sessions pinned/i)).toBeTruthy();

    // MiniChat shows no cards
    const cardsAfter = mini.querySelectorAll(".session-overview-card");
    expect(cardsAfter.length).toBe(0);
  });

  // ── Token footer reflects latest session totals ─────────────────

  it("total token footer updates when a session's usage changes", () => {
    seedTwoSessions();
    const { container: mini } = render(<MiniChatContainer />);
    render(<AppContainer />);

    // Update session-1 token usage
    act(() => {
      useSessionStore.getState().setSessionInfo(
        "claude",
        "session-1",
        mkInfo("claude", "session-1", "Main Session", {
          tokenUsage: {
            inputTokens: 5000,
            outputTokens: 2000,
            totalTokens: 7000,
          },
        })
      );
    });

    // Overview card shows per-session token usage for the updated session
    expect(mini.textContent).toContain("5.0k");
    expect(mini.textContent).toContain("2.0k");
  });
});
