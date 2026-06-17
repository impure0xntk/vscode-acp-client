// ============================================================================
// MeshOrchestrator unit tests
//
// Uses manual mocks for SessionOrchestrator, MessageBus, FileLockManager,
// TaskBoardStore to isolate the orchestration logic.
// ============================================================================

import * as assert from "assert";
import { EventEmitter } from "events";
import { MeshOrchestrator } from "../../domain/services/mesh-orchestrator";
import { MessageBus } from "../../domain/services/message-bus";
import { FileLockManager } from "../../domain/services/file-lock-manager";
import { TaskBoardStore } from "../../domain/services/task-board-store";
import type { SessionOrchestrator } from "../../application/session/orchestrator";
import type { P2PMessage, MeshTeam, TaskEntry } from "../../domain/models/mesh";
import {
  MESH_MARKER_OPEN,
  MESH_MARKER_CLOSE,
  MESH_MARKER_V2_OPEN,
} from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Mock SessionOrchestrator
// ----------------------------------------------------------------------------

function createMockSessionOrchestrator(): SessionOrchestrator & EventEmitter {
  const emitter = new EventEmitter();
  const mock = Object.assign(emitter, {
    getActiveSessionId: (agentId: string): string | undefined => {
      return (mock as any)._activeSessions?.[agentId];
    },
    prompt: async (
      agentId: string,
      sessionId: string,
      text: string
    ): Promise<void> => {
      (mock as any)._lastPrompt = { agentId, sessionId, text };
      (mock as any)._promptCalls.push({ agentId, sessionId, text });
    },
    findSessionGlobally: (sessionId: string) => undefined,
    promptSession: async (
      sessionId: string,
      text: string,
      _context?: unknown,
      agentId?: string
    ) => {
      if (agentId) {
        return mock.prompt(agentId, sessionId, text);
      }
      throw new Error(`Session ${sessionId} not found`);
    },
    cancelSession: async () => {},
    appendMessageToSession: () => {},
    getAllSessionsFlat: () => [],
    dispose: () => {},
  }) as any;

  (mock as any)._activeSessions = {};
  (mock as any)._promptCalls = [];
  (mock as any)._lastPrompt = null;

  return mock;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeTeamConfig(
  overrides: Partial<{
    id: string;
    name: string;
    leadAgentId: string;
    memberAgentIds: string[];
  }> = {}
) {
  return {
    id: "team-1",
    name: "Test Team",
    description: "A test team",
    leadAgentId: "agent-lead",
    memberAgentIds: ["agent-a", "agent-b"],
    ...overrides,
  };
}

describe("MeshOrchestrator", () => {
  let mockSO: SessionOrchestrator & EventEmitter;
  let bus: MessageBus;
  let flm: FileLockManager;
  let tbs: TaskBoardStore;
  let orch: MeshOrchestrator;

  beforeEach(() => {
    mockSO = createMockSessionOrchestrator();
    bus = new MessageBus();
    flm = new FileLockManager();
    tbs = new TaskBoardStore();
    orch = new MeshOrchestrator({
      sessionOrchestrator: mockSO,
      messageBus: bus,
      fileLockManager: flm,
      taskBoardStore: tbs,
    });
  });

  afterEach(() => {
    orch.dispose();
    bus.dispose();
    flm.dispose();
    tbs.dispose();
  });

  // -----------------------------------------------------------------------
  // Team Lifecycle
  // -----------------------------------------------------------------------

  describe("startTeam / stopTeam", () => {
    it("should create a team and task board", async () => {
      const team = await orch.startTeam(makeTeamConfig());

      assert.strictEqual(team.id, "team-1");
      assert.strictEqual(team.name, "Test Team");
      assert.strictEqual(team.status, "active");
      assert.strictEqual(team.memberAgentIds.length, 2);
    });

    it("should register team members on message bus", async () => {
      await orch.startTeam(makeTeamConfig());

      // Sending a message to a member should work (no throw)
      await bus.send({
        id: "test-1",
        type: "ping",
        from: "agent-lead",
        to: "agent-a",
        timestamp: new Date(),
        payload: {},
      });
    });

    it("should stop team and release resources", async () => {
      const team = await orch.startTeam(makeTeamConfig());

      // Acquire a lock for a member
      await flm.acquire("src/foo.ts", "agent-a");

      await orch.stopTeam(team.id);

      // Lock should be released
      assert.strictEqual(flm.isLocked("src/foo.ts"), false);
    });

    it("should mark team as completed on stop", async () => {
      const team = await orch.startTeam(makeTeamConfig());
      await orch.stopTeam(team.id);

      const stopped = orch.getTeam(team.id);
      assert.strictEqual(stopped?.status, "completed");
    });

    it("should return undefined for unknown team", () => {
      assert.strictEqual(orch.getTeam("nonexistent"), undefined);
    });

    it("getAllTeams should return all started teams", async () => {
      await orch.startTeam(makeTeamConfig({ id: "team-1" }));
      await orch.startTeam(makeTeamConfig({ id: "team-2", name: "Team 2" }));

      const teams = orch.getAllTeams();
      assert.strictEqual(teams.length, 2);
    });
  });

  // -----------------------------------------------------------------------
  // Message Forwarding
  // -----------------------------------------------------------------------

  describe("message forwarding", () => {
    it("should forward P2P messages to agent session via prompt", async () => {
      await orch.startTeam(makeTeamConfig());

      // Set up active session for agent-a
      (mockSO as any)._activeSessions["agent-a"] = "session-1";

      await bus.send({
        id: "fwd-1",
        type: "question",
        from: "agent-lead",
        to: "agent-a",
        timestamp: new Date(),
        payload: { question: "hello from lead" },
      });

      // prompt should have been called with v2 marker-wrapped message
      const calls = (mockSO as any)._promptCalls as Array<{
        agentId: string;
        sessionId: string;
        text: string;
      }>;
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].agentId, "agent-a");
      assert.strictEqual(calls[0].sessionId, "session-1");
      assert.ok(calls[0].text.includes(MESH_MARKER_V2_OPEN));
      assert.ok(calls[0].text.includes(MESH_MARKER_CLOSE));
      assert.ok(calls[0].text.includes('"from":"agent-lead"'));
    });

    it("should not forward when agent has no active session", async () => {
      await orch.startTeam(makeTeamConfig());
      // No active session set for agent-a

      await bus.send({
        id: "fwd-2",
        type: "question",
        from: "agent-lead",
        to: "agent-a",
        timestamp: new Date(),
        payload: { question: "hello" },
      });

      const calls = (mockSO as any)._promptCalls;
      assert.strictEqual(calls.length, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Agent Output Processing
  // -----------------------------------------------------------------------

  describe("processAgentOutput", () => {
    it("should extract P2P messages and route via bus", async () => {
      await orch.startTeam(makeTeamConfig());

      const marker = `${MESH_MARKER_OPEN}{"version":"1.0","type":"status_update","id":"s1","to":"agent-lead","payload":{"agentId":"agent-a","status":"idle"}}${MESH_MARKER_CLOSE}`;
      const rawOutput = `Thinking...\n${marker}\nDone.`;

      const sanitized = await orch.processAgentOutput("agent-a", rawOutput);

      assert.ok(!sanitized.includes(MESH_MARKER_OPEN));
      assert.ok(sanitized.includes("Thinking..."));
      assert.ok(sanitized.includes("Done."));

      // Message should be in bus log
      const log = bus.getLog();
      assert.strictEqual(log.length, 1);
      assert.strictEqual(log[0].type, "status_update");
    });

    it("should return sanitized output when no markers", async () => {
      const result = await orch.processAgentOutput("agent-a", "plain text");
      assert.strictEqual(result, "plain text");
    });
  });

  // -----------------------------------------------------------------------
  // Task Board Operations
  // -----------------------------------------------------------------------

  describe("task board operations", () => {
    beforeEach(async () => {
      await orch.startTeam(makeTeamConfig());
    });

    it("should add a task", () => {
      const task = orch.addTask("team-1", {
        id: "task-1",
        title: "Implement feature",
        description: "Build the thing",
        status: "pending",
        createdBy: "agent-lead",
        dependsOn: [],
        subtasks: [],
      });

      assert.strictEqual(task.id, "task-1");
      assert.strictEqual(task.title, "Implement feature");
    });

    it("should get a task", () => {
      orch.addTask("team-1", {
        id: "task-1",
        title: "Test",
        description: "desc",
        status: "pending",
        createdBy: "agent-lead",
        dependsOn: [],
        subtasks: [],
      });

      const task = orch.getTask("team-1", "task-1");
      assert.ok(task);
      assert.strictEqual(task.title, "Test");
    });

    it("should update a task", () => {
      orch.addTask("team-1", {
        id: "task-1",
        title: "Test",
        description: "desc",
        status: "pending",
        createdBy: "agent-lead",
        dependsOn: [],
        subtasks: [],
      });

      const updated = orch.updateTask("team-1", "task-1", {
        status: "in_progress",
        assignedTo: "agent-a",
      });

      assert.ok(updated);
      assert.strictEqual(updated.status, "in_progress");
      assert.strictEqual(updated.assignedTo, "agent-a");
    });

    it("should return undefined for unknown team", () => {
      assert.strictEqual(orch.getTask("nonexistent", "task-1"), undefined);
      assert.strictEqual(
        orch.updateTask("nonexistent", "task-1", {}),
        undefined
      );
      assert.strictEqual(orch.getTaskBoard("nonexistent"), undefined);
    });

    it("should get task board", () => {
      const board = orch.getTaskBoard("team-1");
      assert.ok(board);
      assert.strictEqual(board.version, "1.0");
    });

    it("should detect cycles", async () => {
      // Create a fresh team for cycle testing
      const orch2 = new MeshOrchestrator({
        sessionOrchestrator: createMockSessionOrchestrator(),
        messageBus: new MessageBus(),
        fileLockManager: new FileLockManager(),
        taskBoardStore: new TaskBoardStore(),
      });

      await orch2.startTeam({
        id: "cycle-team",
        name: "Cycle Team",
        description: "",
        leadAgentId: "lead",
        memberAgentIds: ["a"],
      });

      orch2.addTask("cycle-team", {
        id: "t1",
        title: "T1",
        description: "",
        status: "pending",
        createdBy: "lead",
        dependsOn: ["t2"],
        subtasks: [],
      });
      orch2.addTask("cycle-team", {
        id: "t2",
        title: "T2",
        description: "",
        status: "pending",
        createdBy: "lead",
        dependsOn: ["t1"],
        subtasks: [],
      });

      const cycles = orch2.getCycles("cycle-team");
      assert.ok(cycles.length > 0);

      orch2.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Error Handling & Recovery
  // -----------------------------------------------------------------------

  describe("handleAgentDisconnect", () => {
    it("should reassign orphaned tasks and release locks", async () => {
      await orch.startTeam(makeTeamConfig());

      // Add a task assigned to agent-a
      orch.addTask("team-1", {
        id: "task-1",
        title: "Orphan task",
        description: "Will be orphaned",
        status: "in_progress",
        createdBy: "agent-lead",
        assignedTo: "agent-a",
        dependsOn: [],
        subtasks: [],
      });

      // Acquire a file lock for agent-a
      await flm.acquire("src/foo.ts", "agent-a");

      // Simulate disconnect
      await orch.handleAgentDisconnect("agent-a");

      // Task should be reset to pending
      const task = orch.getTask("team-1", "task-1");
      assert.ok(task);
      assert.strictEqual(task.status, "pending");
      assert.strictEqual(task.assignedTo, undefined);

      // Lock should be released
      assert.strictEqual(flm.isLocked("src/foo.ts"), false);
    });

    it("should send status_update to lead agent", async () => {
      await orch.startTeam(makeTeamConfig());

      orch.addTask("team-1", {
        id: "task-1",
        title: "Task",
        description: "desc",
        status: "assigned",
        createdBy: "agent-lead",
        assignedTo: "agent-a",
        dependsOn: [],
        subtasks: [],
      });

      // Subscribe lead to bus to capture notification
      const leadMessages: P2PMessage[] = [];
      bus.subscribe("agent-lead", async (msg) => {
        leadMessages.push(msg);
      });

      await orch.handleAgentDisconnect("agent-a");

      assert.strictEqual(leadMessages.length, 1);
      assert.strictEqual(leadMessages[0].type, "status_update");
      assert.strictEqual(leadMessages[0].to, "agent-lead");
    });
  });

  // -----------------------------------------------------------------------
  // Direct Messaging (MCP tools)
  // -----------------------------------------------------------------------

  describe("handoff / sendMessage", () => {
    beforeEach(async () => {
      await orch.startTeam(makeTeamConfig());
    });

    it("should send a task_request via handoff", async () => {
      const received: P2PMessage[] = [];
      bus.subscribe("agent-b", async (msg) => {
        received.push(msg);
      });

      await orch.handoff("agent-a", "agent-b", "Do this thing", "Some context");

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].type, "task_request");
      assert.strictEqual(received[0].from, "agent-a");
      assert.strictEqual(received[0].to, "agent-b");
      const payload = received[0].payload as {
        title: string;
        description: string;
      };
      assert.strictEqual(payload.title, "Do this thing");
      assert.ok(payload.description.includes("Some context"));
    });

    it("should send a question via sendMessage", async () => {
      const received: P2PMessage[] = [];
      bus.subscribe("agent-b", async (msg) => {
        received.push(msg);
      });

      await orch.sendMessage(
        "agent-a",
        "agent-b",
        "What do you think?",
        "high"
      );

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].type, "question");
      const payload = received[0].payload as { question: string };
      assert.strictEqual(payload.question, "What do you think?");
      assert.strictEqual(received[0].metadata?.priority, "high");
    });
  });

  // -----------------------------------------------------------------------
  // createError
  // -----------------------------------------------------------------------

  describe("createError", () => {
    it("should create a MeshError with correct fields", () => {
      const error = orch.createError(
        "agent_disconnected",
        "Agent went away",
        "agent-a",
        "msg-1"
      );

      assert.strictEqual(error.type, "agent_disconnected");
      assert.strictEqual(error.description, "Agent went away");
      assert.strictEqual(error.agentId, "agent-a");
      assert.strictEqual(error.messageId, "msg-1");
      assert.ok(error.timestamp);
    });
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe("dispose", () => {
    it("should clean up all subscriptions and teams", async () => {
      await orch.startTeam(makeTeamConfig({ id: "team-1" }));
      await orch.startTeam(makeTeamConfig({ id: "team-2" }));

      orch.dispose();

      assert.strictEqual(orch.getAllTeams().length, 0);
    });
  });
});
