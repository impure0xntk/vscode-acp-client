import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolBatchSummary } from "../../components/message/ToolBatchSummary";
import type { ToolCallCardProps } from "../../components/message/ToolCallCard";

function call(overrides: Partial<ToolCallCardProps> = {}): ToolCallCardProps {
  return {
    id: `c-${Math.random()}`,
    title: "Read",
    kind: "read",
    status: "completed",
    durationMs: 100,
    ...overrides,
  };
}

describe("ToolBatchSummary", () => {
  beforeEach(() => cleanup());

  it("renders a single tool call without an ops header", () => {
    render(<ToolBatchSummary calls={[call()]} />);
    expect(screen.queryByText(/ops/)).not.toBeInTheDocument();
    expect(screen.getByText("READ")).toBeInTheDocument();
  });

  it("summarizes multiple calls with an ops count and expand", () => {
    render(
      <ToolBatchSummary calls={[call(), call(), call({ kind: "write" })]} />
    );
    expect(screen.getByText(/3 ops/)).toBeInTheDocument();
    expect(screen.getByText(/×2/)).toBeInTheDocument(); // read ×2
  });

  it("expands to list individual tool calls", () => {
    const { container } = render(
      <ToolBatchSummary calls={[call(), call({ title: "Write x" })]} />
    );
    // The summary header button toggles the outer grid.
    const headerBtn = screen.getByText(/2 ops/).closest("button")!;
    expect(container.querySelector(".grid-rows-\\[0fr\\]")).toBeTruthy();
    fireEvent.click(headerBtn);
    expect(container.querySelector(".grid-rows-\\[1fr\\]")).toBeTruthy();
    // Individual tool calls are rendered (nested ToolCallCards).
    expect(screen.getByText("Write x")).toBeInTheDocument();
  });

  it("shows a warning aggregate status when some calls failed", () => {
    render(
      <ToolBatchSummary
        calls={[call(), call({ status: "failed", kind: "bash" })]}
      />
    );
    // warning variant => StatusIcon with warning mapped class present
    expect(document.querySelector(".status-icon-warning")).toBeTruthy();
  });

  it("renders failed calls grouped when all failed", () => {
    render(
      <ToolBatchSummary
        calls={[
          call({ status: "failed" }),
          call({ status: "failed", title: "Boom" }),
        ]}
      />
    );
    expect(screen.getByText("Boom")).toBeInTheDocument();
  });
});
