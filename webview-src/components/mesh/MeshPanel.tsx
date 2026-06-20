import React, { useMemo, useState, useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useMeshStore } from "../../store/meshStore";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import { StatusIcon } from "../primitives/StatusIcon";
import { Icon } from "../../lib/icons";
import { getVsCodeApi } from "../../lib/vscodeApi";
import type {
  MeshAgentStatus,
  MeshTeamEntry,
  MeshTaskEntry,
  MeshRecentMessage,
} from "../types";
import type { SessionInfoDTO } from "../../store/sessionStore";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  effectiveStatus,
  sessionColorGroup,
} from "../sessions/overview/SessionOverviewCardBase";

// ── Props ──────────────────────────────────────────────────────────

export interface MeshPanelProps {
  onClose?: () => void;
  onOpenTeamCreate?: () => void;
  onPlanTeam?: (teamId: string) => void;
}

// ── Agent Tree Item ─────────────────────────────────────────────────

function AgentStatusRow({
  agent,
  isExpanded,
  onToggle,
}: {
  agent: MeshAgentStatus;
  isExpanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const stateLabel =
    agent.state === "working"
      ? "Working"
      : agent.state === "waiting"
        ? "Waiting"
        : agent.state === "error"
          ? "Error"
          : agent.state === "disconnected"
            ? "Disconnected"
            : "Idle";

  return (
    <div className="mesh-agent-row">
      <div
        className="mesh-agent-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
      >
        <Icon
          name={isExpanded ? "chevron-down" : "chevron-right"}
          size="sm"
          className="mesh-agent-toggle"
        />
        <StatusIcon status={agent.state} size="sm" />
        <span className="mesh-agent-name">{agent.agentId}</span>
        {agent.role && (
          <span className={`mesh-agent-role mesh-agent-role--${agent.role}`}>
            {agent.role}
          </span>
        )}
        <span className="mesh-agent-state">{stateLabel}</span>
        {agent.progress !== undefined && (
          <span className="mesh-agent-progress">{agent.progress}%</span>
        )}
      </div>

      {isExpanded && (
        <div className="mesh-agent-sessions">
          {agent.sessions.map((s) => (
            <div key={s.sessionId} className="mesh-session-item">
              <StatusIcon
                status={
                  s.status as
                    | "idle"
                    | "running"
                    | "completed"
                    | "error"
                    | "cancelled"
                }
                size="sm"
              />
              <span className="mesh-session-title">{s.title}</span>
              <span className="mesh-session-id">{s.sessionId.slice(0, 8)}</span>
            </div>
          ))}
          {agent.currentTask && (
            <div className="mesh-current-task">
              <Icon name="tools" size="sm" />
              <span>{agent.currentTask}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Member Dialog ───────────────────────────────────────────────

interface AddMemberDialogProps {
  team: MeshTeamEntry;
  availableSessions: Array<{
    agentId: string;
    sessionId: string;
    label: string;
  }>;
  onClose: () => void;
}

function AddMemberDialog({
  team,
  availableSessions,
  onClose,
}: AddMemberDialogProps): React.ReactElement {
  const [selected, setSelected] = useState<{
    agentId: string;
    sessionId: string;
  } | null>(null);

  const memberKeys = new Set(
    team.members.map((m) => `${m.agentId}:${m.sessionId}`)
  );
  const candidates = availableSessions.filter(
    (s) => !memberKeys.has(`${s.agentId}:${s.sessionId}`)
  );

  const handleAdd = useCallback(() => {
    if (!selected) return;
    getVsCodeApi().postMessage({
      type: "mesh:addMemberToTeam",
      teamId: team.id,
      agentId: selected.agentId,
      sessionId: selected.sessionId,
    });
    onClose();
  }, [selected, team.id, onClose]);

  return (
    <div className="team-add-member-overlay" onClick={onClose}>
      <div
        className="team-add-member-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add Member"
      >
        <div className="team-add-member-header">
          <Icon name="plus" size="sm" />
          <span>Add Member to {team.name}</span>
          <button
            className="team-add-member-close"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
        <div className="team-add-member-body">
          {candidates.length === 0 ? (
            <div className="team-add-member-empty">
              <Icon name="info" size="sm" />
              <span>No available sessions to add</span>
            </div>
          ) : (
            <div className="team-add-member-list">
              {candidates.map((s) => {
                const isSelected =
                  selected?.agentId === s.agentId &&
                  selected?.sessionId === s.sessionId;
                return (
                  <button
                    key={`${s.agentId}:${s.sessionId}`}
                    className={`team-add-member-option${isSelected ? " team-add-member-option--selected" : ""}`}
                    onClick={() =>
                      setSelected({
                        agentId: s.agentId,
                        sessionId: s.sessionId,
                      })
                    }
                    type="button"
                  >
                    <Icon
                      name={isSelected ? "check" : "circle-outline"}
                      size="sm"
                    />
                    <span>{s.label}</span>
                    <span className="team-add-member-session-id">
                      {s.sessionId.slice(0, 8)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="team-add-member-footer">
          <button
            className="team-add-member-cancel"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="team-add-member-submit"
            onClick={handleAdd}
            disabled={!selected}
            type="button"
          >
            <Icon name="plus" size="sm" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Team Session Card ───────────────────────────────────────────────

function TeamSessionCard({
  agentId,
  sessionId,
  isLead,
  agentColor,
  onRemove,
}: {
  agentId: string;
  sessionId: string;
  isLead: boolean;
  agentColor?: string;
  onRemove?: () => void;
}): React.ReactElement {
  const sessionKey = sessionKeyOf(agentId, sessionId);
  const liveInfo = useSessionInfo(sessionKey);

  const status = liveInfo?.status ?? "idle";
  const lastTurnOutcome = liveInfo?.lastTurnOutcome ?? null;
  const effective = effectiveStatus(status, lastTurnOutcome);
  const colorGroup = sessionColorGroup(status);

  const tokenTotal = liveInfo?.tokenUsage.totalTokens ?? 0;
  const inputTokens = liveInfo?.tokenUsage.inputTokens ?? 0;
  const outputTokens = liveInfo?.tokenUsage.outputTokens ?? 0;
  const contextMax = liveInfo?.contextWindowMax;
  const contextPct =
    contextMax != null && contextMax > 0
      ? Math.round((tokenTotal / contextMax) * 100)
      : undefined;

  return (
    <div
      className="mesh-team-session-card"
      data-color-group={colorGroup}
      data-status={status}
    >
      <div className="mesh-team-session-card-header">
        <StatusIcon status={effective} size="sm" colorGroup={colorGroup} />
        <span className="mesh-team-session-card-agent">{agentId}</span>
        <span className="mesh-team-session-card-sessionid">
          {sessionId.slice(0, 8)}
        </span>
        {isLead && (
          <span className="mesh-team-session-card-lead">
            <Icon name="crown" size="xs" />
            Lead
          </span>
        )}
        {onRemove && !isLead && (
          <button
            className="mesh-team-session-card-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title={`Remove ${agentId}:${sessionId.slice(0, 8)}`}
            type="button"
          >
            <Icon name="close" size="xs" />
          </button>
        )}
      </div>
      <div className="mesh-team-session-card-chips">
        <span className="mesh-team-session-chip">
          <Icon name="arrow-up" size="xs" />
          {inputTokens >= 1000
            ? `${(inputTokens / 1000).toFixed(1)}k`
            : inputTokens}
        </span>
        <span className="mesh-team-session-chip">
          <Icon name="arrow-down" size="xs" />
          {outputTokens >= 1000
            ? `${(outputTokens / 1000).toFixed(1)}k`
            : outputTokens}
        </span>
        {contextPct !== undefined && (
          <span
            className={`mesh-team-session-chip mesh-team-session-chip--ctx-${contextPct >= 85 ? "critical" : contextPct >= 70 ? "warning" : "normal"}`}
          >
            <Icon name="symbol-key" size="xs" />
            {contextPct}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── Team Row ────────────────────────────────────────────────────────

interface TeamRowProps {
  team: MeshTeamEntry;
  availableSessions: Array<{
    agentId: string;
    sessionId: string;
    label: string;
  }>;
  onPlanTeam: (teamId: string) => void;
}

function TeamRow({
  team,
  availableSessions,
  onPlanTeam,
}: TeamRowProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  const { connectedAgents } = useSessionStore(
    useShallow((s) => ({
      connectedAgents: s.connectedAgents,
    }))
  );

  const statusColor =
    team.status === "active"
      ? "var(--success)"
      : team.status === "paused"
        ? "var(--warning)"
        : "var(--fg-muted)";

  const handleRemoveMember = useCallback(
    (agentId: string, sessionId: string) => {
      getVsCodeApi().postMessage({
        type: "mesh:removeMemberFromTeam",
        teamId: team.id,
        agentId,
        sessionId,
      });
    },
    [team.id]
  );

  const agentColor = (agentId: string) =>
    connectedAgents.find((a) => a.agentId === agentId)?.color;

  // All sessions: lead first, then members (deduplicated)
  const allSessions = useMemo(() => {
    const lead = { ...team.lead, isLead: true };
    const members = team.members
      .filter(
        (m) =>
          !(m.agentId === team.lead.agentId && m.sessionId === team.lead.sessionId)
      )
      .map((m) => ({ ...m, isLead: false }));
    return [lead, ...members];
  }, [team.lead, team.members]);

  return (
    <div className="mesh-team-row">
      <div
        className="mesh-team-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <Icon
          name={expanded ? "chevron-down" : "chevron-right"}
          size="sm"
          className="mesh-team-toggle"
        />
        <span
          className="mesh-team-status-dot"
          style={{ background: statusColor }}
        />
        <Icon name="users" size="sm" className="mesh-team-icon" />
        <span className="mesh-team-name">{team.name}</span>
        <span className="mesh-team-member-count">{team.members.length}</span>
      </div>

      {expanded && (
        <div className="mesh-team-body">
          {team.description && (
            <div className="mesh-team-desc">{team.description}</div>
          )}

          {/* Session status cards */}
          <div className="mesh-team-session-cards">
            {allSessions.map((s) => (
              <TeamSessionCard
                key={`${s.agentId}:${s.sessionId}`}
                agentId={s.agentId}
                sessionId={s.sessionId}
                isLead={s.isLead}
                agentColor={agentColor(s.agentId)}
                onRemove={
                  s.isLead
                    ? undefined
                    : () => handleRemoveMember(s.agentId, s.sessionId)
                }
              />
            ))}
          </div>

          {/* Action buttons */}
          <div className="mesh-team-actions">
            <button
              className="mesh-team-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMember(true);
              }}
              title="Add member session"
              type="button"
            >
              <Icon name="plus" size="sm" />
              <span>Add Member</span>
            </button>
            <button
              className="mesh-team-action-btn mesh-team-action-btn--primary"
              onClick={(e) => {
                e.stopPropagation();
                onPlanTeam(team.id);
              }}
              title="Send plan to this team"
              type="button"
            >
              <Icon name="list-tree" size="sm" />
              <span>Plan</span>
            </button>
          </div>

          <div className="mesh-team-meta">
            <span className="mesh-team-id">ID: {team.id.slice(0, 12)}</span>
            <span className="mesh-team-created">
              {new Date(team.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      {showAddMember && (
        <AddMemberDialog
          team={team}
          availableSessions={availableSessions}
          onClose={() => setShowAddMember(false)}
        />
      )}
    </div>
  );
}

// ── Task Board ──────────────────────────────────────────────────────

function TaskBoard({ tasks }: { tasks: MeshTaskEntry[] }): React.ReactElement {
  const statusIcon = (status: MeshTaskEntry["status"]): string => {
    switch (status) {
      case "completed":
        return "pass-filled";
      case "in_progress":
        return "loading";
      case "failed":
        return "circle-filled";
      case "review":
        return "question";
      case "assigned":
        return "circle-filled";
      default:
        return "circle-outline";
    }
  };

  const statusColor = (status: MeshTaskEntry["status"]): string => {
    switch (status) {
      case "completed":
        return "#4ec9b0";
      case "in_progress":
        return "#4fc1ff";
      case "failed":
        return "#f14c4c";
      case "review":
        return "#cca700";
      case "assigned":
        return "#cca700";
      default:
        return "#666666";
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="mesh-task-board-empty">
        <Icon name="output" size="md" />
        <span>No tasks</span>
      </div>
    );
  }

  return (
    <div className="mesh-task-board">
      {tasks.map((task) => (
        <div key={task.id} className="mesh-task-item">
          <Icon
            name={statusIcon(task.status)}
            size="sm"
            style={{ color: statusColor(task.status) }}
          />
          <span className="mesh-task-title">{task.title}</span>
          {task.assignedTo && (
            <span className="mesh-task-assigned">{task.assignedTo}</span>
          )}
          {task.progress !== undefined && (
            <div className="mesh-task-progress-bar">
              <div
                className="mesh-task-progress-fill"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Recent Messages ─────────────────────────────────────────────────

function RecentMessages({
  messages,
}: {
  messages: MeshRecentMessage[];
}): React.ReactElement {
  if (messages.length === 0) {
    return (
      <div className="mesh-messages-empty">
        <span>No recent messages</span>
      </div>
    );
  }

  return (
    <div className="mesh-recent-messages">
      {messages.slice(-20).map((msg) => (
        <div key={msg.messageId} className="mesh-message-item">
          <span className="mesh-message-time">
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="mesh-message-from">{msg.from}</span>
          <Icon name="chevron-right" size="sm" className="mesh-message-arrow" />
          <span className="mesh-message-to">{msg.to}</span>
          <span className="mesh-message-summary">{msg.summary}</span>
        </div>
      ))}
    </div>
  );
}

// ── MeshPanel ───────────────────────────────────────────────────────

export function MeshPanel({
  onClose,
  onOpenTeamCreate,
  onPlanTeam,
}: MeshPanelProps): React.ReactElement {
  const { agentStatuses, teams, tasks, recentMessages } = useMeshStore(
    useShallow((s) => ({
      agentStatuses: s.agentStatuses,
      teams: s.teams,
      tasks: s.tasks,
      recentMessages: s.recentMessages,
    }))
  );

  const [expandedAgents, setExpandedAgents] = React.useState<Set<string>>(
    new Set()
  );
  const [activeTab, setActiveTab] = React.useState<
    "teams" | "agents" | "tasks" | "messages"
  >("teams");

  // All connected agent sessions for the add-member dialog
  const availableSessions = useMemo(
    () =>
      agentStatuses.flatMap((a) =>
        a.sessions.map((s) => ({
          agentId: a.agentId,
          sessionId: s.sessionId,
          label: `${a.agentId}:${s.sessionId.slice(0, 8)}`,
        }))
      ),
    [agentStatuses]
  );

  const handlePlanTeam = useCallback(
    (teamId: string) => {
      if (onPlanTeam) {
        onPlanTeam(teamId);
      }
    },
    [onPlanTeam]
  );

  const toggleAgent = React.useCallback((agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }, []);

  // Auto-expand agents with running sessions
  React.useEffect(() => {
    const running = agentStatuses
      .filter((a) => a.state === "working" || a.state === "waiting")
      .map((a) => a.agentId);
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      for (const id of running) next.add(id);
      return next;
    });
  }, [agentStatuses]);

  return (
    <div className="mesh-panel">
      <div className="mesh-panel-header">
        <div className="mesh-panel-title">
          <Icon name="list-tree" size="sm" />
          <span>Mesh</span>
        </div>
        {onClose && (
          <button
            className="mesh-panel-close"
            onClick={onClose}
            title="Close Mesh Panel"
          >
            <Icon name="close" size="sm" />
          </button>
        )}
      </div>

      {/* Team create button — prominent CTA */}
      <button
        className="mesh-panel-create-team"
        onClick={() => onOpenTeamCreate?.()}
        title="Create a new team"
        type="button"
      >
        <Icon name="plus" size="sm" />
        <span>Create Team</span>
      </button>

      <div className="mesh-panel-tabs">
        <button
          className={`mesh-panel-tab ${activeTab === "teams" ? "mesh-panel-tab--active" : ""}`}
          onClick={() => setActiveTab("teams")}
        >
          <Icon name="users" size="sm" />
          Teams
          {teams.length > 0 && (
            <span className="mesh-panel-tab-badge">{teams.length}</span>
          )}
        </button>
        <button
          className={`mesh-panel-tab ${activeTab === "agents" ? "mesh-panel-tab--active" : ""}`}
          onClick={() => setActiveTab("agents")}
        >
          Agents
          {agentStatuses.length > 0 && (
            <span className="mesh-panel-tab-badge">{agentStatuses.length}</span>
          )}
        </button>
        <button
          className={`mesh-panel-tab ${activeTab === "tasks" ? "mesh-panel-tab--active" : ""}`}
          onClick={() => setActiveTab("tasks")}
        >
          Tasks
          {tasks.length > 0 && (
            <span className="mesh-panel-tab-badge">{tasks.length}</span>
          )}
        </button>
        <button
          className={`mesh-panel-tab ${activeTab === "messages" ? "mesh-panel-tab--active" : ""}`}
          onClick={() => setActiveTab("messages")}
        >
          Log
          {recentMessages.length > 0 && (
            <span className="mesh-panel-tab-badge">
              {recentMessages.length}
            </span>
          )}
        </button>
      </div>

      <div className="mesh-panel-content">
        {activeTab === "teams" && (
          <div className="mesh-team-list">
            {teams.length === 0 ? (
              <div className="mesh-empty-state">
                <Icon name="users" size="md" />
                <span>No teams yet</span>
                <span className="mesh-empty-hint">
                  Create a team to coordinate multi-agent work
                </span>
              </div>
            ) : (
              teams.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  availableSessions={availableSessions}
                  onPlanTeam={handlePlanTeam}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "agents" && (
          <div className="mesh-agent-list">
            {agentStatuses.length === 0 ? (
              <div className="mesh-empty-state">
                <span>No agents connected</span>
              </div>
            ) : (
              agentStatuses.map((agent) => (
                <AgentStatusRow
                  key={agent.agentId}
                  agent={agent}
                  isExpanded={expandedAgents.has(agent.agentId)}
                  onToggle={() => toggleAgent(agent.agentId)}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "tasks" && <TaskBoard tasks={tasks} />}

        {activeTab === "messages" && (
          <RecentMessages messages={recentMessages} />
        )}
      </div>
    </div>
  );
}
