import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "../../components/primitives/Chip";
import type { ToolbarMeta } from "../../types";

describe("Chip", () => {
  it("renders label and value via aria-label", () => {
    const meta: ToolbarMeta = { key: "k", label: "Tokens", value: "1.2k" };
    render(<Chip meta={meta} />);
    const el = screen.getByLabelText("Tokens: 1.2k");
    expect(el.tagName).toBe("SPAN");
  });

  it("exposes button role and click handler when onClick is given", async () => {
    let clicked = 0;
    const meta: ToolbarMeta = { key: "k", label: "Mode", value: "plan" };
    render(<Chip meta={meta} onClick={() => (clicked += 1)} />);
    const btn = screen.getByRole("button");
    btn.click();
    expect(clicked).toBe(1);
  });

  it("renders a status indicator dot for session status", () => {
    const meta: ToolbarMeta = {
      key: "k",
      label: "Status",
      value: "running",
      statusIndicator: "running",
    };
    const { container } = render(<Chip meta={meta} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders a progress bar when barPct is set", () => {
    const meta: ToolbarMeta = {
      key: "k",
      label: "Ctx",
      value: "60%",
      barPct: 60,
    };
    render(<Chip meta={meta} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
  });
});
