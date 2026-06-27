import React, { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { SessionView } from "../../sessions/SessionView";
import { SessionTabBar } from "../../sessions/SessionTabBar";
import { Composer } from "../../composer/Composer";
import { MeshPanel } from "../../mesh/MeshPanel";
import { TeamCreateDialog } from "../../mesh/TeamCreateDialog";
import { PlanViewerOverlay } from "./PlanViewer/PlanViewerOverlay";
import { useSessionStore } from "../../../store/sessionStore";
import type {
  SessionStoreState,
  SlashCommand,
} from "../../../store/sessionStore";
import { useMeshStore } from "../../../store/meshStore";
import { getVsCodeApi } from "../../../lib/vscodeApi";
import type {
  ContextAttachment,
  QueuedPrompt,
  SendTarget,
  FileCandidate,
  SuggestionItem,
} from "../../../types";

export interface SupervisorModeProps {
  onSendMessage: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[],
    mode?: import("../../../types").CommunicationMode | null,
    teamId?: string
  ) => void;
  onCancel: (targets?: SendTarget[]) => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  onNewSession: () => void;
  disabled?: boolean;
  status?:
    | "idle"
    | "running"
    | "cancelling"
    | "completed"
    | "error"
    | "cancelled";
  fetchFiles: (query: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;
  availableCommands?: SlashCommand[];
  onCancelQueuedPrompt?: (agentId: string, sessionId: string, promptId: string) => void;
  onClearQueue?: (agentId: string, sessionId: string) => void;
}

export const SupervisorMode = React.memo(function SupervisorMode({
  onSendMessage,
  onCancel,
  onSwitchSession,
  onRenameSession,
  onNewSession,
  disabled = false,
  status = "idle",
  fetchFiles,
  resolveFile,
  resolveSelection,
  resolveDiff,
  fetchSymbols,
  resolveSymbol,
  availableCommands = [],
  onCancelQueuedPrompt,
  onClearQueue,
}: SupervisorModeProps): React.ReactElement {
  const {
    activeSessionKey,
    pinnedSessionKeys,
    connectedAgents,
    tabOrder,
    tabTitles,
    tabIcons,
    currentPlan,
    togglePin,
    setFocusSession,
    removeTab,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      activeSessionKey: s.activeSessionKey,
      pinnedSessionKeys: s.pinnedSessionKeys,
      connectedAgents: s.connectedAgents,
      tabOrder: s.tabOrder,
      tabTitles: s.tabTitles,
      tabIcons: s.tabIcons,
      currentPlan: s.currentPlan,
      togglePin: s.togglePin,
      setFocusSession: s.setFocusSession,
      removeTab: s.removeTab,
    }))
  );

  // Mesh panel visibility (always visible in supervisor mode)
  const meshPanelVisible = useMeshStore((s) => s.meshPanelVisible);
  const setMeshPanelVisible = useMeshStore((s) => s.setMeshPanelVisible);
  const [showTeamCreate, setShowTeamCreate] = useState(false);

  // Plan for a specific team — sends mesh:plan with teamId
  const handlePlanTeam = useCallback((teamId: string) => {
    getVsCodeApi().postMessage({
      type: "mesh:plan",
      teamId,
      text: "",
    });
  }, []);

  const tabs = useMemo(
    () =>
      tabOrder.map((key) => {
        const [agentId, sessionId] = key.split(":");
        return {
          sessionId,
          agentId,
          title: tabTitles[key] ?? sessionId,
          agentIcon: tabIcons[key],
        };
      }),
    [tabOrder, tabTitles, tabIcons]
  );

  const handleFocusChange = useCallback(
    (key: string) => {
      const current = useSessionStore.getState().activeSessionKey;
      if (current === key) return;
      setFocusSession(key);
      const [agentId, sessionId] = key.split(":");
      onSwitchSession(agentId, sessionId);
    },
    [setFocusSession, onSwitchSession]
  );

  const handleTogglePin = useCallback(
    (key: string) => {
      togglePin(key);
    },
    [togglePin]
  );

  const handleClose = useCallback(
    (key: string) => {
      togglePin(key);
      removeTab(key);
      const [agentId, sessionId] = key.split(":");
      getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
    },
    [togglePin, removeTab]
  );

  const handleTabClick = useCallback(
    (sessionKey: string) => {
      handleFocusChange(sessionKey);
    },
    [handleFocusChange]
  );

  const handleTabClose = useCallback(
    (sessionKey: string) => {
      handleClose(sessionKey);
    },
    [handleClose]
  );

  const scrollToMessageRef = React.useRef<((id: string) => void) | undefined>(
    undefined
  );
  const forceScrollToBottomRef = React.useRef<(() => void) | undefined>(
    undefined
  );
  const scrollToUnreadRef = React.useRef<(() => void) | undefined>(undefined);

  // Queue for the active session
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const sessionQueue: QueuedPrompt[] = activeSessionKey
    ? promptQueue[activeSessionKey] ?? []
    : [];

  return (
    <div className="flex flex-row flex-1 min-h-0 overflow-hidden h-full">
      {/* Left: Chat area (session tabs + messages + composer) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <SessionTabBar
          tabs={tabs}
          activeSessionKey={activeSessionKey}
          connectedAgents={connectedAgents}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onNewSession={onNewSession}
          onRenameSession={onRenameSession}
          pinnedSessionKeys={pinnedSessionKeys}
          onTogglePin={handleTogglePin}
        />

        <SessionView
          sessionKey={activeSessionKey}
          disabled={disabled}
          pinnedKeys={pinnedSessionKeys}
          onSend={onSendMessage}
          onCancel={onCancel}
          onFocusChange={handleFocusChange}
          onPin={handleTogglePin}
          onUnpin={handleTogglePin}
          onClose={handleClose}
          scrollToMessageRef={scrollToMessageRef}
          forceScrollToBottomRef={forceScrollToBottomRef}
          scrollToUnreadRef={scrollToUnreadRef}
        />
        <Composer
          onSend={onSendMessage}
          onCancel={onCancel}
          onSwitchSession={onSwitchSession}
          onRenameSession={onRenameSession}
          disabled={disabled}
          status={status}
          fetchFiles={fetchFiles}
          resolveFile={resolveFile}
          resolveSelection={resolveSelection}
          resolveDiff={resolveDiff}
          fetchSymbols={fetchSymbols}
          resolveSymbol={resolveSymbol}
          availableCommands={availableCommands}
          queue={sessionQueue}
          onSendNow={(promptId) => {
            const entry = sessionQueue.find((e) => e.id === promptId);
            if (!entry) return;
            if (onCancelQueuedPrompt) {
              onCancelQueuedPrompt(entry.agentId, entry.sessionId, promptId);
            }
            onSendMessage(entry.text, entry.attachments ?? []);
            if (activeSessionKey) {
              useSessionStore.getState().removeQueuedPrompt(activeSessionKey, promptId);
            }
          }}
          onRemoveQueueItem={(promptId) => {
            if (activeSessionKey) {
              const [agentId, sessionId] = activeSessionKey.split(":");
              onCancelQueuedPrompt?.(agentId, sessionId, promptId);
              useSessionStore.getState().removeQueuedPrompt(activeSessionKey, promptId);
            }
          }}
          onClearQueue={() => {
            if (activeSessionKey) {
              const [agentId, sessionId] = activeSessionKey.split(":");
              onClearQueue?.(agentId, sessionId);
              useSessionStore.getState().clearQueue(activeSessionKey);
            }
          }}
        />
      </div>

      {/* Right: Mesh panel (persistent in supervisor mode) */}
      <div className="w-[280px] shrink-0 border-l border-border flex flex-col min-h-0 overflow-hidden">
        <MeshPanel
          onClose={() => setMeshPanelVisible(false)}
          onOpenTeamCreate={() => setShowTeamCreate(true)}
          onPlanTeam={handlePlanTeam}
        />
      </div>

      {/* Overlay: Plan viewer */}
      {currentPlan && <PlanViewerOverlay plan={currentPlan} />}

      {/* Team create dialog */}
      {showTeamCreate && (
        <TeamCreateDialog onClose={() => setShowTeamCreate(false)} />
      )}
    </div>
  );
});
