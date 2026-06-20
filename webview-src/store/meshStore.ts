import { create } from "zustand";
import type {
  CommunicationMode,
  MeshAgentStatus,
  MeshTeamEntry,
  MeshTaskEntry,
  MeshRecentMessage,
  SendTarget,
  SelectedTeam,
} from "../types";

// ── Store shape ──────────────────────────────────────────────────────────────

export interface MeshState {
  agentStatuses: MeshAgentStatus[];
  teams: MeshTeamEntry[];
  tasks: MeshTaskEntry[];
  recentMessages: MeshRecentMessage[];
  sendTargets: SendTarget[];
  meshPanelVisible: boolean;
  /** Active mesh communication mode — set by /mesh command, cleared on send */
  communicationMode: CommunicationMode | null;
  /** Selected team for @team: picker — set when user picks a team, cleared on send */
  selectedTeam: SelectedTeam | null;

  setAgentStatuses: (statuses: MeshAgentStatus[]) => void;
  updateAgentStatus: (
    agentId: string,
    updates: Partial<MeshAgentStatus>
  ) => void;
  setTeams: (teams: MeshTeamEntry[]) => void;
  addTeam: (team: MeshTeamEntry) => void;
  updateTeam: (teamId: string, updates: Partial<MeshTeamEntry>) => void;
  setTasks: (tasks: MeshTaskEntry[]) => void;
  updateTask: (taskId: string, updates: Partial<MeshTaskEntry>) => void;
  setRecentMessages: (messages: MeshRecentMessage[]) => void;
  addRecentMessage: (message: MeshRecentMessage) => void;

  addSendTarget: (target: SendTarget) => void;
  removeSendTarget: (agentId: string, sessionId: string) => void;
  clearSendTargets: () => void;
  updateSendTargetStatus: (
    agentId: string,
    sessionId: string,
    status: SendTarget["status"]
  ) => void;

  setMeshPanelVisible: (visible: boolean) => void;
  setCommunicationMode: (mode: CommunicationMode | null) => void;
  setSelectedTeam: (team: SelectedTeam | null) => void;
}

export const useMeshStore = create<MeshState>((set, get) => ({
  agentStatuses: [],
  teams: [],
  tasks: [],
  recentMessages: [],
  sendTargets: [],
  meshPanelVisible: false,
  communicationMode: null,
  selectedTeam: null,

  setAgentStatuses: (statuses) =>
    set((s) =>
      s.agentStatuses === statuses ? s : { agentStatuses: statuses }
    ),

  updateAgentStatus: (agentId, updates) =>
    set((state) => {
      const idx = state.agentStatuses.findIndex((a) => a.agentId === agentId);
      if (idx < 0) return state;
      const prev = state.agentStatuses[idx];
      const next = { ...prev, ...updates };
      if (prev === next) return state;
      const arr = [...state.agentStatuses];
      arr[idx] = next;
      return { ...state, agentStatuses: arr };
    }),

  setTeams: (teams) => set((s) => (s.teams === teams ? s : { teams })),

  addTeam: (team) =>
    set((state) => {
      const exists = state.teams.some((t) => t.id === team.id);
      if (exists) return state;
      return { ...state, teams: [...state.teams, team] };
    }),

  updateTeam: (teamId, updates) =>
    set((state) => {
      const idx = state.teams.findIndex((t) => t.id === teamId);
      if (idx < 0) return state;
      const prev = state.teams[idx];
      const next = { ...prev, ...updates };
      if (prev === next) return state;
      const arr = [...state.teams];
      arr[idx] = next;
      return { ...state, teams: arr };
    }),

  setTasks: (tasks) => set((s) => (s.tasks === tasks ? s : { tasks })),

  updateTask: (taskId, updates) =>
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) return state;
      const prev = state.tasks[idx];
      const next = { ...prev, ...updates };
      if (prev === next) return state;
      const arr = [...state.tasks];
      arr[idx] = next;
      return { ...state, tasks: arr };
    }),

  setRecentMessages: (messages) =>
    set((s) =>
      s.recentMessages === messages ? s : { recentMessages: messages }
    ),

  addRecentMessage: (message) =>
    set((state) => {
      const arr = [...state.recentMessages, message];
      if (arr.length > 50) arr.splice(0, arr.length - 50);
      return { ...state, recentMessages: arr };
    }),

  addSendTarget: (target) =>
    set((state) => {
      const exists = state.sendTargets.some(
        (t) => t.agentId === target.agentId && t.sessionId === target.sessionId
      );
      if (exists) return state;
      return { ...state, sendTargets: [...state.sendTargets, target] };
    }),

  removeSendTarget: (agentId, sessionId) =>
    set((state) => {
      const filtered = state.sendTargets.filter(
        (t) => !(t.agentId === agentId && t.sessionId === sessionId)
      );
      return filtered.length !== state.sendTargets.length
        ? { sendTargets: filtered }
        : state;
    }),

  clearSendTargets: () => set({ sendTargets: [] }),

  updateSendTargetStatus: (agentId, sessionId, status) =>
    set((state) => {
      const idx = state.sendTargets.findIndex(
        (t) => t.agentId === agentId && t.sessionId === sessionId
      );
      if (idx < 0) return state;
      const prev = state.sendTargets[idx];
      if (prev.status === status) return state;
      const arr = [...state.sendTargets];
      arr[idx] = { ...prev, status };
      return { ...state, sendTargets: arr };
    }),

  setMeshPanelVisible: (visible) =>
    set((s) =>
      s.meshPanelVisible === visible ? s : { meshPanelVisible: visible }
    ),
  setCommunicationMode: (mode) =>
    set((s) =>
      s.communicationMode === mode ? s : { communicationMode: mode }
    ),
  setSelectedTeam: (team) =>
    set((s) => (s.selectedTeam === team ? s : { selectedTeam: team })),
}));
