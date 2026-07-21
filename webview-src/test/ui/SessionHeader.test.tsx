import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SessionHeader } from "../../components/sessions/SessionHeader";
import type { SessionInfoDTO } from "../../store/sessionStore";

const info: SessionInfoDTO = {
  sessionId: "s1",
  agentId: "claude",
  title: "My Session",
  status: "idle",
  lastTurnOutcome: null,
  isStreaming: false,
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  createdAt: new Date().toISOString(),
  lastResponseAt: null,
};

describe("SessionHeader", () => {
  beforeEach(() => cleanup());

  it("renders the agentId and title", () => {
    render(
      <SessionHeader sessionKey="claude:s1" agentId="claude" info={info} />
    );
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("My Session")).toBeInTheDocument();
  });

  it("shows the cwd when provided", () => {
    render(
      <SessionHeader
        sessionKey="claude:s1"
        agentId="claude"
        info={{ ...info, cwd: "/very/long/workspace/path/here" }}
      />
    );
    expect(screen.getByText(/workspace\/path/)).toBeInTheDocument();
  });

  it("renders a pin toggle button that calls onTogglePin", () => {
    const onTogglePin = vi.fn();
    render(
      <SessionHeader
        sessionKey="claude:s1"
        agentId="claude"
        info={info}
        onTogglePin={onTogglePin}
        isPinned={false}
      />
    );
    fireEvent.click(screen.getByTitle("Pin session"));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it("renders a close button that calls onClose", () => {
    const onClose = vi.fn();
    render(
      <SessionHeader
        sessionKey="claude:s1"
        agentId="claude"
        info={info}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTitle("Close session"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("enters rename mode on double-click and submits on Enter", () => {
    const onRename = vi.fn();
    render(
      <SessionHeader
        sessionKey="claude:s1"
        agentId="claude"
        info={info}
        onRename={onRename}
      />
    );
    fireEvent.doubleClick(screen.getByTitle(/double-click to rename/));
    const input = screen.getByDisplayValue("My Session");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("claude", "s1", "Renamed");
  });

  it("shows a running status icon when the session is running", () => {
    render(
      <SessionHeader
        sessionKey="claude:s1"
        agentId="claude"
        info={{ ...info, status: "running" }}
      />
    );
    expect(document.querySelector(".status-icon-running")).toBeTruthy();
  });
});
