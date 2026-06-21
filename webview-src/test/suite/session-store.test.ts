import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import {
  useSessionStore,
  sessionKeyOf,
  selectTabs,
  selectOverviewItems,
  selectOverviewItemsMap,
  type SessionInfoDTO,
  type SessionTabState,
  type ConnectedAgentInfo,
  type WorkspaceFolder,
  type AgentInfo,
} from "../../store/sessionStore";
import type { QueuedPrompt, Plan } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSessionInfo(
  agentId: string,
  sessionId: string,
  overrides: Partial<SessionInfoDTO> = {}
): SessionInfoDTO {
  return {
    sessionId,
    agentId,
    status: "idle",
    lastTurnOutcome: null,
    isStreaming: false,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    createdAt: new Date().toISOString(),
    lastResponseAt: null,
    ...overrides,
  };
}

function makeQueuedPrompt(
  id: string,
  status: QueuedPrompt["status"] = "pending"
): QueuedPrompt {
  return {
    id,
    agentId: "agent1",
    sessionId: "session1",
    text: `prompt-${id}`,
    enqueuedAt: new Date().toISOString(),
    status,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    agentId: "agent1",
    sessionId: "session1",
    steps: [
      { id: "step1", index: 0, description: "Step 1", status: "pending" },
      { id: "step2", index: 1, description: "Step 2", status: "pending" },
    ],
    status: "pending",
    ...overrides,
  };
}

