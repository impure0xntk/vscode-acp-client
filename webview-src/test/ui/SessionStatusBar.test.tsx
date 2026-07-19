import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  SessionStatusBar,
  deriveStreamingState,
} from "../../components/sessions/SessionStatusBar";
import { useSessionStore } from "../../store/sessionStore";
import type { QueuedPrompt } from "../../types";

const queueItem = (overrides: Partial<QueuedPrompt> = {}): QueuedPrompt => ({
  id: "q1",
  agentId: "claude",
  sessionId: "s1",
  text: "queued message",
  enqueuedAt: new Date().toISOString(),
  status: "pending",
  mode: "stack",
  ...overrides,
});

describe("deriveStreamingState", () => {
  it("returns idle when nothing is active", () => {
    expect(
      deriveStreamingState({
        sessionKey: "a:s",
        active: false,
        action: undefined,
        turnStartedAt: undefined,
        pending: false,
        sessionStatus: "idle",
      }).phase
    ).toBe("idle");
  });

  it("returns sending when pending + turnStartedAt", () => {
    const r = deriveStreamingState({
      sessionKey: "a:s",
      active: false,
      action: undefined,
      turnStartedAt: new Date().toISOString(),
      pending: true,
      sessionStatus: "idle",
    });
    expect(r.phase).toBe("sending");
    expect(r.anchorMs).toBeTypeOf("number");
  });

  it("returns cancelling when sessionStatus is cancelling", () => {
    expect(
      deriveStreamingState({
        sessionKey: "a:s",
        active: true,
        action: undefined,
        turnStartedAt: undefined,
        pending: false,
        sessionStatus: "cancelling",
      }).phase
    ).toBe("cancelling");
  });

  it("returns waiting with an action label when active", () => {
    const r = deriveStreamingState({
      sessionKey: "claude:s1",
      active: true,
      action: "Reading src/app.ts",
      turnStartedAt: undefined,
      pending: false,
      sessionStatus: "running",
    });
    expect(r.phase).toBe("waiting");
    expect(r.actionLabel).toBe("Reading src/app.ts");
  });

  it("derives a default waiting label from the agent id", () => {
    const r = deriveStreamingState({
      sessionKey: "claude:s1",
      active: false,
      action: undefined,
      turnStartedAt: undefined,
      pending: false,
      sessionStatus: "running",
    });
    expect(r.phase).toBe("waiting");
    expect(r.actionLabel).toBe("Waiting for claude…");
  });
});

describe("SessionStatusBar", () => {
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

  it("renders nothing when idle and no queue", () => {
    const { container } = render(
      <SessionStatusBar sessionKey={null} queue={[]} onCancelQueue={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'Sending…' while pending with a turn start timestamp", () => {
    render(
      <SessionStatusBar
        sessionKey="claude:s1"
        pending
        turnStartedAt={new Date().toISOString()}
        queue={[]}
        onCancelQueue={() => {}}
      />
    );
    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  it("shows a live action while waiting", () => {
    render(
      <SessionStatusBar
        sessionKey="claude:s1"
        active
        action="Thinking hard"
        queue={[]}
        onCancelQueue={() => {}}
      />
    );
    expect(screen.getByText("Thinking hard")).toBeInTheDocument();
  });

  it("lists queued prompts and cancels them via callback", () => {
    const onCancelQueue = ((key: string) => {
      lastCancelled = key;
    }) as (id: string) => void;
    let lastCancelled = "";
    render(
      <SessionStatusBar
        sessionKey="claude:s1"
        queue={[queueItem({ id: "q1", text: "do thing" })]}
        onCancelQueue={onCancelQueue}
      />
    );
    expect(screen.getByText("do thing")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove from queue"));
    expect(lastCancelled).toBe("q1");
  });

  it("shows 'Cancelling…' when the session is cancelling", () => {
    // The component reads cancellation status from the session store
    // (useSessionInfo), not from a prop — seed it so the status resolves.
    useSessionStore.getState().setSessionInfo("claude", "s1", {
      sessionId: "s1",
      agentId: "claude",
      status: "cancelling",
      lastTurnOutcome: null,
      isStreaming: false,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      createdAt: new Date().toISOString(),
      lastResponseAt: null,
    });
    render(
      <SessionStatusBar
        sessionKey="claude:s1"
        queue={[]}
        onCancelQueue={() => {}}
      />
    );
    expect(screen.getByText("Cancelling…")).toBeInTheDocument();
  });
});
