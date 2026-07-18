import { sessionKeyOf, useSessionStore } from "../../store/sessionStore";
import { getLogger } from "../../lib/logger";
import type {
  SessionTabState,
  ConnectedAgentInfo,
  AgentInfo,
  WorkspaceFolder,
  SessionInfoDTO,
} from "../../store/sessionStore";
import { pendingSnapshotKey, setPendingSnapshotKey } from "../shared/guards";

const log = getLogger("handlers.tab");

export interface SetTabsMessage {
  type: "setTabs";
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  workspaceRoot?: string;
  agents?: ConnectedAgentInfo[];
  workspaceFolders?: WorkspaceFolder[];
  agentInfoMap?: Record<string, AgentInfo>;
  sessionInfoMap?: Record<string, SessionInfoDTO>;
}

export interface AddTabMessage {
  type: "addTab";
  tab: SessionTabState;
}

export interface UpdateTabMessage {
  type: "updateTab";
  sessionId: string;
  updates: Partial<SessionTabState>;
}

export interface SetActiveSessionMessage {
  type: "setActiveSession";
  sessionId: string;
  agentId: string;
}

export function handleSetTabs(data: SetTabsMessage): void {
  log.info("handleSetTabs", {
    tabCount: data.tabs.length,
    tabs: data.tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId)),
    activeSessionKey: data.activeSessionKey,
    hasWorkspaceRoot: !!data.workspaceRoot,
    hasAgentInfo: !!data.agentInfoMap
      ? Object.keys(data.agentInfoMap).length
      : 0,
  });

  const newKeys = data.tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId));

  const storeBefore = useSessionStore.getState();
  const existingKey = storeBefore.activeSessionKey;
  const authoritativeKey =
    data.activeSessionKey && newKeys.includes(data.activeSessionKey)
      ? data.activeSessionKey
      : existingKey && newKeys.includes(existingKey)
        ? existingKey
        : pendingSnapshotKey && newKeys.includes(pendingSnapshotKey)
          ? pendingSnapshotKey
          : (newKeys[0] ?? null);
  // Clear pendingSnapshotKey after reading
  setPendingSnapshotKey(null);

  useSessionStore.getState().bulkSetTabs({
    tabs: data.tabs,
    workspaceRoot: data.workspaceRoot,
    connectedAgents: data.agents,
    workspaceFolders: data.workspaceFolders,
    agentInfoMap: data.agentInfoMap,
    sessionInfoMap: data.sessionInfoMap,
  });

  const storeAfter = useSessionStore.getState();
  if (storeAfter.activeSessionKey !== authoritativeKey) {
    log.info("handleSetTabs: applying authoritative activeSessionKey", {
      from: storeAfter.activeSessionKey,
      to: authoritativeKey,
      source: data.activeSessionKey ? "extension" : "local-fallback",
    });
    storeAfter.setActiveSession(authoritativeKey);
  }
}

export function handleAddTab(data: AddTabMessage): void {
  useSessionStore
    .getState()
    .addTab(data.tab.agentId, data.tab.sessionId, data.tab.title);
}

export function handleUpdateTab(data: UpdateTabMessage): void {
  const store = useSessionStore.getState();
  const key = store.activeSessionKey;
  if (key && data.updates.title) {
    store.setTabTitle(key, data.updates.title);
  }
}

export function handleSetActiveSession(data: SetActiveSessionMessage): void {
  useSessionStore
    .getState()
    .setActiveSession(sessionKeyOf(data.agentId, data.sessionId));
}
