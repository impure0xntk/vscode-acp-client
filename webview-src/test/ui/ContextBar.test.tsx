import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ContextBar } from "../../components/composer/ContextBar";
import type { ContextAttachment, SelectedTeam, SendTarget } from "../../types";

function makeAttachment(id: string, path: string): ContextAttachment {
  return {
    id,
    type: "file",
    path,
    label: path.split("/").pop() ?? path,
    tokenCount: 10,
    content: "",
  };
}

describe("ContextBar", () => {
  beforeEach(() => cleanup());

  it("renders nothing when there are no attachments, targets, or team", () => {
    const { container } = render(
      <ContextBar attachments={[]} onRemove={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a chip per attachment", () => {
    const attachments = [
      makeAttachment("a1", "/workspace/src/a.ts"),
      makeAttachment("a2", "/workspace/src/b.ts"),
    ];
    render(<ContextBar attachments={attachments} onRemove={() => {}} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
  });

  it("renders a send target chip and removes it via callback", () => {
    const onRemoveSendTarget = vi.fn();
    const target: SendTarget = {
      agentId: "claude",
      sessionId: "s1",
      label: "Claude Session",
    };
    render(
      <ContextBar
        attachments={[]}
        onRemove={() => {}}
        sendTargets={[target]}
        onRemoveSendTarget={onRemoveSendTarget}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Remove Claude Session/i })
    );
    expect(onRemoveSendTarget).toHaveBeenCalledWith("claude", "s1");
  });

  it("renders a selected team chip with remove handler", () => {
    const onRemoveSelectedTeam = vi.fn();
    const team: SelectedTeam = {
      id: "t1",
      name: "Team Alpha",
      leadAgentId: "lead",
    };
    render(
      <ContextBar
        attachments={[]}
        onRemove={() => {}}
        selectedTeam={team}
        onRemoveSelectedTeam={onRemoveSelectedTeam}
      />
    );
    expect(screen.getByText("Team Alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Remove team"));
    expect(onRemoveSelectedTeam).toHaveBeenCalledTimes(1);
  });

  it("removes an attachment via the chip remove button", () => {
    const onRemove = vi.fn();
    render(
      <ContextBar
        attachments={[makeAttachment("a1", "/workspace/src/a.ts")]}
        onRemove={onRemove}
      />
    );
    fireEvent.click(screen.getByTitle("Remove"));
    expect(onRemove).toHaveBeenCalledWith("a1");
  });
});
