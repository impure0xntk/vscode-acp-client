import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SessionTabBar } from "../../components/sessions/SessionTabBar";
import type {
  SessionTabState,
  ConnectedAgentInfo,
} from "../../store/sessionStore";

const tabs: SessionTabState[] = [
  { sessionId: "s1", agentId: "claude", title: "Session One" },
  { sessionId: "s2", agentId: "gpt", title: "Session Two" },
];

const agents: ConnectedAgentInfo[] = [
  { agentId: "claude", name: "Claude", color: "#3b82f6" },
  { agentId: "gpt", name: "GPT", color: "#22c55e" },
];

describe("SessionTabBar", () => {
  beforeEach(() => cleanup());

  it("renders a tab per session", () => {
    render(
      <SessionTabBar
        tabs={tabs}
        activeSessionKey="claude:s1"
        connectedAgents={agents}
        onTabClick={() => {}}
        onTabClose={() => {}}
        onNewSession={() => {}}
      />
    );
    expect(screen.getByText("Session One")).toBeInTheDocument();
    expect(screen.getByText("Session Two")).toBeInTheDocument();
  });

  it("calls onTabClick with the session key when a tab is clicked", () => {
    const onTabClick = vi.fn();
    render(
      <SessionTabBar
        tabs={tabs}
        activeSessionKey="claude:s1"
        connectedAgents={agents}
        onTabClick={onTabClick}
        onTabClose={() => {}}
        onNewSession={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Session Two").parentElement!);
    expect(onTabClick).toHaveBeenCalledWith("gpt:s2");
  });

  it("calls onTabClose with the session key when close is clicked", () => {
    const onTabClose = vi.fn();
    render(
      <SessionTabBar
        tabs={tabs}
        activeSessionKey="claude:s1"
        connectedAgents={agents}
        onTabClick={() => {}}
        onTabClose={onTabClose}
        onNewSession={() => {}}
      />
    );
    const closeButtons = screen.getAllByTitle("Close");
    fireEvent.click(closeButtons[1]);
    expect(onTabClose).toHaveBeenCalledWith("gpt:s2");
  });

  it("toggles a pin via onTogglePin", () => {
    const onTogglePin = vi.fn();
    render(
      <SessionTabBar
        tabs={tabs}
        activeSessionKey="claude:s1"
        connectedAgents={agents}
        onTabClick={() => {}}
        onTabClose={() => {}}
        onNewSession={() => {}}
        onTogglePin={onTogglePin}
        pinnedSessionKeys={["claude:s1"]}
      />
    );
    const pinButtons = screen.getAllByTitle(/Pin session|Unpin session/);
    fireEvent.click(pinButtons[0]);
    expect(onTogglePin).toHaveBeenCalledWith("claude:s1");
  });

  it("calls onNewSession when the new button is clicked", () => {
    const onNewSession = vi.fn();
    render(
      <SessionTabBar
        tabs={tabs}
        activeSessionKey="claude:s1"
        connectedAgents={agents}
        onTabClick={() => {}}
        onTabClose={() => {}}
        onNewSession={onNewSession}
      />
    );
    fireEvent.click(screen.getByTitle("New session"));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("toggles split direction via onSplitDirectionChange", () => {
    const onSplitDirectionChange = vi.fn();
    render(
      <SessionTabBar
        tabs={tabs}
        activeSessionKey="claude:s1"
        connectedAgents={agents}
        onTabClick={() => {}}
        onTabClose={() => {}}
        onNewSession={() => {}}
        onSplitDirectionChange={onSplitDirectionChange}
      />
    );
    fireEvent.click(screen.getByTitle("Split top and bottom (vertical)"));
    expect(onSplitDirectionChange).toHaveBeenCalledWith("vertical");
  });
});
