import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Composer, type ComposerHandle } from "../../components/composer/Composer";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import { useMeshStore } from "../../store/meshStore";
import type {
  ContextAttachment,
  QueuedPrompt,
  SendTarget,
} from "../../types";
import { createRef } from "react";

const KEY = "claude:session-1";

function makeAttachment(overrides: Partial<ContextAttachment> = {}): ContextAttachment {
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

function makeTarget(overrides: Partial<SendTarget> = {}): SendTarget {
  return {
    agentId: "agent-2",
    sessionId: "sid-2",
    label: "Agent 2",
    ...overrides,
  };
}

function makeQueueItem(overrides: Partial<QueuedPrompt> = {}): QueuedPrompt {
  return {
    id: "q1",
    agentId: "claude",
    sessionId: "s1",
    text: "queued message",
    enqueuedAt: new Date().toISOString(),
    status: "pending",
    mode: "stack",
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return {
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onNewSession: vi.fn(),
    onSwitchSession: vi.fn(),
    onRenameSession: vi.fn(),
    fetchFiles: vi.fn(async () => []),
    resolveFile: vi.fn(async (_p: string) =>
      makeAttachment({ id: "resolved", path: _p })
    ),
    resolveSelection: vi.fn(async () => null),
    resolveDiff: vi.fn(async () => null),
    fetchSymbols: vi.fn(async () => []),
    resolveSymbol: vi.fn(async (_n: string) => makeAttachment({ id: "sym" })),
    resolveOutput: vi.fn(async () => null),
    ...overrides,
  };
}

describe("Composer", () => {
  beforeEach(() => {
    cleanup();
    useSessionStore.setState({
      sessionInfoMap: {},
      tabOrder: [],
      tabTitles: {},
      tabIcons: {},
      activeSessionKey: null,
    } as Partial<ReturnType<typeof useSessionStore.getState>>);
    useMeshStore.setState({
      sendTargets: [],
      communicationMode: null,
      selectedTeam: null,
    } as Partial<ReturnType<typeof useMeshStore.getState>>);
  });

  it("renders a textarea with the idle placeholder", () => {
    render(<Composer {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(
      /Message \(Enter to send/i
    ) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.disabled).toBe(false);
  });

  it("shows the connect-first placeholder when disabled", () => {
    render(<Composer {...baseProps({ disabled: true })} />);
    const textarea = screen.getByPlaceholderText(
      /Connect to an agent first/i
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("disables the send button while the textarea is empty", () => {
    render(<Composer {...baseProps()} />);
    const sendButton = screen.getByTitle("Send to active session");
    expect(sendButton).toBeDisabled();
  });

  it("calls onSend with trimmed text on Enter", () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps({ onSend })} />);
    const textarea = screen.getByPlaceholderText(
      /Message \(Enter to send/i
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  hello world  " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello world", [], undefined, null, undefined, undefined);
  });

  it("sends attachments together with the text", () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps({ onSend })} />);
    const textarea = screen.getByPlaceholderText(
      /Message \(Enter to send/i
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "with file" } });
    // Simulate a file resolution result by firing the window event the composer listens to.
    const att = makeAttachment({ id: "evt", path: "/a/b.ts" });
    fireEvent(
      window,
      new CustomEvent("acp:attachContext", { detail: { attachment: att } })
    );
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
    const [, attachments] = onSend.mock.calls[0];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].id).toBe("evt");
  });

  it("clears the textarea after sending", () => {
    render(<Composer {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(
      /Message \(Enter to send/i
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "clear me" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(textarea.value).toBe("");
  });

  it("does not send when the text is only whitespace", () => {
    const onSend = vi.fn();
    render(<Composer {...baseProps({ onSend })} />);
    const textarea = screen.getByPlaceholderText(
      /Message \(Enter to send/i
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("exposes an imperative focusTextarea handle", () => {
    const ref = createRef<ComposerHandle>();
    render(<Composer ref={ref} {...baseProps()} />);
    expect(ref.current).toBeTruthy();
    // jsdom textarea has no real focus side effects, but the method must exist
    expect(typeof ref.current?.focusTextarea).toBe("function");
    ref.current?.focusTextarea();
  });

  it("renders the ActiveSessionIndicator when a session is active", () => {
    useSessionStore.getState().setSessionInfo("claude", "session-1", {
      sessionId: "session-1",
      agentId: "claude",
      title: "My Session",
      status: "idle",
      lastTurnOutcome: null,
      isStreaming: false,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      createdAt: new Date().toISOString(),
      lastResponseAt: null,
      sessionColor: "#3b82f6",
    });
    useSessionStore.getState().setTabTitle(KEY, "My Session");
    useSessionStore.getState().setActiveSession(KEY);
    render(<Composer {...baseProps()} />);
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("My Session")).toBeInTheDocument();
  });

  it("renders a mesh mode badge and clears it via the close button", () => {
    useMeshStore.getState().setCommunicationMode("fanout");
    render(<Composer {...baseProps()} />);
    expect(screen.getByText("Fanout")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Clear mode"));
    expect(useMeshStore.getState().communicationMode).toBeNull();
  });

  it("renders send target chips via ContextBar when targets are selected", () => {
    useMeshStore.getState().addSendTarget(makeTarget());
    render(<Composer {...baseProps()} />);
    expect(screen.getByText("Agent 2")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Remove Agent 2/i })
    );
    expect(useMeshStore.getState().sendTargets).toHaveLength(0);
  });

  describe("running status", () => {
    it("shows Stack, Inject and Stop buttons instead of send", () => {
      render(
        <Composer
          {...baseProps({
            status: "running",
            disabled: false,
            onSend: vi.fn(),
            onCancel: vi.fn(),
          })}
        />
      );
      expect(screen.queryByTitle("Send to active session")).toBeNull();
      expect(screen.getByLabelText("Stack message")).toBeInTheDocument();
      expect(screen.getByLabelText("Inject message")).toBeInTheDocument();
      expect(screen.getByTitle(/Stop generation/)).toBeInTheDocument();
    });

    it("calls onSend with queueMode 'stack' on Stack click", () => {
      const onSend = vi.fn();
      render(
        <Composer {...baseProps({ onSend, status: "running" })} />
      );
      const textarea = screen.getByPlaceholderText(
        /Message \(Enter to send/i
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "later" } });
      fireEvent.click(screen.getByLabelText("Stack message"));
      expect(onSend).toHaveBeenCalledTimes(1);
      const [, , , , , queueMode] = onSend.mock.calls[0];
      expect(queueMode).toBe("stack");
    });

    it("calls onCancel with cancel targets on Stop click", () => {
      const onCancel = vi.fn();
      useMeshStore.getState().addSendTarget(makeTarget());
      render(
        <Composer {...baseProps({ onCancel, status: "running" })} />
      );
      fireEvent.click(screen.getByTitle(/Stop generation/));
      expect(onCancel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ agentId: "agent-2" }),
        ])
      );
    });

    it("routes to onSendMode when a queue mode is active and onSendMode is provided", () => {
      const onSendMode = vi.fn();
      const onSend = vi.fn();
      render(
        <Composer
          {...baseProps({ onSend, onSendMode, status: "running" })}
        />
      );
      const textarea = screen.getByPlaceholderText(
        /Message \(Enter to send/i
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "inject now" } });
      // Alt+Enter sets inject mode for a running session
      fireEvent.keyDown(textarea, {
        key: "Enter",
        altKey: true,
        shiftKey: false,
      });
      expect(onSendMode).toHaveBeenCalledTimes(1);
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe("queue panel", () => {
    it("renders the queue panel with the message count", () => {
      render(
        <Composer
          {...baseProps({ queue: [makeQueueItem({ text: "do thing" })] })}
        />
      );
      expect(screen.getByText(/1 queued message/)).toBeInTheDocument();
      expect(screen.getByText("do thing")).toBeInTheDocument();
      expect(screen.getByText("STK")).toBeInTheDocument();
    });

    it("shows an INJ badge for inject-mode queued items", () => {
      render(
        <Composer
          {...baseProps({
            queue: [makeQueueItem({ mode: "inject", text: "urgent" })],
          })}
        />
      );
      expect(screen.getByText("INJ")).toBeInTheDocument();
    });

    it("calls onSendNow when the send-now button is clicked", () => {
      const onSendNow = vi.fn();
      render(
        <Composer
          {...baseProps({
            onSendNow,
            queue: [makeQueueItem({ id: "q1", text: "send it" })],
          })}
        />
      );
      fireEvent.click(screen.getByLabelText("Send now"));
      expect(onSendNow).toHaveBeenCalledWith("q1");
    });

    it("calls onRemoveQueueItem when the remove button is clicked", () => {
      const onRemoveQueueItem = vi.fn();
      render(
        <Composer
          {...baseProps({
            onRemoveQueueItem,
            queue: [makeQueueItem({ id: "q1", text: "drop me" })],
          })}
        />
      );
      fireEvent.click(screen.getByLabelText("Remove from queue"));
      expect(onRemoveQueueItem).toHaveBeenCalledWith("q1");
    });

    it("calls onClearQueue when Clear all is clicked", () => {
      const onClearQueue = vi.fn();
      render(
        <Composer
          {...baseProps({
            onClearQueue,
            queue: [
              makeQueueItem({ id: "q1" }),
              makeQueueItem({ id: "q2" }),
            ],
          })}
        />
      );
      fireEvent.click(screen.getByLabelText("Clear all queued messages"));
      expect(onClearQueue).toHaveBeenCalledTimes(1);
    });
  });
});
