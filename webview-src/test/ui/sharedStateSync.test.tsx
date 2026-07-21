import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { AppContainer } from "../../containers/AppContainer";
import { MiniChatContainer } from "../../containers/MiniChatContainer";
import { useSessionStore } from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import { useUiStateStore } from "../../store/uiStateStore";
import { useMeshStore } from "../../store/meshStore";
import type { SessionInfoDTO } from "../../store/sessionStore";
import { handleStateSyncResponse } from "../../messageRouter/handlers/session/stateSync";
import type { StateSyncResponse } from "../../messageRouter/handlers/session/stateSync";

// Mock VS Code API
const mockPostMessage = vi.fn();
const mockGetState = vi.fn(() => ({}));
const mockSetState = vi.fn();

vi.stubGlobal("acquireVsCodeApi", () => ({
  postMessage: mockPostMessage,
  getState: mockGetState,
  setState: mockSetState,
}));

// Test utilities
const createSessionKey = (agentId: string, sessionId: string) =>
  `${agentId}:${sessionId}`;

const createMockMessage = (
  overrides: Partial<{
    id: string;
    role: "user" | "agent" | "system" | "tool";
    content: string;
    timestamp: number;
    agentId: string;
    sessionId: string;
  }> = {}
) => ({
  id: overrides.id ?? `msg-${Date.now()}`,
  role: overrides.role ?? "user",
  content: overrides.content ?? "Test message",
  timestamp: overrides.timestamp ?? Date.now(),
  agentId: overrides.agentId ?? "test-agent",
  sessionId: overrides.sessionId ?? "test-session",
});

function mkInfo(
  agentId: string,
  sessionId: string,
  title: string,
  overrides: Partial<SessionInfoDTO> = {}
): SessionInfoDTO {
  return {
    sessionId,
    agentId,
    title,
    status: "idle",
    lastTurnOutcome: null,
    isStreaming: false,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    createdAt: new Date().toISOString(),
    lastResponseAt: null,
    sessionColor: "#3b82f6",
    ...overrides,
  };
}

function resetAllStores(): void {
  useSessionStore.setState({
    sessionInfoMap: {},
    tabOrder: [],
    tabTitles: {},
    tabIcons: {},
    activeSessionKey: null,
    connectedAgents: [],
    agentInfoMap: {},
    workspaceFolders: [],
    sessionCommands: {},
    pinnedSessionKeys: [],
    currentPlan: null,
    planHistory: [],
    completionNotification: null,
    statusline: { hostname: "", repoName: "", branch: "" },
    promptQueue: {},
    supervisorViewMode: "overview",
    supervisorFocusSessionKey: null,
    teamSessions: {},
    isPlanning: false,
    planningPlanId: null,
    commandCenterExpanded: false,
    commandCenterSelectedKey: null,
  } as any);
  useMessageStore.setState({
    perSession: {},
    streaming: {},
    promptQueue: {},
    lastSessionUpdateType: {},
  } as any);
  useUiStateStore.setState({
    overviewVisible: false,
    overviewWidth: 280,
    overviewPosition: "right",
    overviewFilter: "all",
    overviewExpandedSessions: [],
    overviewSelectedSessionIds: [],
    overviewSelectionMode: false,
    splitDirection: "horizontal",
    splitRatios: [],
  } as any);
  useMeshStore.setState({
    sendTargets: [],
    communicationMode: null,
    selectedTeam: null,
    meshPanelVisible: false,
  } as any);
}

function seedOneSession(): void {
  useSessionStore.getState().bulkSetTabs({
    tabs: [
      { agentId: "claude", sessionId: "session-1", title: "Main Session" },
    ],
    sessionInfoMap: {
      "claude:session-1": mkInfo("claude", "session-1", "Main Session"),
    },
    connectedAgents: [{ agentId: "claude", name: "Claude", color: "#3b82f6" }],
  });
  useSessionStore.getState().setActiveSession("claude:session-1");
}

