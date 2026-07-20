import * as assert from "assert";
import { describe, it, beforeEach } from "mocha";
import {
  useSessionStore,
  sessionKeyOf,
} from "../../store/sessionStore";
import type { SessionInfoDTO } from "../../store/sessionStore";
import {
  handleSessionTurnActive,
  handleSessionTurnEnded,
} from "../../messageRouter/handlers/session/turn";
import { useMessageStore } from "../../store/messageStore";

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

  useMessageStore.setState({
    perSession: {},
    streaming: {},
    promptQueue: {},
    lastSessionUpdateType: {},
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("handleSessionTurnActive", () => {
  it("sets isStreaming=true and status=running on active:true", () => {
    const { setSessionInfo } = useSessionStore.getState();
    setSessionInfo(
      "agent1",
      "session1",
      makeSessionInfo("agent1", "session1", { status: "idle" })
    );

    handleSessionTurnActive({
      type: "session/turnActive",
      agentId: "agent1",
      sessionId: "session1",
      active: true,
    });

    const msgKey = sessionKeyOf("agent1", "session1");
    const streaming = useMessageStore.getState().streaming[msgKey];
    assert.strictEqual(streaming, true, "streaming must be true after active:true");

    const info = useSessionStore.getState().sessionInfoMap[msgKey];
    assert.ok(info, "session info must exist");
    assert.strictEqual(info.status, "running", "status must be running after active:true");
    assert.strictEqual(info.isStreaming, true, "isStreaming must be true after active:true");
  });

  it("sets isStreaming=false and status=idle on active:false", () => {
    const { setSessionInfo } = useSessionStore.getState();
    const msgKey = sessionKeyOf("agent1", "session1");
    setSessionInfo(
      "agent1",
      "session1",
      makeSessionInfo("agent1", "session1", { status: "running", isStreaming: true })
    );
    useMessageStore.getState().setStreaming(msgKey, true);

    handleSessionTurnActive({
      type: "session/turnActive",
      agentId: "agent1",
      sessionId: "session1",
      active: false,
    });

    const streaming = useMessageStore.getState().streaming[msgKey];
    assert.strictEqual(streaming, false, "streaming must be false after active:false");

    const info = useSessionStore.getState().sessionInfoMap[msgKey];
    assert.ok(info, "session info must exist");
    assert.strictEqual(info.status, "idle", "status must be idle after active:false");
    assert.strictEqual(info.isStreaming, false, "isStreaming must be false after active:false");
  });

  it("preserves cancelling status on active:false", () => {
    const { setSessionInfo } = useSessionStore.getState();
    const msgKey = sessionKeyOf("agent1", "session1");
    setSessionInfo(
      "agent1",
      "session1",
      makeSessionInfo("agent1", "session1", { status: "cancelling", isStreaming: true })
    );
    useMessageStore.getState().setStreaming(msgKey, true);

    handleSessionTurnActive({
      type: "session/turnActive",
      agentId: "agent1",
      sessionId: "session1",
      active: false,
    });

    const info = useSessionStore.getState().sessionInfoMap[msgKey];
    assert.ok(info, "session info must exist");
    assert.strictEqual(info.status, "cancelling", "cancelling status must be preserved");
    assert.strictEqual(info.isStreaming, false, "isStreaming must be false");
  });

  it("handles two consecutive turns (start, end, start, end)", () => {
    const { setSessionInfo } = useSessionStore.getState();
    const msgKey = sessionKeyOf("agent1", "session1");
    setSessionInfo(
      "agent1",
      "session1",
      makeSessionInfo("agent1", "session1", { status: "idle" })
    );

    // Turn 1: start
    handleSessionTurnActive({
      type: "session/turnActive",
      agentId: "agent1",
      sessionId: "session1",
      active: true,
    });
    assert.strictEqual(useMessageStore.getState().streaming[msgKey], true);
    assert.strictEqual(
      useSessionStore.getState().sessionInfoMap[msgKey].status,
      "running"
    );

    // Turn 1: end
    handleSessionTurnActive({
      type: "session/turnActive",
      agentId: "agent1",
      sessionId: "session1",
      active: false,
    });
    assert.strictEqual(useMessageStore.getState().streaming[msgKey], false);
    assert.strictEqual(
      useSessionStore.getState().sessionInfoMap[msgKey].status,
      "idle"
    );

    // Turn 2: start
    handleSessionTurnActive({
      type: "session/turnActive",
      agentId: "agent1",
      sessionId: "session1",
      active: true,
    });
    assert.strictEqual(useMessageStore.getState().streaming[msgKey], true);
    assert.strictEqual(
      useSessionStore.getState().sessionInfoMap[msgKey].status,
      "running"
    );

    // Turn 2: end
    handleSessionTurnActive({
      type: "session/turnActive",
      agentId: "agent1",
      sessionId: "session1",
      active: false,
    });
    assert.strictEqual(useMessageStore.getState().streaming[msgKey], false);
    assert.strictEqual(
      useSessionStore.getState().sessionInfoMap[msgKey].status,
      "idle"
    );
  });

  it("sessionKeyOf correctly joins agentId and sessionId", () => {
    assert.strictEqual(sessionKeyOf("agent1", "session1"), "agent1:session1");
    assert.strictEqual(sessionKeyOf("a", "b"), "a:b");
  });
});
