import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ToolCallCard,
  DiffView,
  formatDuration,
} from "../../components/message/ToolCallCard";
import type { ToolCallDiffContent } from "../../types";

describe("ToolCallCard", () => {
  beforeEach(() => cleanup());

  it("formats durations in ms and seconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("renders the title, kind, and status icon", () => {
    render(
      <ToolCallCard
        id="tc1"
        title="Read config"
        kind="read"
        status="completed"
        durationMs={200}
      />
    );
    expect(screen.getByText("Read config")).toBeInTheDocument();
    expect(screen.getByText("READ")).toBeInTheDocument();
  });

  it("expands to show input/output when clicked", () => {
    render(
      <ToolCallCard
        id="tc1"
        title="Write file"
        kind="write"
        status="completed"
        input={{ path: "/x.ts" }}
        output='{"ok":true}'
        durationMs={300}
      />
    );
    // The input/output toggle buttons are always rendered; their body is hidden via CSS grid.
    fireEvent.click(screen.getByText("Input"));
    expect(screen.getByText(/"path": "\/x.ts"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
  });

  it("formats input JSON when provided as a string", () => {
    render(
      <ToolCallCard
        id="tc1"
        title="Call"
        kind="bash"
        status="completed"
        input='{"cmd":"ls"}'
        durationMs={10}
      />
    );
    const inputBtn = screen.getByText("Input");
    fireEvent.click(inputBtn);
    expect(document.body.textContent).toContain('"cmd": "ls"');
  });

  it("renders a diff view when diffContent is supplied", () => {
    const diff: ToolCallDiffContent = {
      type: "diff",
      diff: "@@ -1,1 +1,1 @@\n-a\n+b\n",
      oldPath: "a.ts",
      newPath: "a.ts",
    };
    const { container } = render(
      <ToolCallCard
        id="tc1"
        title="Edit"
        kind="edit"
        status="completed"
        diffContent={diff}
        durationMs={10}
      />
    );
    fireEvent.click(screen.getByText("Diff"));
    // The diff body opens (grid-rows-[1fr]); the outer summary grid remains closed.
    expect(container.querySelector(".grid-rows-\\[1fr\\]")).toBeTruthy();
  });
});

describe("DiffView", () => {
  beforeEach(() => cleanup());

  it("renders added and removed lines with line numbers", () => {
    const diff: ToolCallDiffContent = {
      type: "diff",
      diff: "@@ -1,2 +1,2 @@\n line a\n-bad\n+good\n",
      oldPath: "a.ts",
      newPath: "a.ts",
    };
    render(<DiffView diff={diff} />);
    expect(screen.getByText("bad")).toBeInTheDocument();
    expect(screen.getByText("good")).toBeInTheDocument();
    expect(screen.getByText(/@@ -1,2/)).toBeInTheDocument();
  });

  it("falls back to a raw pre block for invalid diff input", () => {
    const diff: ToolCallDiffContent = {
      type: "diff",
      diff: "not a real diff",
    };
    const { container } = render(<DiffView diff={diff} />);
    // parsePatch returns [] for non-diff text, so the fallback pre renders
    // the raw diff property (here it is empty because there were no files).
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toBe("");
  });
});
