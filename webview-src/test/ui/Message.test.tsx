import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Message } from "../../components/message/Message";
import type { ChatDisplayItem } from "../../pipeline";
import type { ChatMessage, ToolCall } from "../../types";

function makeItem(overrides: Partial<ChatDisplayItem> = {}): ChatDisplayItem {
  return {
    key: "m1",
    role: "agent",
    content: "Hello **world**",
    timestamp: Date.now(),
    attachments: [],
    thinking: undefined,
    stopReason: undefined,
    isFirstOfTurn: true,
    renderContext: { filePaths: new Set<string>() },
    ...overrides,
  } as ChatDisplayItem;
}

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tc1",
    title: "Read file",
    status: "completed",
    kind: "read",
    input: undefined,
    output: undefined,
    durationMs: undefined,
    locations: undefined,
    diffContent: undefined,
    ...overrides,
  };
}

describe("Message", () => {
  beforeEach(() => cleanup());

  it("renders the role header on the first message of a turn", () => {
    render(
      <Message item={makeItem()} isFirstOfTurn sessionId="s" agentId="a" />
    );
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("omits the role header when not the first of a turn", () => {
    render(
      <Message
        item={makeItem()}
        isFirstOfTurn={false}
        sessionId="s"
        agentId="a"
      />
    );
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });

  it("renders user messages with the 'You' label and user bubble", () => {
    render(
      <Message
        item={makeItem({ role: "user", content: "my question" })}
        isFirstOfTurn
        sessionId="s"
        agentId="a"
      />
    );
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("my question")).toBeInTheDocument();
  });

  it("renders agent content as sanitized markdown", () => {
    render(
      <Message
        item={makeItem({ content: "**bold** and `code`" })}
        isFirstOfTurn
        sessionId="s"
        agentId="a"
      />
    );
    const html = document.querySelector("[data-message-id='m1']")!.innerHTML;
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders attachment chips for user messages", () => {
    render(
      <Message
        item={makeItem({
          role: "user",
          attachments: [
            {
              id: "atch1",
              type: "file",
              path: "/workspace/src/x.ts",
              label: "x.ts",
              lineRange: undefined,
              tokenCount: 5,
              message: undefined,
              isNavigable: true,
              extension: "ts",
              detail: "x.ts",
            },
          ],
        })}
        isFirstOfTurn
        sessionId="s"
        agentId="a"
      />
    );
    expect(screen.getByText("x.ts")).toBeInTheDocument();
  });

  it("renders a ToolBatchSummary when tool calls are present", () => {
    render(
      <Message
        item={makeItem({
          resolvedToolCalls: [
            {
              id: "tc1",
              title: "Read file",
              kind: "read",
              status: "completed",
              input: undefined,
              output: undefined,
              durationMs: 100,
              locations: undefined,
              diffContent: undefined,
            },
          ],
        })}
        isFirstOfTurn
        sessionId="s"
        agentId="a"
      />
    );
    // single tool call renders the kind label "READ"
    expect(screen.getByText(/READ/)).toBeInTheDocument();
  });

  it("renders a thinking block when thinking content exists", () => {
    render(
      <Message
        item={makeItem({ thinking: { content: "hmm", isStreaming: false } })}
        isFirstOfTurn
        sessionId="s"
        agentId="a"
      />
    );
    expect(screen.getByText("Thought")).toBeInTheDocument();
  });

  it("marks system messages with reduced opacity class", () => {
    const { container } = render(
      <Message
        item={makeItem({ role: "system", content: "note" })}
        isFirstOfTurn
        sessionId="s"
        agentId="a"
      />
    );
    expect(container.querySelector(".opacity-70")).toBeTruthy();
  });
});
