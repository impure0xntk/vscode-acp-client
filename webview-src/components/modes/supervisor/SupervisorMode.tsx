import React, { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { Composer, type ComposerHandle } from "../../composer/Composer";
import { MeshPanel } from "../../mesh/MeshPanel";
import { TeamCreateDialog } from "../../mesh/TeamCreateDialog";
import { PlanViewerOverlay } from "./PlanViewer/PlanViewerOverlay";
import {
  SupervisorSessionView,
  SupervisorTabBar,
} from "../../sessions/supervisor";
import { useSessionStore } from "../../../store/sessionStore";
import type { SessionStoreState } from "../../../store/sessionStore";
import { useMeshStore } from "../../../store/meshStore";
import { getVsCodeApi } from "../../../lib/vscodeApi";
import type { SupervisorRole } from "../../sessions/supervisor/supervisor-types";

import type {
  ContextAttachment,
  QueuedPrompt,
  SendTarget,
  FileCandidate,
  SuggestionItem,
} from "../../../types";
import type { SlashCommand } from "../../../store/sessionStore";

export interface SupervisorModeProps {
  onSendMessage: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[],
    mode?: import("../../../types").CommunicationMode | null,
    teamId?: string,
    queueMode?: import("../../../types").QueuedPromptMode
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
  /** Resolve a previous turn's final output into a context attachment. */
  resolveOutput: (ref: string) => Promise<ContextAttachment | null>;
  availableCommands?: SlashCommand[];
  onCancelQueuedPrompt?: (
    agentId: string,
    sessionId: string,
    promptId: string
  ) => void;
  onClearQueue?: (agentId: string, sessionId: string) => void;
  onAttachDiff?: (attachment: ContextAttachment) => void;
  onSendMode?: (text: string, attachments: ContextAttachment[]) => void;
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
  resolveOutput,
  availableCommands = [],
  onCancelQueuedPrompt,
  onClearQueue,
  onAttachDiff,
}: SupervisorModeProps): React.ReactElement {
  const composerRef = React.useRef<ComposerHandle>(null);
  const {
    activeSessionKey,
    connectedAgents,
    tabOrder,
    tabTitles,
    tabIcons,
    currentPlan,
    teamSessions,
    isPlanning,
    supervisorViewMode,
    supervisorFocusSessionKey,
    removeTab,
    setSupervisorViewMode,
    setSupervisorFocusSession,
    setTeamSessions: setStoreTeamSessions,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      activeSessionKey: s.activeSessionKey,
      connectedAgents: s.connectedAgents,
      tabOrder: s.tabOrder,
      tabTitles: s.tabTitles,
      tabIcons: s.tabIcons,
      currentPlan: s.currentPlan,
      teamSessions: s.teamSessions,
      isPlanning: s.isPlanning,
      supervisorViewMode: s.supervisorViewMode,
      supervisorFocusSessionKey: s.supervisorFocusSessionKey,
      removeTab: s.removeTab,
      setSupervisorViewMode: s.setSupervisorViewMode,
      setSupervisorFocusSession: s.setSupervisorFocusSession,
      setTeamSessions: s.setTeamSessions,
    }))
  );

  // Derive the active team from meshStore
  const selectedTeam = useMeshStore((s) => s.selectedTeam);
  const activeTeamId = selectedTeam?.id ?? null;

  // Mesh panel visibility (always visible in supervisor mode)
  const setMeshPanelVisible = useMeshStore((s) => s.setMeshPanelVisible);
  const [showTeamCreate, setShowTeamCreate] = useState(false);

  // Derive team session tabs for the SupervisorTabBar
  const teamSessionTabs = useMemo(() => {
    if (!activeTeamId) return [];
    const keys = teamSessions[activeTeamId] ?? [];
    return keys.map((key) => {
      const [agentId, sessionId] = key.split(":");
      const agent = connectedAgents.find((a) => a.agentId === agentId);
      // Derive role from agent name convention or default to "worker"
      const role: SupervisorRole = agentId === agent?.name ? "lead" : "worker";
      return {
        sessionKey: key,
        agentId,
        sessionId,
        role,
        status: "idle",
        title: tabTitles[key] ?? sessionId,
        agentColor: agent?.color,
        hasUnread: false,
      };
    });
  }, [activeTeamId, teamSessions, connectedAgents, tabTitles]);

  // Plan for a specific team — sets Composer to supervisor mode with team selected
  const handlePlanTeam = useCallback((teamId: string) => {
    const teams = useMeshStore.getState().teams;
    const team = teams.find((t) => t.id === teamId);
    useMeshStore.getState().setCommunicationMode("supervisor");
    useMeshStore.getState().clearSendTargets();
    if (team) {
      useMeshStore.getState().setSelectedTeam({
        id: team.id,
        name: team.name,
        leadAgentId: team.lead.agentId,
      });
    }
    composerRef.current?.focusTextarea();
  }, []);

  const handleFocusSession = useCallback(
    (sessionKey: string) => {
      setSupervisorFocusSession(sessionKey);
      setSupervisorViewMode("focus");
      const [agentId, sessionId] = sessionKey.split(":");
      onSwitchSession(agentId, sessionId);
    },
    [setSupervisorFocusSession, setSupervisorViewMode, onSwitchSession]
  );

  const handleOverview = useCallback(() => {
    setSupervisorViewMode("overview");
    setSupervisorFocusSession(null);
  }, [setSupervisorViewMode, setSupervisorFocusSession]);

  const handleCloseSession = useCallback(
    (sessionKey: string) => {
      removeTab(sessionKey);
      const [agentId, sessionId] = sessionKey.split(":");
      getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
    },
    [removeTab]
  );

  // Current in-progress step ID for highlighting
  const currentStepId =
    currentPlan?.steps.find((s) => s.status === "in_progress")?.id ?? null;

  // Queue for the active session
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const sessionQueue: QueuedPrompt[] = activeSessionKey
    ? (promptQueue[activeSessionKey] ?? [])
    : [];

  return (
    <div className="flex flex-row flex-1 min-h-0 overflow-hidden h-full">
      {/* Left: Chat area (supervisor tabbar + session view + composer) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <SupervisorTabBar
          viewMode={supervisorViewMode}
          focusSessionKey={supervisorFocusSessionKey}
          teamId={activeTeamId}
          teamSessions={teamSessionTabs}
          onOverview={handleOverview}
          onFocusSession={handleFocusSession}
          onCloseSession={handleCloseSession}
          onNewSession={onNewSession}
        />

        <SupervisorSessionView
          teamId={activeTeamId}
          viewMode={supervisorViewMode}
          focusSessionKey={supervisorFocusSessionKey}
          currentStepId={currentStepId}
          isPlanning={isPlanning}
          plan={currentPlan}
          disabled={disabled}
          onSend={onSendMessage}
          onCancel={onCancel}
          onFocusSession={handleFocusSession}
          onOverview={handleOverview}
          onCloseSession={handleCloseSession}
        />

        <Composer
          ref={composerRef}
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
          resolveOutput={resolveOutput}
          availableCommands={availableCommands}
          queue={sessionQueue}
          onAttachDiff={onAttachDiff}
          onSendNow={(promptId) => {
            const entry = sessionQueue.find((e) => e.id === promptId);
            if (!entry) return;
            if (onCancelQueuedPrompt) {
              onCancelQueuedPrompt(entry.agentId, entry.sessionId, promptId);
            }
            onSendMessage(entry.text, entry.attachments ?? []);
            if (activeSessionKey) {
              useSessionStore
                .getState()
                .removeQueuedPrompt(activeSessionKey, promptId);
            }
          }}
          onRemoveQueueItem={(promptId) => {
            if (activeSessionKey) {
              const [agentId, sessionId] = activeSessionKey.split(":");
              onCancelQueuedPrompt?.(agentId, sessionId, promptId);
              useSessionStore
                .getState()
                .removeQueuedPrompt(activeSessionKey, promptId);
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
