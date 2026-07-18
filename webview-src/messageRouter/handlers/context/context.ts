import { useSessionStore } from "../../../store/sessionStore";
import { usePathResolutionStore } from "../../../store/pathResolutionStore";
import { buildReviewAttachment } from "../../../lib/review";
import { useMessageStore } from "../../../store/messageStore";
import { useMeshStore } from "../../../store/meshStore";
import { sessionKeyOf } from "../../../store/sessionStore";
import { getLogger } from "../../../lib/logger";
import type { PlanStep, ContextAttachment } from "../../../types";

const log = getLogger("handlers.context");

interface PathsResolvedMessage {
  type: "pathsResolved";
  sessionKey: string;
  paths: string[];
}

interface ReviewPrepareMessage {
  type: "review:prepare";
  prompt: string;
  agentId?: string;
  sessionId?: string;
}

interface FixPrepareMessage {
  type: "fix:prepare";
  attachment: ContextAttachment;
  prompt: string;
}

interface ResolvedExternalFileMessage {
  type: "resolvedExternalFile";
  attachment: ContextAttachment;
}

interface AttachContextMessage {
  type: "attachContext";
  attachment: ContextAttachment;
}

interface AgentStatusMessage {
  type: "agent.status";
  agentId: string;
  status: "idle" | "running" | "waiting" | "error" | "completed";
  currentTask?: string;
  progress?: number;
}

export function handlePathsResolved(data: PathsResolvedMessage): void {
  usePathResolutionStore
    .getState()
    .addResolvedPaths(data.sessionKey, data.paths);
}

export function handleReviewPrepare(data: ReviewPrepareMessage): void {
  const store = useSessionStore.getState();
  let agentId: string | undefined;
  let sessionId: string | undefined;
  if (data.agentId && data.sessionId) {
    agentId = data.agentId;
    sessionId = data.sessionId;
  } else {
    const activeKey = store.activeSessionKey;
    if (!activeKey) {
      log.warn("handleReviewPrepare: no session specified");
      return;
    }
    [agentId, sessionId] = activeKey.split(":");
  }
  const attachment = buildReviewAttachment(agentId, sessionId);
  window.dispatchEvent(
    new CustomEvent("acp:prepareReview", {
      detail: { attachment, prompt: data.prompt },
    })
  );
}

export function handleFixPrepare(data: FixPrepareMessage): void {
  const attachment = data.attachment;
  if (!attachment) return;
  window.dispatchEvent(
    new CustomEvent("acp:prepareReview", {
      detail: { attachment, prompt: data.prompt },
    })
  );
}

export function handleResolvedExternalFile(data: ResolvedExternalFileMessage): void {
  const attachment = data.attachment;
  if (attachment) {
    window.dispatchEvent(
      new CustomEvent("acp:attachExternalFile", {
        detail: { attachment },
      })
    );
  }
}

export function handleAttachContext(data: AttachContextMessage): void {
  const attachment = data.attachment;
  if (attachment) {
    window.dispatchEvent(
      new CustomEvent("acp:attachContext", {
        detail: { attachment },
      })
    );
  }
}

export function handleAgentStatus(data: AgentStatusMessage): void {
  log.debug("agent.status", { agentId: data.agentId, status: data.status });
  useMeshStore.getState().updateAgentStatus(data.agentId, {
    state:
      data.status === "running"
        ? "working"
        : data.status === "waiting"
          ? "waiting"
          : data.status === "error"
            ? "error"
            : "idle",
    currentTask: data.currentTask,
    progress: data.progress,
  });
}

interface MeshPlanMessage {
  type: "mesh:plan";
  text?: string;
  teamId?: string;
}

export function handleMeshPlan(data: MeshPlanMessage): void {
  const sessionStore = useSessionStore.getState();
  let activeKey = sessionStore.activeSessionKey;

  if (data.teamId) {
    const team = useMeshStore
      .getState()
      .teams.find((t) => t.id === data.teamId);
    if (team) {
      const leadKey = sessionKeyOf(team.lead.agentId, team.lead.sessionId);
      if (activeKey !== leadKey) {
        log.info("mesh:plan: switching to lead session", {
          from: activeKey,
          to: leadKey,
        });
        sessionStore.setActiveSession(leadKey);
        activeKey = leadKey;
      }
      sessionStore.setSupervisorViewMode("focus");
      sessionStore.setSupervisorFocusSession(leadKey);
    }
  }

  if (activeKey && data.text) {
    const [agentId, sessionId] = activeKey.split(":");
    useMessageStore.getState().appendMessage(activeKey, {
      id: crypto.randomUUID(),
      role: "user",
      content: data.text,
      timestamp: Date.now(),
      agentId,
      sessionId,
      planMeta: { isPlanRequest: true, teamId: data.teamId ?? "" },
    });

    useMessageStore.getState().appendMessage(activeKey, {
      id: `plan-indicator-${Date.now()}`,
      role: "system",
      content: "Planning...",
      timestamp: Date.now(),
      agentId,
      sessionId,
      planMeta: {
        isPlanRequest: false,
        planStatus: "draft",
        teamId: data.teamId ?? "",
      },
    });

    useSessionStore.getState().setIsPlanning(true, null);
  }
}
