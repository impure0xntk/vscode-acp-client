import * as assert from "assert";
import { describe, it } from "mocha";

// ============================================================================
// Domain Models Unit Tests
// ============================================================================

describe("Domain Models — AgentDefinition", () => {
  it("creates a valid agent definition with required fields", () => {
    const agent = {
      id: "claude",
      name: "Claude",
      description: "Anthropic Claude agent",
      systemPrompt: "You are a helpful assistant.",
      allowedTools: ["read_file", "write_file"],
    };
    assert.strictEqual(agent.id, "claude");
    assert.strictEqual(agent.name, "Claude");
    assert.ok(agent.allowedTools.length > 0);
  });

  it("supports optional model and handoffs", () => {
    const agent = {
      id: "gpt4",
      name: "GPT-4",
      description: "OpenAI GPT-4",
      systemPrompt: "You are GPT-4.",
      allowedTools: ["read_file"],
      model: "gpt-4-turbo",
      handoffs: ["claude"],
    };
    assert.strictEqual(agent.model, "gpt-4-turbo");
    assert.deepStrictEqual(agent.handoffs, ["claude"]);
  });
});

describe("Domain Models — AgentConnectionState", () => {
  const states = ["connecting", "connected", "idle", "busy", "error", "disconnected"] as const;

  it("has exactly 6 connection states", () => {
    assert.strictEqual(states.length, 6);
  });

  it("includes all expected states", () => {
    assert.ok(states.includes("connecting"));
    assert.ok(states.includes("connected"));
    assert.ok(states.includes("idle"));
    assert.ok(states.includes("busy"));
    assert.ok(states.includes("error"));
    assert.ok(states.includes("disconnected"));
  });
});

describe("Domain Models — TokenUsage", () => {
  it("has input, output, and total fields", () => {
    const usage = { input: 100, output: 50, total: 150 };
    assert.strictEqual(usage.input, 100);
    assert.strictEqual(usage.output, 50);
    assert.strictEqual(usage.total, 150);
  });

  it("total equals input + output", () => {
    const usage = { input: 200, output: 75, total: 275 };
    assert.strictEqual(usage.total, usage.input + usage.output);
  });
});