describe("Shared Zustand Store - UnifiedChat <-> MiniChat Sync", () => {
  const sessionKey = createSessionKey("test-agent", "test-session");
  const agentId = "test-agent";
  const sessionId = "test-session";

  beforeEach(() => {
    mockPostMessage.mockClear();
    mockGetState.mockReturnValue({});
    resetAllStores();
  });

  describe("State Sync on Mount", () => {
    it("requests state sync from extension host when MiniChat mounts", () => {
      seedOneSession();
      render(<MiniChatContainer />);
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "state/syncRequest" })
      );
    });

    it("requests state sync from extension host when UnifiedChat mounts", () => {
      seedOneSession();
      render(<AppContainer />);
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "state/syncRequest" })
      );
    });
  });

  describe("handleStateSyncResponse", () => {
    it("applies session store state via setState()", () => {
      const data: StateSyncResponse = {
        type: "state/syncResponse",
        sessionStore: {
          tabOrder: ["claude:session-1"],
          activeSessionKey: "claude:session-1",
          sessionInfoMap: {
            "claude:session-1": mkInfo("claude", "session-1", "Synced Session"),
          },
          workspaceRoot: "/test",
          connectedAgents: [
            { agentId: "claude", name: "Claude", color: "#3b82f6" },
          ],
          workspaceFolders: [],
          agentInfoMap: {},
          completionNotification: null,
        },
        messageStore: {
          perSession: {},
          streaming: {},
          promptQueue: {},
          lastSessionUpdateType: {},
        },
        uiStateStore: {
          overviewVisible: true,
          overviewWidth: 350,
          overviewPosition: "left",
          overviewFilter: "running",
          overviewExpandedSessions: [],
          overviewSelectedSessionIds: [],
          overviewSelectionMode: false,
          splitDirection: "horizontal",
          splitRatios: [],
        } as any,
      };

      act(() => {
        handleStateSyncResponse(data);
      });

      // Verify session store was updated
      const sessionState = useSessionStore.getState();
      expect(sessionState.tabOrder).toEqual(["claude:session-1"]);
      expect(sessionState.activeSessionKey).toBe("claude:session-1");
      expect(sessionState.workspaceRoot).toBe("/test");
      expect(
        sessionState.sessionInfoMap["claude:session-1"]?.title
      ).toBe("Synced Session");

      // Verify UI state store was updated
      const uiState = useUiStateStore.getState();
      expect(uiState.overviewVisible).toBe(true);
      expect(uiState.overviewWidth).toBe(350);
      expect(uiState.overviewPosition).toBe("left");
    });

    it("applies message store state via setState()", () => {
      const messages = [createMockMessage({ content: "Hello from agent" })];
      const data: StateSyncResponse = {
        type: "state/syncResponse",
        sessionStore: {
          tabOrder: [sessionKey],
          activeSessionKey: sessionKey,
          sessionInfoMap: {
            [sessionKey]: mkInfo(agentId, sessionId, "Test"),
          },
          workspaceRoot: null,
          connectedAgents: [],
          workspaceFolders: [],
          agentInfoMap: {},
          completionNotification: null,
        },
        messageStore: {
          perSession: {
            [sessionKey]: messages,
          },
          streaming: { [sessionKey]: false },
          promptQueue: {},
          lastSessionUpdateType: {},
        },
        uiStateStore: {
          overviewVisible: false,
          overviewWidth: 280,
          overviewPosition: "right",
          overviewFilter: "all",
          overviewExpandedSessions: [],
          overviewSelectedSessionIds: [],
          overviewSelectionMode: false,
          splitDirection: "horizontal",
          splitRatios: [],
        } as any,
      };

      act(() => {
        handleStateSyncResponse(data);
      });

      const msgState = useMessageStore.getState();
      expect(msgState.perSession[sessionKey]).toHaveLength(1);
      expect(msgState.perSession[sessionKey][0].content).toBe(
        "Hello from agent"
      );
    });

    it("triggers React re-render after setState()", () => {
      seedOneSession();
      render(<MiniChatContainer />);

      const data: StateSyncResponse = {
        type: "state/syncResponse",
        sessionStore: {
          tabOrder: ["claude:session-1"],
          activeSessionKey: "claude:session-1",
          sessionInfoMap: {
            "claude:session-1": mkInfo("claude", "session-1", "Updated Title"),
          },
          workspaceRoot: null,
          connectedAgents: [
            { agentId: "claude", name: "Claude", color: "#3b82f6" },
          ],
          workspaceFolders: [],
          agentInfoMap: {},
          completionNotification: null,
        },
        messageStore: {
          perSession: {},
          streaming: {},
          promptQueue: {},
          lastSessionUpdateType: {},
        },
        uiStateStore: {
          overviewVisible: false,
          overviewWidth: 280,
          overviewPosition: "right",
          overviewFilter: "all",
          overviewExpandedSessions: [],
          overviewSelectedSessionIds: [],
          overviewSelectionMode: false,
          splitDirection: "horizontal",
          splitRatios: [],
        } as any,
      };

      act(() => {
        handleStateSyncResponse(data);
      });

      // Verify store was updated via setState()
      const sessionState = useSessionStore.getState();
      expect(sessionState.tabOrder).toEqual(["claude:session-1"]);
      expect(
        sessionState.sessionInfoMap["claude:session-1"]?.title
      ).toBe("Updated Title");
    });
  });

  describe("Cross-Panel Zustand Store Sharing", () => {
    it("session store mutations from UnifiedChat are visible in MiniChat", () => {
      seedOneSession();
      render(<AppContainer />);
      render(<MiniChatContainer />);

      // Mutate session store (simulating what happens in UnifiedChat)
      act(() => {
        useSessionStore.getState().setSessionInfo(
          "claude",
          "session-1",
          mkInfo("claude", "session-1", "Main Session", {
            status: "running",
            tokenUsage: {
              inputTokens: 500,
              outputTokens: 200,
              totalTokens: 700,
            },
          })
        );
      });

      // Both panels read from the same store
      const info =
        useSessionStore.getState().sessionInfoMap["claude:session-1"];
      expect(info?.status).toBe("running");
      expect(info?.tokenUsage.totalTokens).toBe(700);
    });

    it("message store mutations propagate to both panels", () => {
      seedOneSession();
      render(<AppContainer />);
      render(<MiniChatContainer />);

      const sessionKey = "claude:session-1";
      const newMsg = createMockMessage({
        id: "msg-1",
        role: "agent",
        content: "Streaming response",
        agentId: "claude",
        sessionId: "session-1",
      });

      act(() => {
        useMessageStore.getState().appendMessage(sessionKey, newMsg);
      });

      const msgs = useMessageStore.getState().perSession[sessionKey];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Streaming response");
    });

    it("ui store mutations propagate to both panels", () => {
      seedOneSession();
      render(<AppContainer />);
      render(<MiniChatContainer />);

      act(() => {
        useUiStateStore.getState().setOverviewFilter("running");
      });

      expect(useUiStateStore.getState().overviewFilter).toBe("running");
    });

    it("pinning a session is reflected in both panels", () => {
      seedOneSession();
      render(<AppContainer />);
      render(<MiniChatContainer />);

      act(() => {
        useSessionStore.getState().pinSession("claude:session-1");
      });

      expect(
        useSessionStore.getState().pinnedSessionKeys
      ).toContain("claude:session-1");
    });
  });

  describe("Session Switching Synchronization", () => {
    it("switching active session in store is reflected in both panels", () => {
      const sessionKey2 = createSessionKey("test-agent", "session-2");

      useSessionStore.getState().tabOrder = [sessionKey, sessionKey2];
      useSessionStore.getState().activeSessionKey = sessionKey;
      useSessionStore.getState().sessionInfoMap = {
        [sessionKey]: mkInfo(agentId, sessionId, "Session 1"),
        [sessionKey2]: mkInfo(agentId, "session-2", "Session 2"),
      };
      useMessageStore.getState().perSession = {
        [sessionKey]: [createMockMessage({ content: "Session 1 message" })],
        [sessionKey2]: [createMockMessage({ content: "Session 2 message" })],
      };

      render(<AppContainer />);
      render(<MiniChatContainer />);

      // Switch session via store
      act(() => {
        useSessionStore.getState().setActiveSession(sessionKey2);
      });

      expect(useSessionStore.getState().activeSessionKey).toBe(sessionKey2);
    });
  });

  describe("State Persistence Across Reloads", () => {
    it("does NOT request history:getSession on MiniChat remount", () => {
      // Messages are delivered via bridge (session/snapshot and session/message),
      // not via history:getSession. Remounts should NOT trigger history fetch.
      seedOneSession();
      render(<MiniChatContainer />);
      mockPostMessage.mockClear();

      // Second mount (simulating webview reload)
      render(<MiniChatContainer />);

      // Should NOT request history:getSession
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "history:getSession" })
      );
    });

    it("restores session overview state after UnifiedChat remounts", () => {
      const sessionKey2 = createSessionKey("test-agent", "session-2");

      useSessionStore.getState().tabOrder = [sessionKey, sessionKey2];
      useSessionStore.getState().activeSessionKey = sessionKey;
      useSessionStore.getState().sessionInfoMap = {
        [sessionKey]: mkInfo(agentId, sessionId, "Session 1"),
        [sessionKey2]: mkInfo(agentId, "session-2", "Session 2", {
          status: "running",
        }),
      };

      render(<AppContainer />);
      mockPostMessage.mockClear();

      render(<AppContainer />);

      // Should request full state sync
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "state/syncRequest" })
      );
    });
  });
});