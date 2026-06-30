import React, { useCallback, useMemo } from "react";
import { useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { useMeshStore } from "../../../store/meshStore";
import type { ContextAttachment, Plan, SendTarget } from "../../../types";
import type {
  SessionOverviewCardItem,
  SupervisorViewMode,
} from "./supervisor-types";
import { SessionOverviewGrid } from "./SessionOverviewGrid";
import { PlanCompactBar } from "./PlanCompactBar";
import { SessionChatContainer } from "../SessionChatContainer";
import { getLogger } from "../../../lib/logger";

const log = getLogger("supervisor.sessionView");

interface Props {
  teamId: string | null;
  viewMode: SupervisorViewMode;
  focusSessionKey: string | null;
  currentStepId: string | null;
  isPlanning: boolean;
  plan: Plan | null;
  disabled: boolean;
  onSend: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[]
  ) => void;
  onCancel: (targets?: SendTarget[]) => void;
  onFocusSession: (sessionKey: string) => void;
  onOverview: () => void;
  onCloseSession: (sessionKey: string) => void;
}

export const SupervisorSessionView = React.memo(function SupervisorSessionView({
  teamId,
  viewMode,
  focusSessionKey,
  currentStepId,
  isPlanning,
  plan,
  onFocusSession,
  onCancel,
}: Props): React.ReactElement {
  const teamSessions = useSessionStore((s) => s.teamSessions);
  const sessionInfoMap = useSessionStore((s) => s.sessionInfoMap);
  const tabTitles = useSessionStore((s) => s.tabTitles);
  const connectedAgents = useSessionStore((s) => s.connectedAgents);
  const agentStatuses = useMeshStore((s) => s.agentStatuses);

  const sessionKeys = teamId ? (teamSessions[teamId] ?? []) : [];

  // Derive overview card data from live store state so cards re-render on change.
  const cards: SessionOverviewCardItem[] = useMemo(() => {
    return sessionKeys.map((key) => {
      const [agentId, sessionId] = key.split(":");
      const info = sessionInfoMap[key];
      const agent = connectedAgents.find((a) => a.agentId === agentId);
      const status = agentStatuses.find((a) => a.agentId === agentId);

      const msgs = useMessageStore.getState().perSession[key] ?? [];
      const lastAgent = [...msgs].reverse().find((m) => m.role === "agent");
      const lastOutput = lastAgent?.content?.slice(0, 200);

      const assignedStepId =
        plan?.steps.find(
          (step) =>
            step.assignedTo?.agentId === agentId &&
            step.assignedTo?.sessionId === sessionId
        )?.id ?? undefined;

      const tokenUsage = info?.tokenUsage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };

      const elapsedMs =
        info?.status === "running" && info.lastResponseAt
          ? Date.now() - new Date(info.lastResponseAt).getTime()
          : undefined;

      return {
        sessionKey: key,
        agentId,
        sessionId,
        title: tabTitles[key] ?? info?.title ?? sessionId,
        agentName: agent?.name ?? agentId,
        role: status?.role ?? "worker",
        status: info?.status ?? "idle",
        assignedStepId,
        lastOutput,
        progress: status?.progress,
        tokenUsage: {
          input: tokenUsage.inputTokens,
          output: tokenUsage.outputTokens,
        },
        elapsedMs,
        agentColor: agent?.color,
        hasUnread: false,
      } satisfies SessionOverviewCardItem;
    });
  }, [
    sessionKeys,
    sessionInfoMap,
    tabTitles,
    connectedAgents,
    agentStatuses,
    plan,
  ]);

  const handleViewPlan = useCallback(() => {
    // Plan overlay is managed by SupervisorMode; this is a no-op placeholder.
    log.debug("viewPlan clicked");
  }, []);

  const handleCancelSession = useCallback(
    (sessionKey: string) => {
      const [agentId, sessionId] = sessionKey.split(":");
      log.debug("cancel session", { agentId, sessionId });
      onCancel([{ agentId, sessionId, label: sessionId }]);
    },
    [onCancel]
  );

  const showCompactBar = isPlanning || plan !== null;

  if (viewMode === "overview") {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {showCompactBar && (
          <PlanCompactBar
            plan={plan}
            isPlanning={isPlanning}
            onViewPlan={handleViewPlan}
          />
        )}
        <SessionOverviewGrid
          sessions={cards}
          currentStepId={currentStepId}
          onFocus={onFocusSession}
          onCancel={handleCancelSession}
        />
      </div>
    );
  }

  if (viewMode === "focus" && focusSessionKey) {
    const [fAgentId, fSessionId] = focusSessionKey.split(":");
    const fInfo = sessionInfoMap[focusSessionKey];

    return (
      <SessionChatContainer
        key={focusSessionKey}
        sessionKey={focusSessionKey}
        agentId={fAgentId}
        sessionId={fSessionId}
        status={fInfo?.status}
        isActive={true}
      />
    );
  }

  // Fallback: render overview when no focus session is selected.
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {showCompactBar && (
        <PlanCompactBar
          plan={plan}
          isPlanning={isPlanning}
          onViewPlan={handleViewPlan}
        />
      )}
      <SessionOverviewGrid
        sessions={cards}
        currentStepId={currentStepId}
        onFocus={onFocusSession}
        onCancel={handleCancelSession}
      />
    </div>
  );
});
