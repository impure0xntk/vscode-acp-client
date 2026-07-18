import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { useMeshStore } from "../../../store/meshStore";
import { getLogger } from "../../../lib/logger";
import type { Plan, PlanStep, ChatMessage } from "../../../types";

const log = getLogger("handlers.plan");

interface PlanUpdateMessage {
  type: "plan.update";
  plan: Plan;
}

interface PlanStepUpdateMessage {
  type: "plan.stepUpdate";
  planId: string;
  stepId: string;
  updates: Partial<PlanStep>;
}

interface PlanCancelledMessage {
  type: "plan.cancelled";
  planId: string;
}

export function handlePlanUpdate(data: PlanUpdateMessage): void {
  log.info("plan.update", {
    planId: data.plan.id,
    stepCount: data.plan.steps.length,
    status: data.plan.status,
  });
  const sessionStore = useSessionStore.getState();
  sessionStore.setCurrentPlan(data.plan);
  sessionStore.setIsPlanning(false);

  let targetKey: string | null = sessionStore.activeSessionKey;
  if (data.plan.teamId) {
    const team = useMeshStore
      .getState()
      .teams.find((t) => t.id === data.plan.teamId);
    if (team) {
      targetKey = sessionKeyOf(team.lead.agentId, team.lead.sessionId);
    }
  }
  if (targetKey) {
    const messages = useMessageStore.getState().perSession[targetKey];
    if (messages) {
      const idx = messages.findIndex(
        (m) => m.planMeta?.planStatus === "draft" && !m.planMeta?.isPlanRequest
      );
      if (idx >= 0) {
        const updated: ChatMessage = {
          ...messages[idx],
          content: `Plan created: ${data.plan.steps.length} steps`,
          planMeta: {
            ...messages[idx].planMeta,
            planId: data.plan.id,
            planStatus: data.plan.status,
          },
        };
        useMessageStore.getState().updateMessage(targetKey, idx, updated);
      }
    }
  }
}

export function handlePlanStepUpdate(data: PlanStepUpdateMessage): void {
  log.debug("plan.stepUpdate", {
    planId: data.planId,
    stepId: data.stepId,
    updates: Object.keys(data.updates),
  });
  const store = useSessionStore.getState();
  if (!store.currentPlan || store.currentPlan.id !== data.planId) return;
  store.updatePlanStep(data.stepId, data.updates);
}

export function handlePlanCancelled(data: PlanCancelledMessage): void {
  log.info("plan.cancelled", { planId: data.planId });
  const store = useSessionStore.getState();
  if (!store.currentPlan || store.currentPlan.id !== data.planId) return;
  store.cancelPlan();
}
