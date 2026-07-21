import { sessionKeyOf, useSessionStore } from "../../../store/sessionStore";
import { useMeshStore } from "../../../store/meshStore";
import { getLogger } from "../../../lib/logger";

const log = getLogger("handlers.mesh");

interface MeshStatusMessage {
  type: "mesh:status";
  agents: import("../../../types").MeshAgentStatus[];
  teams?: import("../../../types").MeshTeamEntry[];
}

interface MeshTaskBoardMessage {
  type: "mesh:taskBoard";
  tasks: import("../../../types").MeshTaskEntry[];
}

interface MeshMessageMessage {
  type: "mesh:message";
  message: import("../../../types").MeshRecentMessage;
}

interface MeshAgentConnectedMessage {
  type: "mesh:agentConnected";
  agentId: string;
}

interface MeshAgentDisconnectedMessage {
  type: "mesh:agentDisconnected";
  agentId: string;
}

interface MeshPanelToggleMessage {
  type: "mesh:togglePanel";
  visible: boolean;
}

interface MeshTeamCreatedMessage {
  type: "mesh:teamCreated";
  team: import("../../../types").MeshTeamEntry;
}

interface MeshTeamUpdatedMessage {
  type: "mesh:teamUpdated";
  team: import("../../../types").MeshTeamEntry;
}

interface MeshStartTeamMessage {
  type: "mesh:startTeam";
  teamId: string;
  name: string;
  description: string;
  lead: { agentId: string; sessionId: string };
  members: Array<{ agentId: string; sessionId: string }>;
}

interface MeshOpenTeamCreateMessage {
  type: "mesh:openTeamCreate";
}

interface MeshAddMemberToTeamMessage {
  type: "mesh:addMemberToTeam";
  teamId: string;
  agentId: string;
}

interface MeshRemoveMemberFromTeamMessage {
  type: "mesh:removeMemberFromTeam";
  teamId: string;
  agentId: string;
}

function syncTeamSessions(team: {
  id: string;
  lead: { agentId: string; sessionId: string };
  members: Array<{ agentId: string; sessionId: string }>;
}): void {
  const sessionKeys = [
    sessionKeyOf(team.lead.agentId, team.lead.sessionId),
    ...team.members.map((m) => sessionKeyOf(m.agentId, m.sessionId)),
  ];
  useSessionStore.getState().setTeamSessions(team.id, sessionKeys);
}

export function handleMeshStatus(data: MeshStatusMessage): void {
  useMeshStore.getState().setAgentStatuses(data.agents);
  if (data.teams) {
    useMeshStore.getState().setTeams(data.teams);
    for (const team of data.teams) {
      syncTeamSessions(team);
    }
    log.debug("handleMeshStatus: synced team sessions", {
      teamCount: data.teams.length,
    });
  }
}

export function handleMeshTeamCreated(data: MeshTeamCreatedMessage): void {
  useMeshStore.getState().addTeam(data.team);
  syncTeamSessions(data.team);
  log.debug("handleMeshTeamCreated: synced team sessions", {
    teamId: data.team.id,
  });
}

export function handleMeshTaskBoard(data: MeshTaskBoardMessage): void {
  useMeshStore.getState().setTasks(data.tasks);
}

export function handleMeshMessage(data: MeshMessageMessage): void {
  useMeshStore.getState().addRecentMessage(data.message);
}

export function handleMeshAgentConnected(
  data: MeshAgentConnectedMessage
): void {
  getLogger("mesh").info("agent connected", { agentId: data.agentId });
}

export function handleMeshAgentDisconnected(
  data: MeshAgentDisconnectedMessage
): void {
  useMeshStore.getState().updateAgentStatus(data.agentId, {
    state: "disconnected",
  } as Partial<import("../../../types").MeshAgentStatus>);
}

export function handleMeshPanelToggle(data: MeshPanelToggleMessage): void {
  useMeshStore.getState().setMeshPanelVisible(data.visible);
}

export function handleMeshTeamUpdated(data: MeshTeamUpdatedMessage): void {
  useMeshStore.getState().updateTeam(data.team.id, data.team);
  syncTeamSessions(data.team);
  log.debug("handleMeshTeamUpdated: synced team sessions", {
    teamId: data.team.id,
  });
}

// No-ops (handled by extension host)
export function handleMeshStartTeam(_data: MeshStartTeamMessage): void {
  // No-op on webview side
}

export function handleMeshOpenTeamCreate(
  _data: MeshOpenTeamCreateMessage
): void {
  // No-op on webview side
}

export function handleMeshAddMemberToTeam(
  _data: MeshAddMemberToTeamMessage
): void {
  // No-op on webview side; extension host will send mesh:teamUpdated on success
}

export function handleMeshRemoveMemberFromTeam(
  _data: MeshRemoveMemberFromTeamMessage
): void {
  // No-op on webview side; extension host will send mesh:teamUpdated on success
}
