import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnreadBadge } from "../../components/primitives/UnreadBadge";

describe("UnreadBadge", () => {
  it("renders nothing when count is zero", () => {
    const { container } = render(<UnreadBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when hidden", () => {
    const { container } = render(<UnreadBadge count={3} hidden />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the count when positive", () => {
    render(<UnreadBadge count={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("caps the label at 99+", () => {
    render(<UnreadBadge count={150} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});
