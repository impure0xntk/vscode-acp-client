import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ActiveSessionIndicator } from "../../components/composer/ActiveSessionIndicator";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import type { SendTarget } from "../../types";
import type { SessionInfoDTO } from "../../store/sessionStore";

const KEY = "claude:session-1";

function seedSession(
  overrides: Partial<SessionInfoDTO> = {}
): void {
  const base: SessionInfoDTO = {
    sessionId: "session-1",
    agentId: "claude",
    title: "My Session",
    status: "idle",
    lastTurnOutcome: null,
    isStreaming: false,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    createdAt: new Date().toISOString(),
    lastResponseAt: null,
    sessionColor: "#3b82f6",
  };
  useSessionStore
    .getState()
    .setSessionInfo("claude", "session-1", { ...base, ...overrides });
  useSessionStore.getState().setTabTitle(KEY, "My Session");
}

function targets(n: number): SendTarget[] {
  return Array.from({ length: n }, (_, i) => ({
    agentId: `agent-${i}`,
    sessionId: `sid-${i}`,
    label: `Agent ${i}`,
  }));
}

describe("ActiveSessionIndicator", () => {
  beforeEach(() => {
    cleanup();
    useSessionStore.setState({
      sessionInfoMap: {},
      tabOrder: [],
      tabTitles: {},
      tabIcons: {},
      activeSessionKey: null,
    } as Partial<ReturnType<typeof useSessionStore.getState>>);
  });

  it("renders the disabled banner when disabled and no active session", () => {
    render(<ActiveSessionIndicator activeSessionKey={null} disabled />);
    expect(
      screen.getByText(/No active session — connect an agent/i)
    ).toBeInTheDocument();
  });

  it("renders nothing when no active session and not disabled", () => {
    const { container } = render(
      <ActiveSessionIndicator activeSessionKey={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders agentId, title and status for a single active session", () => {
    seedSession();
    render(<ActiveSessionIndicator activeSessionKey={KEY} />);
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("My Session")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows the live status label from the session store", () => {
    seedSession({ status: "running", isStreaming: true });
    render(<ActiveSessionIndicator activeSessionKey={KEY} />);
    expect(screen.getByText("Working…")).toBeInTheDocument();
  });

  it("falls back to sessionId as title when no title is available", () => {
    useSessionStore
      .getState()
      .setSessionInfo("x", "orphan", {
        sessionId: "orphan",
        agentId: "x",
        status: "idle",
        lastTurnOutcome: null,
        isStreaming: false,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        createdAt: new Date().toISOString(),
        lastResponseAt: null,
      });
    render(<ActiveSessionIndicator activeSessionKey="x:orphan" />);
    // agentId "x" shown, sessionId "orphan" used as title fallback
    expect(screen.getByText("x")).toBeInTheDocument();
    expect(screen.getByText("orphan")).toBeInTheDocument();
  });

  it("renders a multi-@ summary when sendTargets are provided", () => {
    render(
      <ActiveSessionIndicator
        activeSessionKey={KEY}
        sendTargets={targets(3)}
      />
    );
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(
      screen.getByText(/fans out to targets above/i)
    ).toBeInTheDocument();
  });

  it("calls onClick when the single-session banner is clicked", () => {
    seedSession();
    let clicked = 0;
    render(
      <ActiveSessionIndicator
        activeSessionKey={KEY}
        onClick={() => (clicked += 1)}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(1);
  });

  it("exposes an accessible button role for the active session", () => {
    seedSession();
    render(<ActiveSessionIndicator activeSessionKey={KEY} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("type", "button");
    expect(btn.getAttribute("title")).toContain(KEY);
  });

  it("sessionKeyOf builds the agentId:sessionId key", () => {
    expect(sessionKeyOf("a", "b")).toBe("a:b");
  });
});