// ── Store reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  useSessionStore.setState({
    sessionInfoMap: {},
    tabOrder: [],
    activeSessionKey: null,
    tabTitles: {},
    tabIcons: {},
    pinnedSessionKeys: [],

    promptQueue: {},
    connectedAgents: [],
    agentInfoMap: {},
    workspaceFolders: [],
    sessionCommands: {},
    statusline: {},
    workspaceRoot: undefined,
    currentPlan: null,
    planHistory: [],
    commandCenterExpanded: false,
    commandCenterSelectedKey: null,
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sessionStore", () => {
  // ── 1. Tab management ─────────────────────────────────────────────────

  describe("tab management", () => {
    it("addTab appends key to tabOrder and sets activeSessionKey", () => {
      const { addTab } = useSessionStore.getState();
      addTab("agent1", "session1");
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.tabOrder, ["agent1:session1"]);
      assert.strictEqual(state.activeSessionKey, "agent1:session1");
    });

    it("addTab does not duplicate if key already exists", () => {
      const { addTab } = useSessionStore.getState();
      addTab("agent1", "session1");
      addTab("agent1", "session1");
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.tabOrder, ["agent1:session1"]);
    });

    it("addTab with title sets tabTitles", () => {
      const { addTab } = useSessionStore.getState();
      addTab("agent1", "session1", "My Session");
      const state = useSessionStore.getState();
      assert.strictEqual(state.tabTitles["agent1:session1"], "My Session");
    });

    it("removeTab removes from tabOrder, sessionInfoMap, promptQueue, and adjusts activeSessionKey", () => {
      const { addTab, setSessionInfo, setPromptQueue, removeTab } =
        useSessionStore.getState();
      addTab("agent1", "session1");
      addTab("agent1", "session2");
      setSessionInfo(
        "agent1",
        "session1",
        makeSessionInfo("agent1", "session1")
      );
      setSessionInfo(
        "agent1",
        "session2",
        makeSessionInfo("agent1", "session2")
      );
      setPromptQueue("agent1:session1", [makeQueuedPrompt("q1")]);
      removeTab("agent1:session1");
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.tabOrder, ["agent1:session2"]);
      assert.strictEqual(state.activeSessionKey, "agent1:session2");
      assert.strictEqual(state.sessionInfoMap["agent1:session1"], undefined);
      assert.strictEqual(state.promptQueue["agent1:session1"], undefined);
    });

    it("removeTab does nothing if key not in tabOrder", () => {
      const { addTab, removeTab } = useSessionStore.getState();
      addTab("agent1", "session1");
      removeTab("agent1:nonexistent");
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.tabOrder, ["agent1:session1"]);
    });

    it("removeTab sets activeSessionKey to null when last tab removed", () => {
      const { addTab, removeTab } = useSessionStore.getState();
      addTab("agent1", "session1");
      removeTab("agent1:session1");
      const state = useSessionStore.getState();
      assert.strictEqual(state.activeSessionKey, null);
    });

    it("setTabOrder replaces the order", () => {
      const { setTabOrder } = useSessionStore.getState();
      setTabOrder(["a:1", "b:2", "c:3"]);
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.tabOrder, ["a:1", "b:2", "c:3"]);
    });

    it("setActiveSession changes the active key", () => {
      const { setActiveSession } = useSessionStore.getState();
      setActiveSession("agent1:session1");
      const state = useSessionStore.getState();
      assert.strictEqual(state.activeSessionKey, "agent1:session1");
    });

    it("setTabTitle updates metadata", () => {
      const { setTabTitle } = useSessionStore.getState();
      setTabTitle("agent1:session1", "New Title");
      const state = useSessionStore.getState();
      assert.strictEqual(state.tabTitles["agent1:session1"], "New Title");
    });

    it("setTabIcon updates metadata", () => {
      const { setTabIcon } = useSessionStore.getState();
      setTabIcon("agent1:session1", "icon-path");
      const state = useSessionStore.getState();
      assert.strictEqual(state.tabIcons["agent1:session1"], "icon-path");
    });

    it("setTabTitle is idempotent (same value → no state change)", () => {
      const { setTabTitle } = useSessionStore.getState();
      setTabTitle("agent1:session1", "Title");
      const ref = useSessionStore.getState();
      setTabTitle("agent1:session1", "Title");
      assert.strictEqual(useSessionStore.getState(), ref);
    });
  });

  // ── 2. Session info ───────────────────────────────────────────────────

  describe("session info", () => {
    it("setSessionInfo stores DTO under agentId:sessionId key", () => {
      const { setSessionInfo } = useSessionStore.getState();
      const info = makeSessionInfo("agent1", "session1");
      setSessionInfo("agent1", "session1", info);
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.sessionInfoMap["agent1:session1"], info);
    });

    it("setSessionInfoMap bulk-sets and dedupes via referential equality", () => {
      const { setSessionInfoMap } = useSessionStore.getState();
      const info1 = makeSessionInfo("agent1", "session1");
      const info2 = makeSessionInfo("agent1", "session2");
      setSessionInfoMap({
        "agent1:session1": info1,
        "agent1:session2": info2,
      });
      const state = useSessionStore.getState();
      assert.strictEqual(Object.keys(state.sessionInfoMap).length, 2);
    });

    it("setSessionInfoMap auto-adds new keys to tabOrder while preserving existing order", () => {
      const { setSessionInfoMap, setTabOrder } = useSessionStore.getState();
      setTabOrder(["agent1:session1"]);
      const info1 = makeSessionInfo("agent1", "session1");
      const info2 = makeSessionInfo("agent1", "session2");
      setSessionInfoMap({
        "agent1:session1": info1,
        "agent1:session2": info2,
      });
      const state = useSessionStore.getState();
      assert.ok(state.tabOrder.includes("agent1:session1"));
      assert.ok(state.tabOrder.includes("agent1:session2"));
      // Existing key should come first
      assert.strictEqual(state.tabOrder.indexOf("agent1:session1"), 0);
    });

    it("setSessionInfo with same reference does not trigger change", () => {
      const { setSessionInfo } = useSessionStore.getState();
      const info = makeSessionInfo("agent1", "session1");
      setSessionInfo("agent1", "session1", info);
      const ref = useSessionStore.getState();
      setSessionInfo("agent1", "session1", info);
      assert.strictEqual(useSessionStore.getState(), ref);
    });
  });

  // ── 3. Unified mode state ─────────────────────────────────────────────

  describe("unified mode state", () => {
    it("pinSession adds to pinnedSessionKeys", () => {
      const { pinSession } = useSessionStore.getState();
      pinSession("agent1:session1");
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.pinnedSessionKeys, ["agent1:session1"]);
    });

    it("pinSession with multiple keys", () => {
      const { pinSession } = useSessionStore.getState();
      pinSession("agent1:session1");
      pinSession("agent1:session2");
      pinSession("agent1:session3");
      const state = useSessionStore.getState();
      assert.strictEqual(state.pinnedSessionKeys.length, 3);
    });

    it("unpinSession removes from pinnedSessionKeys", () => {
      const { pinSession, unpinSession } = useSessionStore.getState();
      pinSession("agent1:session1");
      pinSession("agent1:session2");
      unpinSession("agent1:session1");
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.pinnedSessionKeys, ["agent1:session2"]);
    });

    it("togglePin adds pin when not pinned", () => {
      const { togglePin } = useSessionStore.getState();
      togglePin("agent1:session1");
      const state = useSessionStore.getState();
      assert.ok(state.pinnedSessionKeys.includes("agent1:session1"));
    });

    it("togglePin removes pin when already pinned", () => {
      const { pinSession, togglePin } = useSessionStore.getState();
      pinSession("agent1:session1");
      togglePin("agent1:session1");
      const state = useSessionStore.getState();
      assert.ok(!state.pinnedSessionKeys.includes("agent1:session1"));
    });
  });

  // ── 4. Prompt queue ───────────────────────────────────────────────────

  describe("prompt queue", () => {
    it("addQueuedPrompt appends to queue for a session key", () => {
      const { addQueuedPrompt } = useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1"));
      const state = useSessionStore.getState();
      assert.strictEqual(state.promptQueue["agent1:session1"].length, 1);
      assert.strictEqual(state.promptQueue["agent1:session1"][0].id, "q1");
    });

    it("addQueuedPrompt creates new queue array if none exists", () => {
      const { addQueuedPrompt } = useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1"));
      const state = useSessionStore.getState();
      assert.ok(Array.isArray(state.promptQueue["agent1:session1"]));
    });

    it("removeQueuedPrompt removes by ID", () => {
      const { addQueuedPrompt, removeQueuedPrompt } =
        useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1"));
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q2"));
      removeQueuedPrompt("agent1:session1", "q1");
      const state = useSessionStore.getState();
      assert.strictEqual(state.promptQueue["agent1:session1"].length, 1);
      assert.strictEqual(state.promptQueue["agent1:session1"][0].id, "q2");
    });

    it("removeQueuedPrompt does nothing if ID not found", () => {
      const { addQueuedPrompt, removeQueuedPrompt } =
        useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1"));
      const ref = useSessionStore.getState();
      removeQueuedPrompt("agent1:session1", "nonexistent");
      assert.strictEqual(useSessionStore.getState(), ref);
    });

    it("reorderQueuedPrompts reorders only pending items, keeps sending items at end", () => {
      const { addQueuedPrompt, reorderQueuedPrompts } =
        useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1", "pending"));
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q2", "pending"));
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q3", "sending"));
      reorderQueuedPrompts("agent1:session1", ["q2", "q1"]);
      const state = useSessionStore.getState();
      const queue = state.promptQueue["agent1:session1"];
      // q2 should be first (pending, reordered)
      assert.strictEqual(queue[0].id, "q2");
      // q1 should be second (pending, reordered)
      assert.strictEqual(queue[1].id, "q1");
      // q3 should be last (sending, kept at end)
      assert.strictEqual(queue[2].id, "q3");
    });

    it("updateQueuedPromptStatus changes status of a specific entry", () => {
      const { addQueuedPrompt, updateQueuedPromptStatus } =
        useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1", "pending"));
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q2", "pending"));
      updateQueuedPromptStatus("agent1:session1", "q1", "sending");
      const state = useSessionStore.getState();
      const queue = state.promptQueue["agent1:session1"];
      assert.strictEqual(queue[0].status, "sending");
      assert.strictEqual(queue[1].status, "pending");
    });

    it("updateQueuedPromptStatus does nothing if promptId not found", () => {
      const { addQueuedPrompt, updateQueuedPromptStatus } =
        useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1", "pending"));
      const ref = useSessionStore.getState();
      updateQueuedPromptStatus("agent1:session1", "nonexistent", "sending");
      assert.strictEqual(useSessionStore.getState(), ref);
    });

    it("updateQueuedPromptStatus does nothing if session key has no queue", () => {
      const { updateQueuedPromptStatus } = useSessionStore.getState();
      const ref = useSessionStore.getState();
      updateQueuedPromptStatus("agent1:session1", "q1", "sending");
      assert.strictEqual(useSessionStore.getState(), ref);
    });

    it("clearQueue removes the entire queue for a session key", () => {
      const { addQueuedPrompt, clearQueue } = useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1"));
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q2"));
      clearQueue("agent1:session1");
      const state = useSessionStore.getState();
      assert.strictEqual(state.promptQueue["agent1:session1"], undefined);
    });

    it("clearQueue does nothing if session key has no queue", () => {
      const { clearQueue } = useSessionStore.getState();
      const ref = useSessionStore.getState();
      clearQueue("agent1:session1");
      assert.strictEqual(useSessionStore.getState(), ref);
    });

    it("setPromptQueue replaces the entire queue for a session key", () => {
      const { setPromptQueue, addQueuedPrompt } = useSessionStore.getState();
      addQueuedPrompt("agent1:session1", makeQueuedPrompt("q1"));
      const newQueue = [makeQueuedPrompt("q2"), makeQueuedPrompt("q3")];
      setPromptQueue("agent1:session1", newQueue);
      const state = useSessionStore.getState();
      assert.strictEqual(state.promptQueue["agent1:session1"].length, 2);
      assert.strictEqual(state.promptQueue["agent1:session1"][0].id, "q2");
      assert.strictEqual(state.promptQueue["agent1:session1"][1].id, "q3");
    });
  });

  // ── 5. Bulk operations ────────────────────────────────────────────────

  describe("bulk operations", () => {
    it("bulkSetTabs sets tabOrder and titles from SessionTabState array", () => {
      const { bulkSetTabs } = useSessionStore.getState();
      const tabs: SessionTabState[] = [
        { sessionId: "session1", agentId: "agent1", title: "Tab 1" },
        { sessionId: "session2", agentId: "agent1", title: "Tab 2" },
      ];
      bulkSetTabs({ tabs });
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.tabOrder, [
        "agent1:session1",
        "agent1:session2",
      ]);
      assert.strictEqual(state.tabTitles["agent1:session1"], "Tab 1");
      assert.strictEqual(state.tabTitles["agent1:session2"], "Tab 2");
    });

    it("bulkSetTabs with same data is a no-op", () => {
      const { bulkSetTabs } = useSessionStore.getState();
      const tabs: SessionTabState[] = [
        { sessionId: "session1", agentId: "agent1", title: "Tab 1" },
      ];
      bulkSetTabs({ tabs });
      const ref = useSessionStore.getState();
      bulkSetTabs({ tabs });
      assert.strictEqual(useSessionStore.getState(), ref);
    });

    it("bulkSetTabs can optionally set workspaceRoot", () => {
      const { bulkSetTabs } = useSessionStore.getState();
      bulkSetTabs({
        tabs: [{ sessionId: "session1", agentId: "agent1", title: "Tab 1" }],
        workspaceRoot: "/workspace",
      });
      const state = useSessionStore.getState();
      assert.strictEqual(state.workspaceRoot, "/workspace");
    });

    it("bulkSetTabs can optionally set connectedAgents", () => {
      const { bulkSetTabs } = useSessionStore.getState();
      const agents: ConnectedAgentInfo[] = [
        { agentId: "agent1", name: "Agent 1" },
      ];
      bulkSetTabs({
        tabs: [{ sessionId: "session1", agentId: "agent1", title: "Tab 1" }],
        connectedAgents: agents,
      });
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.connectedAgents, agents);
    });

    it("bulkSetTabs can optionally set agentInfoMap", () => {
      const { bulkSetTabs } = useSessionStore.getState();
      const agentInfoMap: Record<string, AgentInfo> = {
        agent1: { name: "Agent 1", title: "Test Agent" },
      };
      bulkSetTabs({
        tabs: [{ sessionId: "session1", agentId: "agent1", title: "Tab 1" }],
        agentInfoMap,
      });
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.agentInfoMap, agentInfoMap);
    });

    it("bulkSetTabs can optionally set sessionInfoMap", () => {
      const { bulkSetTabs } = useSessionStore.getState();
      const sessionInfoMap: Record<string, SessionInfoDTO> = {
        "agent1:session1": makeSessionInfo("agent1", "session1"),
      };
      bulkSetTabs({
        tabs: [{ sessionId: "session1", agentId: "agent1", title: "Tab 1" }],
        sessionInfoMap,
      });
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.sessionInfoMap, sessionInfoMap);
    });
  });

  // ── 6. Selectors ──────────────────────────────────────────────────────

  describe("selectors", () => {
    it("selectTabs returns correct SessionTabState[] from tabOrder + tabTitles", () => {
      useSessionStore.setState({
        tabOrder: ["agent1:session1", "agent2:session2"],
        tabTitles: {
          "agent1:session1": "Title 1",
          "agent2:session2": "Title 2",
        },
      });
      const tabs = selectTabs(useSessionStore.getState());
      assert.strictEqual(tabs.length, 2);
      assert.strictEqual(tabs[0].agentId, "agent1");
      assert.strictEqual(tabs[0].sessionId, "session1");
      assert.strictEqual(tabs[0].title, "Title 1");
      assert.strictEqual(tabs[1].agentId, "agent2");
      assert.strictEqual(tabs[1].sessionId, "session2");
      assert.strictEqual(tabs[1].title, "Title 2");
    });

    it("selectTabs parses agentId and sessionId from colon-separated keys", () => {
      useSessionStore.setState({
        tabOrder: ["my-agent:my-session"],
        tabTitles: {},
      });
      const tabs = selectTabs(useSessionStore.getState());
      assert.strictEqual(tabs[0].agentId, "my-agent");
      assert.strictEqual(tabs[0].sessionId, "my-session");
    });

    it("selectTabs falls back to sessionId when title not set", () => {
      useSessionStore.setState({
        tabOrder: ["agent1:session1"],
        tabTitles: {},
      });
      const tabs = selectTabs(useSessionStore.getState());
      assert.strictEqual(tabs[0].title, "session1");
    });

    it("selectOverviewItems derives overview items from sessionInfoMap + tabTitles", () => {
      const info = makeSessionInfo("agent1", "session1", {
        status: "running",
        model: "claude-3",
      });
      useSessionStore.setState({
        tabOrder: ["agent1:session1"],
        sessionInfoMap: { "agent1:session1": info },
        tabTitles: { "agent1:session1": "Overview Test" },
      });
      const items = selectOverviewItems(useSessionStore.getState());
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].sessionId, "session1");
      assert.strictEqual(items[0].agentId, "agent1");
      assert.strictEqual(items[0].title, "Overview Test");
      assert.strictEqual(items[0].status, "running");
      assert.strictEqual(items[0].model, "claude-3");
    });

    it("selectOverviewItemsMap returns Record keyed by 'agentId:sessionId'", () => {
      const info = makeSessionInfo("agent1", "session1");
      useSessionStore.setState({
        tabOrder: ["agent1:session1"],
        sessionInfoMap: { "agent1:session1": info },
        tabTitles: {},
      });
      const map = selectOverviewItemsMap(useSessionStore.getState());
      assert.ok("agent1:session1" in map);
      assert.strictEqual(map["agent1:session1"].sessionId, "session1");
    });

    it("sessionKeyOf correctly joins agentId and sessionId", () => {
      assert.strictEqual(sessionKeyOf("agent1", "session1"), "agent1:session1");
      assert.strictEqual(sessionKeyOf("a", "b"), "a:b");
    });
  });

  // ── 7. Connected agents / workspace ───────────────────────────────────

  describe("connected agents / workspace", () => {
    it("setConnectedAgents updates the list", () => {
      const { setConnectedAgents } = useSessionStore.getState();
      const agents: ConnectedAgentInfo[] = [
        { agentId: "agent1", name: "Agent 1" },
        { agentId: "agent2", name: "Agent 2" },
      ];
      setConnectedAgents(agents);
      const state = useSessionStore.getState();
      assert.strictEqual(state.connectedAgents.length, 2);
    });

    it("setWorkspaceRoot updates root", () => {
      const { setWorkspaceRoot } = useSessionStore.getState();
      setWorkspaceRoot("/path/to/workspace");
      const state = useSessionStore.getState();
      assert.strictEqual(state.workspaceRoot, "/path/to/workspace");
    });

    it("setWorkspaceFolders updates folders", () => {
      const { setWorkspaceFolders } = useSessionStore.getState();
      const folders: WorkspaceFolder[] = [
        { name: "project1", uri: "file:///path/to/project1" },
        { name: "project2", uri: "file:///path/to/project2" },
      ];
      setWorkspaceFolders(folders);
      const state = useSessionStore.getState();
      assert.strictEqual(state.workspaceFolders.length, 2);
    });

    it("setAgentInfo updates per-agent info", () => {
      const { setAgentInfo } = useSessionStore.getState();
      const info: AgentInfo = { name: "Agent 1", version: "1.0.0" };
      setAgentInfo("agent1", info);
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.agentInfoMap["agent1"], info);
    });
  });

  // ── 8. Plan state ─────────────────────────────────────────────────────

  describe("plan state", () => {
    it("setCurrentPlan sets current plan", () => {
      const { setCurrentPlan } = useSessionStore.getState();
      const plan = makePlan();
      setCurrentPlan(plan);
      const state = useSessionStore.getState();
      assert.deepStrictEqual(state.currentPlan, plan);
    });

    it("updatePlanStep updates a specific step", () => {
      const { setCurrentPlan, updatePlanStep } = useSessionStore.getState();
      const plan = makePlan();
      setCurrentPlan(plan);
      updatePlanStep("step1", { status: "completed" });
      const state = useSessionStore.getState();
      assert.strictEqual(state.currentPlan!.steps[0].status, "completed");
      assert.strictEqual(state.currentPlan!.steps[1].status, "pending");
    });

    it("approvePlan sets plan status to 'approved' and adds to planHistory", () => {
      const { setCurrentPlan, approvePlan } = useSessionStore.getState();
      const plan = makePlan();
      setCurrentPlan(plan);
      approvePlan();
      const state = useSessionStore.getState();
      assert.strictEqual(state.currentPlan!.status, "approved");
      assert.strictEqual(state.planHistory.length, 1);
      assert.strictEqual(state.planHistory[0].status, "approved");
    });

    it("rejectPlan sets currentPlan to null and adds to planHistory", () => {
      const { setCurrentPlan, rejectPlan } = useSessionStore.getState();
      const plan = makePlan();
      setCurrentPlan(plan);
      rejectPlan();
      const state = useSessionStore.getState();
      assert.strictEqual(state.currentPlan, null);
      assert.strictEqual(state.planHistory.length, 1);
      assert.strictEqual(state.planHistory[0].status, "rejected");
    });
  });

  // ── 9. Command Center ─────────────────────────────────────────────────

  describe("command center", () => {
    it("toggleCommandCenter toggles expanded state", () => {
      const { toggleCommandCenter } = useSessionStore.getState();
      assert.strictEqual(
        useSessionStore.getState().commandCenterExpanded,
        false
      );
      toggleCommandCenter();
      assert.strictEqual(
        useSessionStore.getState().commandCenterExpanded,
        true
      );
      toggleCommandCenter();
      assert.strictEqual(
        useSessionStore.getState().commandCenterExpanded,
        false
      );
    });

    it("setCommandCenterExpanded sets expanded state", () => {
      const { setCommandCenterExpanded } = useSessionStore.getState();
      setCommandCenterExpanded(true);
      assert.strictEqual(
        useSessionStore.getState().commandCenterExpanded,
        true
      );
      setCommandCenterExpanded(false);
      assert.strictEqual(
        useSessionStore.getState().commandCenterExpanded,
        false
      );
    });

    it("setCommandCenterSelectedKey sets selected key", () => {
      const { setCommandCenterSelectedKey } = useSessionStore.getState();
      setCommandCenterSelectedKey("agent1:session1");
      const state = useSessionStore.getState();
      assert.strictEqual(state.commandCenterSelectedKey, "agent1:session1");
    });
  });
});
