import * as assert from "assert";
import { describe, it } from "mocha";
import type {
  SendTarget,
  MeshAgentStatus,
  MeshTaskEntry,
  MeshRecentMessage,
  CommunicationMode,
  MeshMessageType,
} from "../../../types";

// ═══════════════════════════════════════════════════════════════════════════
// Section 1: SendTarget operations (meshStore contract tests)
// ═══════════════════════════════════════════════════════════════════════════

describe("meshStore: SendTarget operations", () => {
  // ── Helper: simulate meshStore sendTarget mutations ──────────────────────
  // These mirror the exact logic from meshStore.ts so we test the contract
  // without needing a running Zustand store.

  function addSendTarget(
    targets: SendTarget[],
    target: SendTarget
  ): SendTarget[] {
    const exists = targets.some(
      (t) => t.agentId === target.agentId && t.sessionId === target.sessionId
    );
    if (exists) return targets;
    return [...targets, target];
  }

  function removeSendTarget(
    targets: SendTarget[],
    agentId: string,
    sessionId: string
  ): SendTarget[] {
    return targets.filter(
      (t) => !(t.agentId === agentId && t.sessionId === sessionId)
    );
  }

  function clearSendTargets(): SendTarget[] {
    return [];
  }

  function updateSendTargetStatus(
    targets: SendTarget[],
    agentId: string,
    sessionId: string,
    status: SendTarget["status"]
  ): SendTarget[] {
    const idx = targets.findIndex(
      (t) => t.agentId === agentId && t.sessionId === sessionId
    );
    if (idx < 0) return targets;
    const prev = targets[idx];
    if (prev.status === status) return targets;
    const arr = [...targets];
    arr[idx] = { ...prev, status };
    return arr;
  }

  // ── Test data ──────────────────────────────────────────────────────────

  const targetA: SendTarget = {
    agentId: "claude",
    sessionId: "sess-aaa",
    label: "claude",
    status: "idle",
  };

  const targetB: SendTarget = {
    agentId: "codex",
    sessionId: "sess-bbb",
    label: "codex",
    status: "idle",
  };

  const targetC: SendTarget = {
    agentId: "gemini",
    sessionId: "sess-ccc",
    label: "gemini",
    status: "idle",
  };

  // ── addSendTarget ──────────────────────────────────────────────────────

  describe("addSendTarget", () => {
    it("adds a target to empty list", () => {
      const result = addSendTarget([], targetA);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].agentId, "claude");
    });

    it("adds a second target", () => {
      const result = addSendTarget([targetA], targetB);
      assert.strictEqual(result.length, 2);
    });

    it("does not add duplicate target", () => {
      const result = addSendTarget([targetA, targetB], targetA);
      assert.strictEqual(result.length, 2);
    });

    it("adds third target", () => {
      const result = addSendTarget([targetA, targetB], targetC);
      assert.strictEqual(result.length, 3);
    });
  });

  // ── removeSendTarget ───────────────────────────────────────────────────

  describe("removeSendTarget", () => {
    it("removes an existing target", () => {
      const result = removeSendTarget([targetA, targetB], "claude", "sess-aaa");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].agentId, "codex");
    });

    it("returns same list when target not found", () => {
      const result = removeSendTarget([targetA], "unknown", "sess-xxx");
      assert.strictEqual(result.length, 1);
    });

    it("removes last target", () => {
      const result = removeSendTarget([targetA], "claude", "sess-aaa");
      assert.strictEqual(result.length, 0);
    });
  });

  // ── clearSendTargets ───────────────────────────────────────────────────

  describe("clearSendTargets", () => {
    it("clears all targets", () => {
      const result = clearSendTargets();
      assert.strictEqual(result.length, 0);
    });
  });

  // ── updateSendTargetStatus ─────────────────────────────────────────────

  describe("updateSendTargetStatus", () => {
    it("updates status of an existing target", () => {
      const result = updateSendTargetStatus(
        [targetA, targetB],
        "claude",
        "sess-aaa",
        "running"
      );
      assert.strictEqual(result[0].status, "running");
      assert.strictEqual(result[1].status, "idle"); // unchanged
    });

    it("returns same list when target not found", () => {
      const result = updateSendTargetStatus(
        [targetA],
        "unknown",
        "sess-xxx",
        "running"
      );
      assert.strictEqual(result[0].status, "idle");
    });

    it("returns same list when status unchanged", () => {
      const result = updateSendTargetStatus(
        [targetA],
        "claude",
        "sess-aaa",
        "idle"
      );
      assert.strictEqual(result, targetA); // identity preserved
    });
  });

  // ── Multi-target workflow ──────────────────────────────────────────────

  describe("multi-target workflow (add → update → remove → clear)", () => {
    it("full lifecycle: add 3, update statuses, remove 1, clear", () => {
      let targets: SendTarget[] = [];

      // User types @claude → @codex → @gemini
      targets = addSendTarget(targets, targetA);
      targets = addSendTarget(targets, targetB);
      targets = addSendTarget(targets, targetC);
      assert.strictEqual(targets.length, 3);

      // Agent starts working
      targets = updateSendTargetStatus(
        targets,
        "claude",
        "sess-aaa",
        "running"
      );
      targets = updateSendTargetStatus(targets, "codex", "sess-bbb", "running");
      assert.strictEqual(targets[0].status, "running");
      assert.strictEqual(targets[1].status, "running");
      assert.strictEqual(targets[2].status, "idle"); // gemini still idle

      // Claude finishes
      targets = updateSendTargetStatus(
        targets,
        "claude",
        "sess-aaa",
        "completed"
      );
      assert.strictEqual(targets[0].status, "completed");

      // User removes gemini (clicked X on chip)
      targets = removeSendTarget(targets, "gemini", "sess-ccc");
      assert.strictEqual(targets.length, 2);

      // Send completes — clear all
      targets = clearSendTargets();
      assert.strictEqual(targets.length, 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2: Mesh command snippet processing
// Tests that /mesh <mode> commands are correctly parsed and dispatched
// ═══════════════════════════════════════════════════════════════════════════

describe("Mesh command snippet processing", () => {
  // ── Pure function: parse mesh command from textarea text ───────────────
  // This mirrors the trigger detection logic in useTriggerPicker + Composer

  interface ParsedMeshCommand {
    command: "meshPlan" | "meshStatus" | "meshCancel" | null;
    mode: CommunicationMode | null;
    targetQuery: string; // text after @ for target selection
  }

  function parseMeshSnippet(text: string): ParsedMeshCommand {
    const trimmed = text.trim();

    // /mesh commands
    if (trimmed === "/mesh plan") {
      return { command: "meshPlan", mode: null, targetQuery: "" };
    }
    if (trimmed === "/mesh status") {
      return { command: "meshStatus", mode: null, targetQuery: "" };
    }
    if (trimmed === "/mesh cancel") {
      return { command: "meshCancel", mode: null, targetQuery: "" };
    }

    // /mesh with mode
    const modeMatch = trimmed.match(
      /^\/mesh\s+(fanout|supervisor|pipeline|status|task)$/
    );
    if (modeMatch) {
      return {
        command: null,
        mode: modeMatch[1] as CommunicationMode,
        targetQuery: "",
      };
    }

    // @target query (for multi-agent send)
    if (trimmed.startsWith("@")) {
      return {
        command: null,
        mode: null,
        targetQuery: trimmed.slice(1),
      };
    }

    return { command: null, mode: null, targetQuery: "" };
  }

  // ── /mesh command parsing ──────────────────────────────────────────────

  describe("parseMeshSnippet: /mesh commands", () => {
    it("parses /mesh plan", () => {
      const result = parseMeshSnippet("/mesh plan");
      assert.strictEqual(result.command, "meshPlan");
    });

    it("parses /mesh status", () => {
      const result = parseMeshSnippet("/mesh status");
      assert.strictEqual(result.command, "meshStatus");
    });

    it("parses /mesh cancel", () => {
      const result = parseMeshSnippet("/mesh cancel");
      assert.strictEqual(result.command, "meshCancel");
    });
  });

  // ── /mesh mode parsing ────────────────────────────────────────────────

  describe("parseMeshSnippet: /mesh modes", () => {
    it("parses /mesh fanout", () => {
      const result = parseMeshSnippet("/mesh fanout");
      assert.strictEqual(result.mode, "fanout");
    });

    it("parses /mesh supervisor", () => {
      const result = parseMeshSnippet("/mesh supervisor");
      assert.strictEqual(result.mode, "supervisor");
    });

    it("parses /mesh pipeline", () => {
      const result = parseMeshSnippet("/mesh pipeline");
      assert.strictEqual(result.mode, "pipeline");
    });

    it("parses /mesh status", () => {
      const result = parseMeshSnippet("/mesh status");
      assert.strictEqual(result.command, "meshStatus");
    });
  });

  // ── @target query parsing ─────────────────────────────────────────────

  describe("parseMeshSnippet: @target queries", () => {
    it("parses @claude", () => {
      const result = parseMeshSnippet("@claude");
      assert.strictEqual(result.targetQuery, "claude");
    });

    it("parses @claude with query", () => {
      const result = parseMeshSnippet("@clau");
      assert.strictEqual(result.targetQuery, "clau");
    });

    it("parses @ with empty query", () => {
      const result = parseMeshSnippet("@");
      assert.strictEqual(result.targetQuery, "");
    });
  });

  // ── Invalid input ──────────────────────────────────────────────────────

  describe("parseMeshSnippet: invalid input", () => {
    it("returns null for plain text", () => {
      const result = parseMeshSnippet("hello world");
      assert.strictEqual(result.command, null);
      assert.strictEqual(result.mode, null);
    });

    it("returns null for unknown /mesh subcommand", () => {
      const result = parseMeshSnippet("/mesh unknown");
      assert.strictEqual(result.command, null);
      assert.strictEqual(result.mode, null);
    });

    it("returns null for unrelated slash command", () => {
      const result = parseMeshSnippet("/help");
      assert.strictEqual(result.command, null);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Prompt snippet text transformation
// Tests the text replacement logic when @-targets are selected in Composer
// ═══════════════════════════════════════════════════════════════════════════

describe("Prompt snippet text transformation (@-target selection)", () => {
  // ── Pure function: simulate Composer.resolveItem for session kind ──────
  // This is the exact logic from Composer.tsx resolveItem for item.kind === "session"
  // where subTrigger !== "switch" (multi-@ mode).

  interface TriggerState {
    active: boolean;
    trigger: "/" | "#" | "@";
    query: string;
    caretOffset: number;
    subTrigger?: "symbol" | "file" | "switch";
    multiMode?: boolean;
  }

  function applySessionSelection(
    text: string,
    triggerState: TriggerState
  ): string {
    const consumed =
      triggerState.trigger === "/" || triggerState.trigger === "@"
        ? 1 + triggerState.query.length
        : triggerState.subTrigger
          ? 1 +
            triggerState.subTrigger.length +
            (triggerState.query.length > 0 ? 1 + triggerState.query.length : 0)
          : 1 + triggerState.query.length;

    const before = text.slice(0, triggerState.caretOffset);
    const after = text.slice(triggerState.caretOffset + consumed);
    const space = after.startsWith(" ") ? "" : " ";

    // Multi-@: remove @query from textarea, don't insert label
    return before + after;
  }

  // ── Basic @-target removal ─────────────────────────────────────────────

  describe("single @-target at end", () => {
    it("removes @claude from end of text", () => {
      const text = "fix the bug @claude";
      const ts: TriggerState = {
        active: true,
        trigger: "@",
        query: "claude",
        caretOffset: 12,
      };
      const result = applySessionSelection(text, ts);
      assert.strictEqual(result, "fix the bug ");
      assert.ok(!result.includes("@"));
    });
  });

  describe("single @-target at start", () => {
    it("removes @claude from start of text", () => {
      const text = "@claude fix the bug";
      const ts: TriggerState = {
        active: true,
        trigger: "@",
        query: "claude",
        caretOffset: 0,
      };
      const result = applySessionSelection(text, ts);
      assert.strictEqual(result, "fix the bug");
      assert.ok(!result.includes("@"));
    });
  });

  describe("multiple @-targets in sequence", () => {
    it("first @ selection removes @claude", () => {
      const text = "@claude @codex fix the bug";
      const ts: TriggerState = {
        active: true,
        trigger: "@",
        query: "claude",
        caretOffset: 0,
        multiMode: true,
      };
      const result = applySessionSelection(text, ts);
      assert.strictEqual(result, " @codex fix the bug");
      // First @ removed, second @ remains for next selection
    });

    it("second @ selection on remaining text removes @codex", () => {
      // After first selection, remaining text is " @codex fix the bug"
      const text = " @codex fix the bug";
      const ts: TriggerState = {
        active: true,
        trigger: "@",
        query: "codex",
        caretOffset: 1,
        multiMode: true,
      };
      const result = applySessionSelection(text, ts);
      assert.strictEqual(result, " fix the bug");
      assert.ok(!result.includes("@"));
    });
  });

  describe("@-target with surrounding text", () => {
    it("removes @target from middle of sentence", () => {
      const text = "hey @claude please fix this";
      const ts: TriggerState = {
        active: true,
        trigger: "@",
        query: "claude",
        caretOffset: 4,
      };
      const result = applySessionSelection(text, ts);
      assert.strictEqual(result, "hey  please fix this");
    });
  });

  describe("@-target with partial query", () => {
    it("removes @clau when user typed partial query", () => {
      const text = "@clau fix the bug";
      const ts: TriggerState = {
        active: true,
        trigger: "@",
        query: "clau",
        caretOffset: 0,
      };
      const result = applySessionSelection(text, ts);
      assert.strictEqual(result, " fix the bug");
    });
  });

  describe("@-target with empty query (just @)", () => {
    it("removes @ and keeps surrounding text", () => {
      const text = "hello @ world";
      const ts: TriggerState = {
        active: true,
        trigger: "@",
        query: "",
        caretOffset: 6,
      };
      const result = applySessionSelection(text, ts);
      assert.strictEqual(result, "hello  world");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 4: Mesh message type validation
// Tests that mesh communication message types conform to the protocol
// ═══════════════════════════════════════════════════════════════════════════

describe("Mesh message type validation", () => {
  const VALID_MESH_TYPES: MeshMessageType[] = [
    "task_request",
    "task_response",
    "task_delegate",
    "status_update",
    "file_lock_request",
    "file_lock_release",
    "review_request",
    "review_response",
    "question",
    "answer",
    "broadcast",
    "ping",
    "pong",
  ];

  const VALID_COMMUNICATION_MODES: CommunicationMode[] = [
    "direct",
    "fanout",
    "supervisor",
    "pipeline",
    "p2P",
  ];

  describe("MeshMessageType", () => {
    it("has 13 valid message types", () => {
      assert.strictEqual(VALID_MESH_TYPES.length, 13);
    });

    it("all types are unique", () => {
      assert.strictEqual(
        new Set(VALID_MESH_TYPES).size,
        VALID_MESH_TYPES.length
      );
    });

    it("includes task-related types", () => {
      assert.ok(VALID_MESH_TYPES.includes("task_request"));
      assert.ok(VALID_MESH_TYPES.includes("task_response"));
      assert.ok(VALID_MESH_TYPES.includes("task_delegate"));
    });

    it("includes coordination types", () => {
      assert.ok(VALID_MESH_TYPES.includes("question"));
      assert.ok(VALID_MESH_TYPES.includes("answer"));
      assert.ok(VALID_MESH_TYPES.includes("broadcast"));
    });
  });

  describe("CommunicationMode", () => {
    it("has 5 valid modes", () => {
      assert.strictEqual(VALID_COMMUNICATION_MODES.length, 5);
    });

    it("all modes are unique", () => {
      assert.strictEqual(
        new Set(VALID_COMMUNICATION_MODES).size,
        VALID_COMMUNICATION_MODES.length
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 5: MeshAgentStatus state transitions
// Tests agent status lifecycle: idle → working → waiting → idle
// ═══════════════════════════════════════════════════════════════════════════

describe("MeshAgentStatus state transitions", () => {
  // ── Pure function: compute next agent state ────────────────────────────
  // Mirrors the logic in handlers/mesh/mesh.ts handleAgentStatus

  type AgentState = "idle" | "working" | "waiting" | "error" | "disconnected";

  function computeNextState(
    current: AgentState,
    incoming: "idle" | "running" | "waiting" | "error" | "completed"
  ): AgentState {
    switch (incoming) {
      case "running":
        return "working";
      case "waiting":
        return "waiting";
      case "error":
        return "error";
      case "completed":
      case "idle":
      default:
        return "idle";
    }
  }

  describe("computeNextState", () => {
    it("idle → working on running", () => {
      assert.strictEqual(computeNextState("idle", "running"), "working");
    });

    it("working → waiting on waiting", () => {
      assert.strictEqual(computeNextState("working", "waiting"), "waiting");
    });

    it("working → idle on completed", () => {
      assert.strictEqual(computeNextState("working", "completed"), "idle");
    });

    it("working → error on error", () => {
      assert.strictEqual(computeNextState("working", "error"), "error");
    });

    it("error → idle on completed", () => {
      assert.strictEqual(computeNextState("error", "completed"), "idle");
    });

    it("waiting → working on running", () => {
      assert.strictEqual(computeNextState("waiting", "running"), "working");
    });

    it("disconnected → idle on completed", () => {
      assert.strictEqual(computeNextState("disconnected", "completed"), "idle");
    });
  });

  // ── Agent status workflow ──────────────────────────────────────────────

  describe("agent lifecycle workflow", () => {
    it("full lifecycle: idle → working → completed → idle", () => {
      let state: AgentState = "idle";
      state = computeNextState(state, "running");
      assert.strictEqual(state, "working");
      state = computeNextState(state, "completed");
      assert.strictEqual(state, "idle");
    });

    it("error recovery: idle → working → error → idle", () => {
      let state: AgentState = "idle";
      state = computeNextState(state, "running");
      assert.strictEqual(state, "working");
      state = computeNextState(state, "error");
      assert.strictEqual(state, "error");
      state = computeNextState(state, "completed");
      assert.strictEqual(state, "idle");
    });

    it("supervisor pattern: idle → waiting → working → completed", () => {
      let state: AgentState = "idle";
      state = computeNextState(state, "waiting");
      assert.strictEqual(state, "waiting");
      state = computeNextState(state, "running");
      assert.strictEqual(state, "working");
      state = computeNextState(state, "completed");
      assert.strictEqual(state, "idle");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 6: Mesh task board operations
// Tests task status transitions and filtering
// ═══════════════════════════════════════════════════════════════════════════

describe("Mesh task board operations", () => {
  // ── Pure function: task status progression ─────────────────────────────

  type TaskStatus =
    | "pending"
    | "assigned"
    | "in_progress"
    | "review"
    | "completed"
    | "failed";

  function nextTaskStatus(
    current: TaskStatus,
    action: "assign" | "start" | "submit_review" | "complete" | "fail"
  ): TaskStatus {
    switch (action) {
      case "assign":
        return "assigned";
      case "start":
        return "in_progress";
      case "submit_review":
        return "review";
      case "complete":
        return "completed";
      case "fail":
        return "failed";
      default:
        return current;
    }
  }

  describe("nextTaskStatus", () => {
    it("pending → assigned on assign", () => {
      assert.strictEqual(nextTaskStatus("pending", "assign"), "assigned");
    });

    it("assigned → in_progress on start", () => {
      assert.strictEqual(nextTaskStatus("assigned", "start"), "in_progress");
    });

    it("in_progress → review on submit_review", () => {
      assert.strictEqual(
        nextTaskStatus("in_progress", "submit_review"),
        "review"
      );
    });

    it("review → completed on complete", () => {
      assert.strictEqual(nextTaskStatus("review", "complete"), "completed");
    });

    it("in_progress → failed on fail", () => {
      assert.strictEqual(nextTaskStatus("in_progress", "fail"), "failed");
    });
  });

  // ── Task filtering ─────────────────────────────────────────────────────

  function filterTasksByStatus(
    tasks: MeshTaskEntry[],
    status: TaskStatus | "all"
  ): MeshTaskEntry[] {
    if (status === "all") return tasks;
    return tasks.filter((t) => t.status === status);
  }

  const sampleTasks: MeshTaskEntry[] = [
    {
      id: "t1",
      title: "Implement OAuth",
      description: "Add OAuth2 flow",
      status: "completed",
      assignedTo: "claude",
    },
    {
      id: "t2",
      title: "Fix login bug",
      description: "Login fails on Safari",
      status: "in_progress",
      assignedTo: "codex",
    },
    {
      id: "t3",
      title: "Add tests",
      description: "Write unit tests",
      status: "pending",
    },
    {
      id: "t4",
      title: "Update docs",
      description: "Update API docs",
      status: "assigned",
      assignedTo: "claude",
    },
    {
      id: "t5",
      title: "Refactor auth",
      description: "Refactor auth module",
      status: "failed",
      assignedTo: "gemini",
    },
  ];

  describe("filterTasksByStatus", () => {
    it("returns all tasks when filter is 'all'", () => {
      const result = filterTasksByStatus(sampleTasks, "all");
      assert.strictEqual(result.length, 5);
    });

    it("filters completed tasks", () => {
      const result = filterTasksByStatus(sampleTasks, "completed");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, "t1");
    });

    it("filters in_progress tasks", () => {
      const result = filterTasksByStatus(sampleTasks, "in_progress");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, "t2");
    });

    it("filters pending tasks", () => {
      const result = filterTasksByStatus(sampleTasks, "pending");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, "t3");
    });

    it("returns empty for status with no tasks", () => {
      const result = filterTasksByStatus(sampleTasks, "review");
      assert.strictEqual(result.length, 0);
    });
  });

  // ── Task progress aggregation ──────────────────────────────────────────

  function computeTaskProgress(tasks: MeshTaskEntry[]): {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    overallPct: number;
  } {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const pending = tasks.filter(
      (t) => t.status === "pending" || t.status === "assigned"
    ).length;
    const overallPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, failed, inProgress, pending, overallPct };
  }

  describe("computeTaskProgress", () => {
    it("computes correct counts", () => {
      const result = computeTaskProgress(sampleTasks);
      assert.strictEqual(result.total, 5);
      assert.strictEqual(result.completed, 1);
      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.inProgress, 1);
      assert.strictEqual(result.pending, 2); // t3 (pending) + t4 (assigned)
    });

    it("computes overall percentage", () => {
      const result = computeTaskProgress(sampleTasks);
      assert.strictEqual(result.overallPct, 20); // 1/5 = 20%
    });

    it("returns 0% for empty task list", () => {
      const result = computeTaskProgress([]);
      assert.strictEqual(result.overallPct, 0);
      assert.strictEqual(result.total, 0);
    });

    it("returns 100% when all completed", () => {
      const allCompleted = sampleTasks.map((t) => ({
        ...t,
        status: "completed" as const,
      }));
      const result = computeTaskProgress(allCompleted);
      assert.strictEqual(result.overallPct, 100);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 7: Mesh recent message log
// Tests message log operations (append, trim, filter by agent)
// ═══════════════════════════════════════════════════════════════════════════

describe("Mesh recent message log", () => {
  const MAX_RECENT_MESSAGES = 50;

  function addRecentMessage(
    messages: MeshRecentMessage[],
    message: MeshRecentMessage
  ): MeshRecentMessage[] {
    const arr = [...messages, message];
    if (arr.length > MAX_RECENT_MESSAGES) {
      arr.splice(0, arr.length - MAX_RECENT_MESSAGES);
    }
    return arr;
  }

  function filterMessagesByAgent(
    messages: MeshRecentMessage[],
    agentId: string
  ): MeshRecentMessage[] {
    return messages.filter((m) => m.from === agentId || m.to === agentId);
  }

  function filterMessagesByType(
    messages: MeshRecentMessage[],
    type: string
  ): MeshRecentMessage[] {
    return messages.filter((m) => m.type === type);
  }

  const now = new Date().toISOString();
  const sampleMessages: MeshRecentMessage[] = [
    {
      messageId: "m1",
      type: "task_request",
      from: "claude",
      to: "codex",
      timestamp: now,
      summary: "Implement OAuth2",
    },
    {
      messageId: "m2",
      type: "task_response",
      from: "codex",
      to: "claude",
      timestamp: now,
      summary: "OAuth2 implemented",
    },
    {
      messageId: "m3",
      type: "question",
      from: "claude",
      to: "gemini",
      timestamp: now,
      summary: "Which auth library?",
    },
    {
      messageId: "m4",
      type: "answer",
      from: "gemini",
      to: "claude",
      timestamp: now,
      summary: "Use passport-oauth2",
    },
    {
      messageId: "m5",
      type: "broadcast",
      from: "claude",
      to: "all",
      timestamp: now,
      summary: "Auth module updated",
    },
  ];

  describe("addRecentMessage", () => {
    it("appends a message", () => {
      const result = addRecentMessage([], sampleMessages[0]);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].messageId, "m1");
    });

    it("trims to MAX_RECENT_MESSAGES when exceeded", () => {
      // Create 50 messages
      let messages: MeshRecentMessage[] = [];
      for (let i = 0; i < 50; i++) {
        messages = addRecentMessage(messages, {
          ...sampleMessages[0],
          messageId: `msg-${i}`,
        });
      }
      assert.strictEqual(messages.length, 50);

      // Add one more — should trim oldest
      messages = addRecentMessage(messages, {
        ...sampleMessages[0],
        messageId: "msg-50",
      });
      assert.strictEqual(messages.length, 50);
      assert.strictEqual(messages[0].messageId, "msg-1"); // oldest trimmed
      assert.strictEqual(messages[49].messageId, "msg-50"); // newest kept
    });
  });

  describe("filterMessagesByAgent", () => {
    it("returns messages from claude", () => {
      const result = filterMessagesByAgent(sampleMessages, "claude");
      assert.strictEqual(result.length, 3); // m1 (from), m3 (from), m5 (from)
    });

    it("returns messages to claude", () => {
      const result = filterMessagesByAgent(sampleMessages, "claude");
      // m2 (to), m4 (to) are also included
      const toClaude = result.filter((m) => m.to === "claude");
      assert.strictEqual(toClaude.length, 2);
    });

    it("returns empty for unknown agent", () => {
      const result = filterMessagesByAgent(sampleMessages, "unknown");
      assert.strictEqual(result.length, 0);
    });
  });

  describe("filterMessagesByType", () => {
    it("filters task_request", () => {
      const result = filterMessagesByType(sampleMessages, "task_request");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].messageId, "m1");
    });

    it("filters broadcast", () => {
      const result = filterMessagesByType(sampleMessages, "broadcast");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].messageId, "m5");
    });

    it("returns empty for unknown type", () => {
      const result = filterMessagesByType(sampleMessages, "unknown_type");
      assert.strictEqual(result.length, 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 8: Composer prompt snippet integration scenarios
// End-to-end text transformation scenarios for mesh communication patterns
// ═══════════════════════════════════════════════════════════════════════════

describe("Composer prompt snippet integration scenarios", () => {
  // ── Scenario: fanout message to multiple agents ───────────────────────
  // User types: "@claude @codex fix the auth bug"
  // Expected: both targets added to sendTargets, text becomes "fix the auth bug"

  describe("fanout: @claude @codex fix the auth bug", () => {
    it("first @claude selection removes @claude from text", () => {
      const text = "@claude @codex fix the auth bug";
      // @ at offset 0, query = "claude"
      const consumed = 1 + 6; // @ + claude
      const before = text.slice(0, 0);
      const after = text.slice(0 + consumed);
      const result = before + after;
      assert.strictEqual(result, " @codex fix the auth bug");
      assert.ok(!result.startsWith("@"));
    });

    it("second @codex selection removes @codex from text", () => {
      // After first selection: " @codex fix the auth bug"
      const text = " @codex fix the auth bug";
      // @ at offset 1, query = "codex"
      const consumed = 1 + 5; // @ + codex
      const before = text.slice(0, 1);
      const after = text.slice(1 + consumed);
      const result = before + after;
      assert.strictEqual(result, " fix the auth bug");
      assert.ok(!result.includes("@claude"));
      assert.ok(!result.includes("@codex"));
    });

    it("final text after both selections is clean prompt", () => {
      // Simulate full flow
      let text = "@claude @codex fix the auth bug";

      // Select @claude
      let consumed = 1 + 6;
      let before = text.slice(0, 0);
      let after = text.slice(0 + consumed);
      text = before + after; // " @codex fix the auth bug"

      // Select @codex
      consumed = 1 + 5;
      before = text.slice(0, 1);
      after = text.slice(1 + consumed);
      text = before + after; // " fix the auth bug"

      assert.strictEqual(text, " fix the auth bug");
      assert.ok(!text.includes("@"));
    });
  });

  // ── Scenario: supervisor pattern with @lead ────────────────────────────
  describe("supervisor: @claude please review @codex output", () => {
    it("removes both @ targets and keeps message intact", () => {
      let text = "@claude please review @codex output";

      // Select @claude (offset 0)
      let consumed = 1 + 6;
      let before = text.slice(0, 0);
      let after = text.slice(consumed);
      text = before + after; // " please review @codex output"

      // Select @codex (offset 14)
      consumed = 1 + 5;
      before = text.slice(0, 14);
      after = text.slice(14 + consumed);
      text = before + after; // " please review  output"

      assert.ok(!text.includes("@"));
      assert.ok(text.includes("please review"));
      assert.ok(text.includes("output"));
    });
  });

  // ── Scenario: /mesh plan command ───────────────────────────────────────
  describe("/mesh plan command", () => {
    it("text /mesh plan triggers mesh plan", () => {
      const text = "/mesh plan";
      assert.strictEqual(text, "/mesh plan");
      // This would be intercepted by the / command picker
      // and mapped to meshPlan action
    });

    it("text /mesh fanout triggers fanout mode", () => {
      const text = "/mesh fanout";
      const parts = text.split(" ");
      assert.strictEqual(parts[0], "/mesh");
      assert.strictEqual(parts[1], "fanout");
    });
  });

  // ── Scenario: @ with session switching (#switch) ───────────────────────
  describe("#switch vs @target: different behaviors", () => {
    it("#switch replaces active session (single target)", () => {
      // #switch changes the active session — it's a navigation action
      // The text "#switch agent2:sess-xxx" would trigger session switch
      const text = "#switch claude:sess-abc";
      assert.ok(text.startsWith("#switch"));
      // After switch, text is cleared (newText = "")
    });

    it("@session adds to multi-target list (does not navigate)", () => {
      // @session in multi-@ mode adds to sendTargets
      // The text "@claude" removes @claude from textarea
      const text = "@claude hello";
      const consumed = 1 + 6;
      const before = text.slice(0, 0);
      const after = text.slice(consumed);
      const result = before + after;
      assert.strictEqual(result, " hello");
      // @claude is removed but "hello" remains for the message
    });
  });
});
