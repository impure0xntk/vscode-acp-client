import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SessionTab } from "../../components/sessions/SessionTab";
import type { SessionTabState } from "../../store/sessionStore";

const tab: SessionTabState = {
  sessionId: "s1",
  agentId: "claude",
  title: "My Session",
};

describe("SessionTab", () => {
  beforeEach(() => cleanup());

  it("renders the agentId and title", () => {
    render(
      <SessionTab
        tab={tab}
        isActive={false}
        isHovered={false}
        unreadCount={0}
        onClick={() => {}}
        onClose={() => {}}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />
    );
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("My Session")).toBeInTheDocument();
  });

  it("calls onClick when the tab body is clicked", () => {
    const onClick = vi.fn();
    render(
      <SessionTab
        tab={tab}
        isActive={false}
        isHovered={false}
        unreadCount={0}
        onClick={onClick}
        onClose={() => {}}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />
    );
    fireEvent.click(screen.getByText("My Session").parentElement!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <SessionTab
        tab={tab}
        isActive
        isHovered={false}
        unreadCount={0}
        onClick={() => {}}
        onClose={onClose}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle("Close session"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("enters rename mode on double-click and submits on Enter", () => {
    const onRename = vi.fn();
    render(
      <SessionTab
        tab={tab}
        isActive={false}
        isHovered={false}
        unreadCount={0}
        onClick={() => {}}
        onClose={() => {}}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
        onRename={onRename}
      />
    );
    fireEvent.doubleClick(screen.getByTitle(/double-click to rename/));
    const input = screen.getByDisplayValue("My Session");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("claude", "s1", "Renamed");
  });

  it("hides the unread badge when the tab is active", () => {
    const { container } = render(
      <SessionTab
        tab={tab}
        isActive
        isHovered={false}
        unreadCount={5}
        onClick={() => {}}
        onClose={() => {}}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />
    );
    // UnreadBadge returns null when active
    expect(container.querySelector(".font-bold")).toBeFalsy();
  });

  it("shows an unread badge when not active", () => {
    render(
      <SessionTab
        tab={tab}
        isActive={false}
        isHovered={false}
        unreadCount={3}
        onClick={() => {}}
        onClose={() => {}}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
