import {
  MESH_MARKER_V2_OPEN,
  MESH_MARKER_CLOSE,
} from "../../../domain/models/mesh";
import type { MeshOrchestrator } from "../../../domain/services/mesh-orchestrator";
import type { SupervisorOrchestrator } from "../../../domain/services/supervisor-orchestrator";
import type { SessionOrchestrator } from "../../../application/session/orchestrator";
import type { ChatPanel } from "../vscode-ui/chatPanel";

export interface MeshEventDeps {
  meshOrchestrator: MeshOrchestrator;
  supervisorOrchestrator: SupervisorOrchestrator | null;
  orchestrator: SessionOrchestrator;
  getChatPanel: () => ChatPanel | null;
}

/**
 * Wire MeshOrchestrator extracted-message events to the webview.
 * Extracted from the original wireOrchestratorEvents() in extension.ts.
 */
export function wireMeshEvents(deps: MeshEventDeps): void {
  const {
    meshOrchestrator,
    supervisorOrchestrator,
    orchestrator,
    getChatPanel,
  } = deps;

  meshOrchestrator.onExtractedMessage = (msg) => {
    const cp = getChatPanel();
    if (!cp) return;

    switch (msg.type) {
      case "plan_proposal": {
        if (supervisorOrchestrator) {
          const agentId = msg.agentId;
          const activeSessionId =
            orchestrator.getActiveSessionId(agentId) ?? "";
          const envelope = {
            version: "2.0",
            type: msg.type,
            id: msg.id ?? crypto.randomUUID(),
            from: msg.from,
            to: msg.to,
            mode: "p2P",
            payload: msg.payload,
            metadata: msg.metadata,
          };
          const rawOutput = `${MESH_MARKER_V2_OPEN}${JSON.stringify(envelope)}${MESH_MARKER_CLOSE}`;
          supervisorOrchestrator.parsePlanFromOutput(
            agentId,
            activeSessionId,
            rawOutput
          );
        }
        break;
      }
      case "plan_update": {
        const payload = msg.payload as
          | {
              steps?: Array<{
                id: string;
                description: string;
                status: string;
              }>;
              status?: string;
            }
          | undefined;
        cp.postMessage({
          type: "plan.update",
          agentId: msg.agentId,
          sessionId: "",
          steps: payload?.steps ?? [],
          status:
            (payload?.status as
              | "pending"
              | "approved"
              | "rejected"
              | "executing"
              | "completed") ?? "pending",
        });
        break;
      }
      case "task_delegate": {
        cp.postMessage({
          type: "agent.status",
          agentId: msg.to,
          status: "running",
          currentTask: (msg.payload as { description?: string })?.description,
        });
        break;
      }
      case "task_response": {
        if (supervisorOrchestrator) {
          supervisorOrchestrator.handleTaskResponse(msg);
        }
        break;
      }
      case "status_update": {
        const payload = msg.payload as
          | {
              agentId?: string;
              status?: string;
              currentTask?: string;
              progress?: number;
            }
          | undefined;
        if (payload?.agentId) {
          cp.postMessage({
            type: "agent.status",
            agentId: payload.agentId,
            status:
              (payload.status as
                | "idle"
                | "running"
                | "waiting"
                | "error"
                | "completed") ?? "idle",
            currentTask: payload.currentTask,
            progress: payload.progress,
          });
        }
        break;
      }
    }
  };
}
