import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ContextChip } from "../../components/composer/ContextChip";
import type { ContextAttachment } from "../../types";

function makeAttachment(
  overrides: Partial<ContextAttachment> = {}
): ContextAttachment {
  return {
    id: "att-1",
    type: "file",
    path: "/workspace/src/app.ts",
    label: "src/app.ts",
    lineRange: undefined,
    tokenCount: 120,
    content: "const x = 1;",
    ...overrides,
  };
}

describe("ContextChip", () => {
  beforeEach(() => cleanup());

  it("renders the attachment label and token count", () => {
    render(<ContextChip attachment={makeAttachment()} onRemove={() => {}} />);
    expect(screen.getByText("app.ts")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("calls onRemove when the remove button is clicked", () => {
    const onRemove = vi.fn();
    render(<ContextChip attachment={makeAttachment()} onRemove={onRemove} />);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(onRemove).toHaveBeenCalledWith("att-1");
  });

  it("calls onPreview when the label is clicked", () => {
    const onPreview = vi.fn();
    render(
      <ContextChip
        attachment={makeAttachment()}
        onRemove={() => {}}
        onPreview={onPreview}
      />
    );
    fireEvent.click(screen.getByTitle(/Click to preview/));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("shows the critical pulse class for critical context color", () => {
    const { container } = render(
      <ContextChip
        attachment={makeAttachment()}
        onRemove={() => {}}
        contextColor="critical"
      />
    );
    expect(container.querySelector(".animate-context-pulse")).toBeTruthy();
  });

  it("marks the chip as previewing when isPreviewing is true", () => {
    const { container } = render(
      <ContextChip
        attachment={makeAttachment()}
        onRemove={() => {}}
        isPreviewing
      />
    );
    expect(container.querySelector(".ring-accent")).toBeTruthy();
  });

  it("uses the symbol label for symbol attachments", () => {
    render(
      <ContextChip
        attachment={makeAttachment({
          type: "symbol",
          label: "MyClass",
          path: "src/cls.ts",
        })}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText("MyClass")).toBeInTheDocument();
  });
});
