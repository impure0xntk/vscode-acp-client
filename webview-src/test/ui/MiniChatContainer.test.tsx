import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { MiniChatContainer } from "../../containers/MiniChatContainer";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import { useUiStateStore } from "../../store/uiStateStore";
import { useMeshStore } from "../../store/meshStore";
import { useMessageStore } from "../../store/messageStore";
import type { SessionInfoDTO } from "../../store/sessionStore";
import type { ChatMessage } from "../../types";

const postMessage = vi.fn();
vi.stubGlobal("acquireVsCodeApi", () => ({
  postMessage,
  getState: () => ({}),
  setState: vi.fn(),
}));

const KEY = "claude:session-1";

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

function seedSessions(): void {
  useSessionStore.getState().bulkSetTabs({
    tabs: [{ agentId: "claude", sessionId: "session-1", title: "My Session" }],
    sessionInfoMap: {
      "claude:session-1": mkInfo("claude", "session-1", "My Session"),
    },
    connectedAgents: [{ agentId: "claude", name: "Claude", color: "#3b82f6" }],
  });
  useSessionStore.getState().setActiveSession(KEY);
}

function seedRunningSession(): void {
  useSessionStore.getState().bulkSetTabs({
    tabs: [{ agentId: "claude", sessionId: "session-1", title: "My Session" }],
    sessionInfoMap: {
      "claude:session-1": mkInfo("claude", "session-1", "My Session", {
        status: "running",
      }),
    },
    connectedAgents: [{ agentId: "claude", name: "Claude", color: "#3b82f6" }],
  });
  useSessionStore.getState().setActiveSession(KEY);
}

