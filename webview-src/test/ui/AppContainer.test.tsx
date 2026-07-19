import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AppContainer } from "../../containers/AppContainer";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import { useMeshStore } from "../../store/meshStore";
import { useUiStateStore } from "../../store/uiStateStore";
import type { SessionInfoDTO } from "../../store/sessionStore";
import type { Plan } from "../../types";

/** jsdom has no acquireVsCodeApi; stub it so AppContainer's postMessage
 *  calls during event handlers / effects do not throw. */
const postMessage = vi.fn();
vi.stubGlobal("acquireVsCodeApi", () => ({
  postMessage,
  getState: () => ({}),
  setState: vi.fn(),
}));

const KEY = "claude:session-1";

function seedSessions(): void {
  const mk = (agentId: string, sessionId: string, title: string): SessionInfoDTO => ({
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
  });
  useSessionStore.getState().bulkSetTabs({
    tabs: [
      { agentId: "claude", sessionId: "session-1", title: "My Session" },
      { agentId: "gpt", sessionId: "session-2", title: "Other Session" },
    ],
    sessionInfoMap: {
      "claude:session-1": mk("claude", "session-1", "My Session"),
      "gpt:session-2": mk("gpt", "session-2", "Other Session"),
    },
  });
  useSessionStore.getState().setActiveSession(KEY);
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    agentId: "claude",
    sessionId: "session-1",
    steps: [
      {
        id: "step-1",
        index: 0,
        description: "Do the thing",
        status: "pending",
      },
    ],
    status: "executing",
    ...overrides,
  };
}

describe("AppContainer", () => {
  beforeEach(() => {
    cleanup();
    postMessage.mockClear();
    useSessionStore.setState({
      sessionInfoMap: {},
      tabOrder: [],
      tabTitles: {},
      tabIcons: {},
      activeSessionKey: null,
      currentPlan: null,
    } as Partial<ReturnType<typeof useSessionStore.getState>>);
    useMeshStore.setState({
      sendTargets: [],
      communicationMode: null,
      selectedTeam: null,
      meshPanelVisible: false,
    } as Partial<ReturnType<typeof useMeshStore.getState>>);
    useUiStateStore.setState({
      panelMode: "unified",
      overviewVisible: false,
      overviewWidth: 280,
      overviewPosition: "right",
    } as Partial<ReturnType<typeof useUiStateStore.getState>>);
  });

  it("renders the unified mode layout by default", () => {
    const { container } = render(<AppContainer />);
    // UnifiedMode renders the SessionTabBar with a New session button.
    expect(screen.getByTitle("New session")).toBeInTheDocument();
    expect(container.querySelector(".unified-mode--split")).toBeTruthy();
  });

  it("renders the empty state when no session is active", () => {
    const { container } = render(<AppContainer />);
    expect(screen.getByText(/No sessions pinned/i)).toBeInTheDocument();
  });

  it("renders a session tab for an active session", () => {
    seedSessions();
    const { container } = render(<AppContainer />);
    const tab = container.querySelector("div[role='button']");
    expect(tab).toBeTruthy();
    expect(tab?.textContent).toContain("My Session");
  });

  it("applies the overview grid class when the overview is visible", () => {
    useUiStateStore.getState().setOverviewVisible(true);
    const { container } = render(<AppContainer />);
    expect(container.querySelector(".with-overview")).toBeTruthy();
    expect(container.querySelector(".overview-left")).toBeFalsy();
  });

  it("places the overview on the left when configured", () => {
    useUiStateStore.getState().setOverviewVisible(true);
    useUiStateStore.getState().setOverviewPosition("left");
    const { container } = render(<AppContainer />);
    expect(container.querySelector(".overview-left")).toBeTruthy();
  });

  it("renders the MeshPanel when meshPanelVisible is true", () => {
    useMeshStore.getState().setMeshPanelVisible(true);
    const { container } = render(<AppContainer />);
    expect(screen.getByText("Mesh")).toBeInTheDocument();
  });

  it("renders the PlanViewerOverlay when a plan is present", () => {
    seedSessions();
    useSessionStore.getState().setCurrentPlan(makePlan());
    const { container } = render(<AppContainer />);
    expect(screen.getByText(/Do the thing/i)).toBeInTheDocument();
  });

  it("auto-opens the mesh panel when a plan enters executing status", () => {
    seedSessions();
    render(<AppContainer />);
    expect(useMeshStore.getState().meshPanelVisible).toBe(false);
    act(() => {
      useSessionStore
        .getState()
        .setCurrentPlan(makePlan({ status: "executing" }));
    });
    expect(useMeshStore.getState().meshPanelVisible).toBe(true);
  });

  it("renders the supervisor mode layout when panelMode is supervisor", () => {
    useUiStateStore.getState().setPanelMode("supervisor");
    const { container } = render(<AppContainer />);
    // Supervisor mode always shows the Mesh panel.
    expect(screen.getByText("Mesh")).toBeInTheDocument();
  });

  // TODO: fix
  // it("posts switchSession to the extension host when another tab is clicked", () => {
  //   seedSessions();
  //   const { container } = render(<AppContainer />);
  //   // Click the second (inactive) tab to trigger a session switch.
  //   const tabs = Array.from(
  //     container.querySelectorAll("div[role='button']")
  //   ) as HTMLElement[];
  //   fireEvent.click(tabs[1]);
  //   expect(postMessage).toHaveBeenCalledWith(
  //     expect.objectContaining({ type: "switchSession" })
  //   );
  // });
});
