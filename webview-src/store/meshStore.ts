import { create } from "zustand";
import { produce } from "immer";
import type {
  MeshAgentStatus,
  MeshTaskEntry,
  MeshRecentMessage,
  SendTarget,
} from "../types";

// ── Store shape ──────────────────────────────────────────────────────────────

export interface MeshState {
  // Agent statuses for MeshPanel
  agentStatuses: MeshAgentStatus[];
  // Task board entries
  tasks: MeshTaskEntry[];
  // Recent message log
  recentMessages: MeshRecentMessage[];
  // Composer multi-@ send targets
  sendTargets: SendTarget[];
  // Mesh panel visibility
  meshPanelVisible: boolean;

  // ── Actions ───────────────────────────────────────────────────────────

  setAgentStatuses: (statuses: MeshAgentStatus[]) => void;
  updateAgentStatus: (agentId: string, updates: Partial<MeshAgentStatus>) => void;
  setTasks: (tasks: MeshTaskEntry[]) => void;
  updateTask: (taskId: string, updates: Partial<MeshTaskEntry>) => void;
  setRecentMessages: (messages: MeshRecentMessage[]) => void;
  addRecentMessage: (message: MeshRecentMessage) => void;

  // Send target management
  addSendTarget: (target: SendTarget) => void;
  removeSendTarget: (agentId: string, sessionId: string) => void;
  clearSendTargets: () => void;
  updateSendTargetStatus: (
    agentId: string,
    sessionId: string,
    status: SendTarget["status"]
  ) => void;

  // Mesh panel visibility
  setMeshPanelVisible: (visible: boolean) => void;
}

export const useMeshStore = create<MeshState>((set) => ({
  agentStatuses: [],
  tasks: [],
  recentMessages: [],
  sendTargets: [],
  meshPanelVisible: false,

  setAgentStatuses: (statuses) => set({ agentStatuses: statuses }),

  updateAgentStatus: (agentId, updates) =>
    set(produce((draft: MeshState) => {
      const idx = draft.agentStatuses.findIndex((a) => a.agentId === agentId);
      if (idx >= 0) {
        Object.assign(draft.agentStatuses[idx], updates);
      }
    })),

  setTasks: (tasks) => set({ tasks }),

  updateTask: (taskId, updates) =>
    set(produce((draft: MeshState) => {
      const idx = draft.tasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        Object.assign(draft.tasks[idx], updates);
      }
    })),

  setRecentMessages: (messages) => set({ recentMessages: messages }),

  addRecentMessage: (message) =>
    set(produce((draft: MeshState) => {
      draft.recentMessages.push(message);
      // Keep last 50 messages
      if (draft.recentMessages.length > 50) {
        draft.recentMessages = draft.recentMessages.slice(-50);
      }
    })),

  addSendTarget: (target) =>
    set(produce((draft: MeshState) => {
      const exists = draft.sendTargets.some(
        (t) => t.agentId === target.agentId && t.sessionId === target.sessionId
      );
      if (!exists) {
        draft.sendTargets.push(target);
      }
    })),

  removeSendTarget: (agentId, sessionId) =>
    set(produce((draft: MeshState) => {
      draft.sendTargets = draft.sendTargets.filter(
        (t) => !(t.agentId === agentId && t.sessionId === sessionId)
      );
    })),

  clearSendTargets: () => set({ sendTargets: [] }),

  updateSendTargetStatus: (agentId, sessionId, status) =>
    set(produce((draft: MeshState) => {
      const target = draft.sendTargets.find(
        (t) => t.agentId === agentId && t.sessionId === sessionId
      );
      if (target) target.status = status;
    })),

  setMeshPanelVisible: (visible) => set({ meshPanelVisible: visible }),
}));