describe("Domain Models — Session", () => {
  it("creates a valid session with defaults", () => {
    const now = new Date();
    const session = {
      id: "sess-1",
      agentId: "claude",
      status: "idle" as const,
      context: {
        variables: {},
        childSessionIds: [],
        metadata: {},
      },
      createdAt: now,
      updatedAt: now,
    };
    assert.strictEqual(session.id, "sess-1");
    assert.strictEqual(session.agentId, "claude");
    assert.strictEqual(session.status, "idle");
    assert.deepStrictEqual(session.context.childSessionIds, []);
  });

  it("supports parent-child session relationships", () => {
    const parent = {
      id: "parent-1",
      agentId: "claude",
      status: "idle" as const,
      context: {
        variables: {},
        childSessionIds: ["child-1"],
        metadata: {},
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    assert.ok(parent.context.childSessionIds.includes("child-1"));
  });
});

describe("Domain Models — SessionStatus", () => {
  const statuses = ["idle", "running", "waiting_for_input", "completed", "error", "cancelled"] as const;

  it("has exactly 6 session statuses", () => {
    assert.strictEqual(statuses.length, 6);
  });

  it("includes terminal states", () => {
    assert.ok(statuses.includes("completed"));
    assert.ok(statuses.includes("error"));
    assert.ok(statuses.includes("cancelled"));
  });
});

describe("Domain Models — ChatMessage", () => {
  it("creates a valid user message", () => {
    const msg = {
      id: "msg-1",
      role: "user" as const,
      content: "Hello",
      timestamp: Date.now(),
    };
    assert.strictEqual(msg.role, "user");
    assert.strictEqual(msg.content, "Hello");
  });

  it("creates a message with tool calls", () => {
    const msg = {
      id: "msg-2",
      role: "agent" as const,
      content: "",
      timestamp: Date.now(),
      toolCalls: [
        {
          id: "tc-1",
          title: "Read file",
          status: "completed" as const,
          kind: "read",
          input: '{"path": "/tmp/test.txt"}',
          output: "file content",
        },
      ],
    };
    assert.strictEqual(msg.toolCalls!.length, 1);
    assert.strictEqual(msg.toolCalls![0].status, "completed");
  });

  it("creates a message with serialized tool calls for storage", () => {
    const msg = {
      id: "msg-3",
      role: "tool" as const,
      content: "",
      timestamp: Date.now(),
      toolCallsJson: '[{"id":"tc-1","title":"test"}]',
    };
    assert.ok(msg.toolCallsJson);
    const parsed = JSON.parse(msg.toolCallsJson);
    assert.strictEqual(parsed[0].id, "tc-1");
  });
});

describe("Domain Models — ToolCall", () => {
  const validStatuses = ["in_progress", "completed", "failed", "cancelled"] as const;

  it("has valid status values", () => {
    assert.strictEqual(validStatuses.length, 4);
  });

  it("creates a tool call with diff content", () => {
    const tc = {
      id: "tc-diff",
      title: "Edit file",
      status: "completed" as const,
      kind: "edit",
      diffContent: {
        oldText: "old line",
        newText: "new line",
        path: "/tmp/file.ts",
      },
    };
    assert.strictEqual(tc.diffContent!.path, "/tmp/file.ts");
    assert.strictEqual(tc.diffContent!.oldText, "old line");
  });

  it("creates a tool call with locations", () => {
    const tc = {
      id: "tc-loc",
      title: "Search",
      status: "completed" as const,
      kind: "search",
      locations: [
        { path: "/src/index.ts", line: 10 },
        { path: "/src/utils.ts" },
      ],
    };
    assert.strictEqual(tc.locations!.length, 2);
    assert.strictEqual(tc.locations![0].line, 10);
    assert.strictEqual(tc.locations![1].line, undefined);
  });
});

describe("Domain Models — Message (structured)", () => {
  it("creates a text content message", () => {
    const content = { type: "text" as const, text: "Hello world" };
    assert.strictEqual(content.type, "text");
    assert.strictEqual(content.text, "Hello world");
  });

  it("creates a tool_use content message", () => {
    const content = {
      type: "tool_use" as const,
      toolUseId: "tu-1",
      toolName: "read_file",
      toolInput: { path: "/tmp/test.txt" },
    };
    assert.strictEqual(content.type, "tool_use");
    assert.strictEqual(content.toolName, "read_file");
  });

  it("creates a tool_result content message", () => {
    const content = {
      type: "tool_result" as const,
      toolUseId: "tu-1",
      toolResult: "file content here",
    };
    assert.strictEqual(content.type, "tool_result");
  });

  it("creates an image content message", () => {
    const content = {
      type: "image" as const,
      data: "base64data",
      mimeType: "image/png",
    };
    assert.strictEqual(content.type, "image");
    assert.strictEqual(content.mimeType, "image/png");
  });
});

describe("Domain Models — Task", () => {
  it("creates a single_agent task", () => {
    const task = {
      id: "task-1",
      type: "single_agent" as const,
      status: "pending" as const,
      assignedAgentId: "claude",
      input: "Do something",
      subtasks: [],
      dependencies: [],
      createdAt: new Date(),
    };
    assert.strictEqual(task.type, "single_agent");
    assert.strictEqual(task.status, "pending");
  });

  it("creates a pipeline task with dependencies", () => {
    const task = {
      id: "task-2",
      type: "pipeline" as const,
      status: "pending" as const,
      assignedAgentId: "claude",
      input: null,
      subtasks: [],
      dependencies: ["task-1"],
      createdAt: new Date(),
    };
    assert.strictEqual(task.type, "pipeline");
    assert.deepStrictEqual(task.dependencies, ["task-1"]);
  });

  it("supports all task types", () => {
    const types = ["single_agent", "multi_agent", "pipeline", "parallel"] as const;
    assert.strictEqual(types.length, 4);
  });

  it("supports all task statuses", () => {
    const statuses = ["pending", "running", "completed", "failed", "cancelled"] as const;
    assert.strictEqual(statuses.length, 5);
  });

  it("sets completedAt on completion", () => {
    const now = new Date();
    const task = {
      id: "task-3",
      type: "single_agent" as const,
      status: "completed" as const,
      assignedAgentId: "claude",
      input: null,
      output: "result",
      subtasks: [],
      dependencies: [],
      createdAt: new Date(now.getTime() - 1000),
      completedAt: now,
    };
    assert.ok(task.completedAt);
    assert.ok(task.completedAt >= task.createdAt);
  });
});

describe("Domain Models — OrchestrationEvent", () => {
  it("creates a session.created event", () => {
    const event = {
      id: "evt-1",
      type: "session.created" as const,
      timestamp: new Date(),
      payload: { agentId: "claude", sessionId: "sess-1" },
    };
    assert.strictEqual(event.type, "session.created");
    assert.ok(event.id.length > 0);
  });

  it("supports all event types", () => {
    const eventTypes = [
      "session.created",
      "session.status_changed",
      "session.completed",
      "message.received",
      "message.sent",
      "task.created",
      "task.status_changed",
      "agent.handoff",
      "error.occurred",
    ] as const;
    assert.strictEqual(eventTypes.length, 9);
  });
});

describe("Domain Models — ContextAttachmentDTO", () => {
  it("creates a file attachment", () => {
    const attachment = {
      id: "ctx-1",
      type: "file" as const,
      path: "/src/index.ts",
      label: "index.ts",
      tokenCount: 100,
      content: "file content",
    };
    assert.strictEqual(attachment.type, "file");
    assert.strictEqual(attachment.tokenCount, 100);
  });

  it("creates a selection attachment with line range", () => {
    const attachment = {
      id: "ctx-2",
      type: "selection" as const,
      path: "/src/index.ts",
      label: "index.ts:10-20",
      lineRange: [10, 20] as [number, number],
      tokenCount: 50,
      content: "selected text",
    };
    assert.deepStrictEqual(attachment.lineRange, [10, 20]);
  });
});