describe("MiniChatContainer", () => {
  beforeEach(() => {
    cleanup();
    postMessage.mockClear();
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
    });
    useUiStateStore.setState({
      overviewVisible: false,
      overviewWidth: 280,
      overviewPosition: "right",
      overviewFilter: "all",
      overviewExpandedSessions: [],
      overviewSelectedSessionIds: [],
      overviewSelectionMode: false,
    });
    useMeshStore.setState({
      sendTargets: [],
      communicationMode: null,
      selectedTeam: null,
      meshPanelVisible: false,
    });
  });

  it("renders without crashing", () => {
    const { container } = render(<MiniChatContainer />);
    expect(container).toBeTruthy();
  });

  it("renders the SessionOverviewPanel", () => {
    seedSessions();
    render(<MiniChatContainer />);
    expect(screen.getByTitle("New session")).toBeInTheDocument();
  });

  it("renders the Composer", () => {
    seedSessions();
    render(<MiniChatContainer />);
    const textarea = screen.getByPlaceholderText(/Message \(Enter to send/i);
    expect(textarea).toBeInTheDocument();
  });

  it("does NOT render chat history (SessionView) by default (FR-5)", () => {
    seedSessions();
    render(<MiniChatContainer />);
    expect(screen.queryByText("History")).toBeNull();
  });

  it("disables the Composer when no session is active", () => {
    render(<MiniChatContainer />);
    const textarea = screen.getByPlaceholderText(/Connect to an agent first/);
    expect(textarea).toBeDisabled();
  });

  it("shows the total token count footer", () => {
    seedSessions();
    render(<MiniChatContainer />);
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
  });

  it("renders running session status in the overview", () => {
    seedRunningSession();
    const { container } = render(<MiniChatContainer />);
    expect(
      container.querySelector(".session-overview-card")
    ).toBeInTheDocument();
  });

  it("shows the Composer with cancel button when session is running", () => {
    seedRunningSession();
    render(<MiniChatContainer />);
    const stopButton = screen.getByTitle(/Stop generation/);
    expect(stopButton).toBeInTheDocument();
  });

  it("opens drill-down history when onExpand is triggered (FR-12)", () => {
    seedSessions();
    const { container } = render(<MiniChatContainer />);

    const card = container.querySelector(".session-overview-card");
    expect(card).toBeInTheDocument();

    fireEvent.doubleClick(card!);

    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("closes drill-down history when close button is clicked (FR-13)", () => {
    seedSessions();
    const { container } = render(<MiniChatContainer />);

    const card = container.querySelector(".session-overview-card");
    fireEvent.doubleClick(card!);

    expect(screen.getByText("History")).toBeInTheDocument();

    const closeBtn = screen.getByLabelText("Close history");
    fireEvent.click(closeBtn);

    expect(screen.queryByText("History")).toBeNull();
  });

  it("shows the New session button and invokes it", () => {
    seedSessions();
    render(<MiniChatContainer />);

    const newBtn = screen.getByTitle("New session");
    fireEvent.click(newBtn);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "openNewSessionPicker" })
    );
  });

  it("displays connected agent in the overview", () => {
    seedSessions();
    render(<MiniChatContainer />);

    // Agent badge shows agent ID (there may be two "claude" nodes).
    const matches = screen.getAllByText("claude");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("Composer is enabled when session is active", () => {
    seedSessions();
    render(<MiniChatContainer />);

    const textarea = screen.getByPlaceholderText(/Message \(Enter to send/i);
    expect(textarea).not.toBeDisabled();
  });

  it("syncs overview filter from uiStateStore", () => {
    seedSessions();
    // FR-9: overview filter is stored in uiStateStore and shown in the panel.
    useUiStateStore.getState().setOverviewFilter("running");
    render(<MiniChatContainer />);

    // The filter button shows the active filter label.
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("switches overview filter to all", () => {
    seedSessions();
    useUiStateStore.getState().setOverviewFilter("completed");
    const { unmount } = render(<MiniChatContainer />);

    // After switching to "completed", the toolbar shows "Completed".
    expect(screen.getByText("Completed")).toBeInTheDocument();

    // Switch back to "all" and unmount to flush pending state.
    useUiStateStore.getState().setOverviewFilter("all");
    unmount();

    expect(useUiStateStore.getState().overviewFilter).toBe("all");
  });
});

// ── History drill-down regression tests ────────────────────────────────

describe("MiniChatContainer history drill-down", () => {
  const KEY = "claude:session-1";

  function mkHistoryMessages(): ChatMessage[] {
    return [
      {
        id: "msg-1",
        role: "user",
        content: "Hello",
        timestamp: 1700000000000,
      },
      {
        id: "msg-2",
        role: "agent",
        content: "Hi there!",
        timestamp: 1700000001000,
      },
    ];
  }

  function fireSessionDetail(
    sessionId: string,
    agentId: string,
    messages: ChatMessage[],
    overrides: Record<string, unknown> = {}
  ) {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "history:sessionDetail",
          session: {
            sessionId,
            agentId,
            title: `History: ${sessionId}`,
            createdAt: "2026-01-01T00:00:00Z",
            ...overrides,
          },
          messages,
        },
      })
    );
  }

  beforeEach(() => {
    cleanup();
    postMessage.mockClear();
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
    });
    useUiStateStore.setState({
      overviewVisible: false,
      overviewWidth: 280,
      overviewPosition: "right",
      overviewFilter: "all",
      overviewExpandedSessions: [],
      overviewSelectedSessionIds: [],
      overviewSelectionMode: false,
    });
    useMeshStore.setState({
      sendTargets: [],
      communicationMode: null,
      selectedTeam: null,
      meshPanelVisible: false,
    });
    useMessageStore.setState({
      perSession: {},
      streaming: {},
      promptQueue: {},
      lastSessionUpdateType: {},
    });
  });

  it("sends history:getSession when drill-down is triggered (FR-12)", () => {
    useSessionStore.getState().bulkSetTabs({
      tabs: [
        { agentId: "claude", sessionId: "session-1", title: "My Session" },
      ],
      sessionInfoMap: {
        "claude:session-1": mkInfo("claude", "session-1", "My Session"),
      },
      connectedAgents: [
        { agentId: "claude", name: "Claude", color: "#3b82f6" },
      ],
    });
    useSessionStore.getState().setActiveSession(KEY);

    const { container } = render(<MiniChatContainer />);
    const card = container.querySelector(".session-overview-card");
    fireEvent.doubleClick(card!);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "history:getSession",
        sessionId: "session-1",
        agentId: "claude",
      })
    );
  });

  it("injects messages into messageStore on history:sessionDetail", () => {
    useSessionStore.getState().bulkSetTabs({
      tabs: [
        { agentId: "claude", sessionId: "session-1", title: "My Session" },
      ],
      sessionInfoMap: {
        "claude:session-1": mkInfo("claude", "session-1", "My Session"),
      },
      connectedAgents: [
        { agentId: "claude", name: "Claude", color: "#3b82f6" },
      ],
    });
    useSessionStore.getState().setActiveSession(KEY);

    const { container } = render(<MiniChatContainer />);
    const card = container.querySelector(".session-overview-card");
    fireEvent.doubleClick(card!);

    act(() => {
      fireSessionDetail("session-1", "claude", mkHistoryMessages());
    });

    const msgs = useMessageStore.getState().perSession[KEY];
    expect(msgs).toBeDefined();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Hello");
  });

  it("registers dummy SessionInfoDTO on history:sessionDetail", () => {
    useSessionStore.getState().bulkSetTabs({
      tabs: [
        { agentId: "claude", sessionId: "session-1", title: "My Session" },
      ],
      sessionInfoMap: {
        "claude:session-1": mkInfo("claude", "session-1", "My Session"),
      },
      connectedAgents: [
        { agentId: "claude", name: "Claude", color: "#3b82f6" },
      ],
    });
    useSessionStore.getState().setActiveSession(KEY);

    const { container } = render(<MiniChatContainer />);
    const card = container.querySelector(".session-overview-card");
    fireEvent.doubleClick(card!);

    act(() => {
      fireSessionDetail("session-1", "claude", mkHistoryMessages());
    });

    const info = useSessionStore.getState().sessionInfoMap[KEY];
    expect(info).toBeDefined();
    expect(info?.agentId).toBe("claude");
    expect(info?.sessionId).toBe("session-1");
    expect(info?.title).toBe("History: session-1");

    const tabOrder = useSessionStore.getState().tabOrder;
    expect(tabOrder).toContain(KEY);
  });

  it("preserves pre-existing session on drill-down close and unmount", () => {
    // This test verifies that pre-existing sessions (already in tabOrder)
    // are NOT removed when drill-down closes or component unmounts.
    seedSessions();

    const { container, unmount } = render(<MiniChatContainer />);
    const card = container.querySelector(".session-overview-card");
    fireEvent.doubleClick(card!);

    act(() => {
      fireSessionDetail("session-1", "claude", mkHistoryMessages());
    });

    expect(useMessageStore.getState().perSession[KEY]).toHaveLength(2);
    expect(useSessionStore.getState().sessionInfoMap[KEY]).toBeDefined();

    // Close drill-down
    const closeBtn = screen.getByLabelText("Close history");
    fireEvent.click(closeBtn);
    expect(screen.queryByText("History")).toBeNull();

    // Session should still exist after closing drill-down
    expect(useSessionStore.getState().tabOrder).toContain(KEY);
    expect(useSessionStore.getState().sessionInfoMap[KEY]).toBeDefined();

    unmount();

    // After unmount, pre-existing session should still exist
    expect(useSessionStore.getState().tabOrder).toContain(KEY);
    expect(useSessionStore.getState().sessionInfoMap[KEY]).toBeDefined();
  });

  it("shows History label when drill-down is active", () => {
    useSessionStore.getState().bulkSetTabs({
      tabs: [
        { agentId: "claude", sessionId: "session-1", title: "My Session" },
      ],
      sessionInfoMap: {
        "claude:session-1": mkInfo("claude", "session-1", "My Session"),
      },
      connectedAgents: [
        { agentId: "claude", name: "Claude", color: "#3b82f6" },
      ],
    });
    useSessionStore.getState().setActiveSession(KEY);

    const { container } = render(<MiniChatContainer />);
    const card = container.querySelector(".session-overview-card");
    fireEvent.doubleClick(card!);

    act(() => {
      fireSessionDetail("session-1", "claude", mkHistoryMessages());
    });

    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("closes drill-down when Close history button is clicked", () => {
    useSessionStore.getState().bulkSetTabs({
      tabs: [
        { agentId: "claude", sessionId: "session-1", title: "My Session" },
      ],
      sessionInfoMap: {
        "claude:session-1": mkInfo("claude", "session-1", "My Session"),
      },
      connectedAgents: [
        { agentId: "claude", name: "Claude", color: "#3b82f6" },
      ],
    });
    useSessionStore.getState().setActiveSession(KEY);

    const { container } = render(<MiniChatContainer />);
    const card = container.querySelector(".session-overview-card");
    fireEvent.doubleClick(card!);

    act(() => {
      fireSessionDetail("session-1", "claude", mkHistoryMessages());
    });

    // Close the drill-down.
    const closeBtn = screen.getByLabelText("Close history");
    fireEvent.click(closeBtn);

    expect(screen.queryByText("History")).toBeNull();
  });
});
