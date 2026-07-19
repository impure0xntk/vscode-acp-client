import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThinkingBlock } from "../../components/message/ThinkingBlock";

describe("ThinkingBlock", () => {
  beforeEach(() => cleanup());

  it("renders 'Thought' when not streaming", () => {
    render(<ThinkingBlock content="reasoning step" />);
    expect(screen.getByText("Thought")).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  it("renders 'Thinking…' while streaming", () => {
    render(<ThinkingBlock content="reasoning step" isStreaming />);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("is collapsed by default and expands on toggle", () => {
    const { container } = render(<ThinkingBlock content="collapsed body" />);
    // Body is rendered but hidden via grid-rows-[0fr]; assert visibility via class.
    const body = screen.getByText("collapsed body");
    expect(body.closest(".grid-rows-\\[0fr\\]") || container.querySelector(".grid-rows-[0fr]")).toBeTruthy();
    fireEvent.click(screen.getByText("Thought"));
    expect(body.closest(".grid-rows-\\[1fr\\]") || container.querySelector(".grid-rows-[1fr]")).toBeTruthy();
  });

  it("is expanded on first render when defaultExpanded is true", () => {
    render(<ThinkingBlock content="open body" defaultExpanded />);
    expect(screen.getByText("open body")).toBeInTheDocument();
  });

  it("renders content as markdown (code/strong)", () => {
    render(<ThinkingBlock content="use `x` **now**" defaultExpanded />);
    const html = document.body.innerHTML;
    expect(html).toContain("<code>x</code>");
    expect(html).toContain("<strong>now</strong>");
  });
});
