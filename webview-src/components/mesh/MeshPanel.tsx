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
    <div className="rounded-[3px] overflow-hidden">
      <div
        className="flex items-center gap-1 py-1 px-2 cursor-pointer select-none hover:bg-accent-hover"
        onClick={onToggle}
        role="button"
        tabIndex={0}
      >
        <Icon
          name={isExpanded ? "chevron-down" : "chevron-right"}
          size="sm"
          className="flex-shrink-0 text-fg-muted"
        />
        <StatusIcon status={agent.state} size="sm" />
        <span className="text-[11px] font-semibold font-mono text-fg-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{agent.agentId}</span>
        {agent.role && (
          <span className={`text-[9px] px-1 rounded-[2px] uppercase font-semibold flex-shrink-0 ${agent.role === "lead" ? "bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning" : "bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-accent"}`}>
            {agent.role}
          </span>
        )}
        <span className="text-[9px] text-fg-muted flex-shrink-0">{stateLabel}</span>
        {agent.progress !== undefined && (
          <span className="text-[9px] text-fg-muted font-mono flex-shrink-0">{agent.progress}%</span>
        )}
      </div>

      {isExpanded && (
        <div className="py-0.5 px-2 pb-1 flex flex-col gap-0.5">
          {agent.sessions.map((s) => (
            <div key={s.sessionId} className="flex items-center gap-1 py-0.5 px-1 text-[10px] text-fg-secondary">
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
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{s.title}</span>
              <span className="font-mono text-[9px] text-fg-muted">{s.sessionId.slice(0, 8)}</span>
            </div>
          ))}
          {agent.currentTask && (
            <div className="flex items-center gap-1 py-0.5 px-1 text-[10px] text-fg-secondary">
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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[360px] max-w-[90vw] max-h-[60vh] flex flex-col bg-bg-secondary border border-border rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add Member"
      >
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border flex-shrink-0 text-[13px] font-semibold text-fg-primary">
          <Icon name="plus" size="sm" />
          <span>Add Member to {team.name}</span>
          <button
            className="ml-auto inline-flex items-center justify-center w-5.5 h-5.5 p-0 border-none rounded-[4px] bg-transparent text-fg-muted cursor-pointer hover:bg-error hover:text-user-fg"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3.5 py-3">
          {candidates.length === 0 ? (
            <div className="flex items-center gap-1.5 p-3 text-fg-muted text-[12px] italic">
              <Icon name="info" size="sm" />
              <span>No available sessions to add</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {candidates.map((s) => {
                const isSelected =
                  selected?.agentId === s.agentId &&
                  selected?.sessionId === s.sessionId;
                return (
                  <button
                    key={`${s.agentId}:${s.sessionId}`}
                    className={`flex items-center gap-2 py-1.5 px-2.5 border rounded-[4px] bg-transparent text-fg-primary text-[12px] cursor-pointer text-left hover:bg-accent-hover ${isSelected ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border-[color-mix(in_srgb,var(--accent)_30%,transparent)]" : "border-transparent"}`}
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
                    <span className="font-mono text-[10px] text-fg-muted flex-shrink-0 max-w-[60px] overflow-hidden text-ellipsis">
                      {s.sessionId.slice(0, 8)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-3.5 py-2.5 border-t border-border flex-shrink-0">
          <button
            className="py-1.5 px-3 border border-border rounded-[4px] bg-transparent text-fg-secondary text-[12px] cursor-pointer hover:bg-accent-hover hover:text-fg-primary"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-1.5 py-1.5 px-3.5 border-none rounded-[4px] bg-accent text-user-fg text-[12px] font-medium cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_80%,white)] disabled:opacity-50 disabled:cursor-not-allowed"
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
      className="flex flex-col gap-1 py-1 px-2 rounded-[3px] bg-bg-primary border border-transparent border-l-2 border-l-transparent"
      data-color-group={colorGroup}
      data-status={status}
    >
      <div className="flex items-center gap-1 min-w-0">
        <StatusIcon status={effective} size="sm" colorGroup={colorGroup} />
        <span className="text-[10px] font-semibold font-mono text-fg-primary flex-shrink-0">{agentId}</span>
        <span className="text-[9px] font-mono text-fg-muted flex-shrink-0">
          {sessionId.slice(0, 8)}
        </span>
        {isLead && (
          <span className="inline-flex items-center gap-0.5 text-[8px] px-1 rounded-[2px] bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning font-semibold uppercase flex-shrink-0">
            <Icon name="crown" size="xs" />
            Lead
          </span>
        )}
        {onRemove && !isLead && (
          <button
            className="inline-flex items-center justify-center w-3.5 h-3.5 p-0 border-none rounded-[2px] bg-transparent text-fg-muted cursor-pointer ml-auto opacity-0 hover:bg-error hover:text-user-fg focus-visible:opacity-100"
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
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-fg-muted px-1 rounded-[2px] bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)]">
          <Icon name="arrow-up" size="xs" />
          {inputTokens >= 1000
            ? `${(inputTokens / 1000).toFixed(1)}k`
            : inputTokens}
        </span>
        <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-fg-muted px-1 rounded-[2px] bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)]">
          <Icon name="arrow-down" size="xs" />
          {outputTokens >= 1000
            ? `${(outputTokens / 1000).toFixed(1)}k`
            : outputTokens}
        </span>
        {contextPct !== undefined && (
          <span
            className={`inline-flex items-center gap-0.5 text-[9px] font-mono px-1 rounded-[2px] bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] ${contextPct >= 85 ? "text-[#ef5350]" : contextPct >= 70 ? "text-[#ffd54f]" : "text-[#4fc3f7]"}`}
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
    <div className="rounded-[3px] overflow-hidden">
      <div
        className="flex items-center gap-1.5 py-1.5 px-2 cursor-pointer select-none hover:bg-accent-hover"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <Icon
          name={expanded ? "chevron-down" : "chevron-right"}
          size="sm"
          className="flex-shrink-0 text-fg-muted"
        />
        <span
          className="w-[7px] h-[7px] rounded-full flex-shrink-0"
          style={{ background: statusColor }}
        />
        <Icon name="users" size="sm" className="flex-shrink-0 text-fg-muted" />
        <span className="flex-1 min-w-0 text-[11px] font-semibold text-fg-primary overflow-hidden text-ellipsis whitespace-nowrap">{team.name}</span>
        <span className="text-[10px] text-fg-muted font-mono flex-shrink-0 px-1 rounded-[3px] bg-[color-mix(in_srgb,var(--fg-muted)_12%,transparent)]">{team.members.length}</span>
      </div>

      {expanded && (
        <div className="py-1 pl-6 pr-2 pb-1.5 flex flex-col gap-1">
          {team.description && (
            <div className="text-[10px] text-fg-secondary leading-relaxed">{team.description}</div>
          )}

          {/* Session status cards */}
          <div className="flex flex-col gap-1 mt-0.5">
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
          <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-[color-mix(in_srgb,var(--border)_30%,transparent)]">
            <button
              className="inline-flex items-center gap-1 py-1 px-2 border border-border rounded-[4px] bg-transparent text-fg-secondary text-[10px] cursor-pointer hover:bg-accent-hover hover:text-fg-primary hover:border-accent"
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
              className="inline-flex items-center gap-1 py-1 px-2 border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent text-[10px] cursor-pointer hover:bg-accent hover:text-user-fg hover:border-accent"
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

          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-[color-mix(in_srgb,var(--border)_30%,transparent)]">
            <span className="text-[9px] text-fg-muted font-mono">ID: {team.id.slice(0, 12)}</span>
            <span className="text-[9px] text-fg-muted font-mono">
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
      <div className="flex items-center justify-center gap-1.5 p-4 text-fg-muted text-[11px]">
        <Icon name="output" size="md" />
        <span>No tasks</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-1">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-1.5 py-1 px-2 rounded-[3px] bg-bg-primary">
          <Icon
            name={statusIcon(task.status)}
            size="sm"
            style={{ color: statusColor(task.status) }}
          />
          <span className="flex-1 min-w-0 text-[11px] text-fg-primary overflow-hidden text-ellipsis whitespace-nowrap">{task.title}</span>
          {task.assignedTo && (
            <span className="text-[9px] text-fg-muted font-mono flex-shrink-0">{task.assignedTo}</span>
          )}
          {task.progress !== undefined && (
            <div className="w-10 h-[3px] rounded-[1.5px] bg-border overflow-hidden flex-shrink-0">
              <div
                className="h-full rounded-[1.5px] bg-accent"
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
      <div className="flex items-center justify-center p-4 text-fg-muted text-[11px]">
        <span>No recent messages</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-px px-1">
      {messages.slice(-20).map((msg) => (
        <div key={msg.messageId} className="flex items-center gap-1 py-0.5 px-2 text-[10px] text-fg-secondary rounded-[2px] hover:bg-accent-hover">
          <span className="font-mono text-[9px] text-fg-muted flex-shrink-0">
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="font-semibold text-fg-primary flex-shrink-0">{msg.from}</span>
          <Icon name="chevron-right" size="sm" className="text-fg-muted flex-shrink-0" />
          <span className="text-fg-muted flex-shrink-0">{msg.to}</span>
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{msg.summary}</span>
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-secondary">
          <Icon name="list-tree" size="sm" />
          <span>Mesh</span>
        </div>
        {onClose && (
          <button
            className="inline-flex items-center justify-center w-5 h-5 p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer hover:bg-error hover:text-user-fg"
            onClick={onClose}
            title="Close Mesh Panel"
          >
            <Icon name="close" size="sm" />
          </button>
        )}
      </div>

      {/* Team create button — prominent CTA */}
      <button
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 border-none border-b border-border bg-transparent text-fg-secondary text-[11px] font-medium cursor-pointer hover:bg-accent-hover hover:text-fg-primary flex-shrink-0"
        onClick={() => onOpenTeamCreate?.()}
        title="Create a new team"
        type="button"
      >
        <Icon name="plus" size="sm" />
        <span>Create Team</span>
      </button>

      <div className="flex border-b border-border flex-shrink-0">
        <button
          className={`flex-1 py-1.5 px-2 border-none bg-transparent text-fg-muted text-[11px] cursor-pointer text-center hover:text-fg-secondary hover:bg-accent-hover ${activeTab === "teams" ? "text-fg-primary bg-bg-primary shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}
          onClick={() => setActiveTab("teams")}
        >
          <Icon name="users" size="sm" />
          Teams
          {teams.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 ml-1 rounded-[7px] bg-accent text-user-fg text-[9px] font-bold">{teams.length}</span>
          )}
        </button>
        <button
          className={`flex-1 py-1.5 px-2 border-none bg-transparent text-fg-muted text-[11px] cursor-pointer text-center hover:text-fg-secondary hover:bg-accent-hover ${activeTab === "agents" ? "text-fg-primary bg-bg-primary shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}
          onClick={() => setActiveTab("agents")}
        >
          Agents
          {agentStatuses.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 ml-1 rounded-[7px] bg-accent text-user-fg text-[9px] font-bold">{agentStatuses.length}</span>
          )}
        </button>
        <button
          className={`flex-1 py-1.5 px-2 border-none bg-transparent text-fg-muted text-[11px] cursor-pointer text-center hover:text-fg-secondary hover:bg-accent-hover ${activeTab === "tasks" ? "text-fg-primary bg-bg-primary shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}
          onClick={() => setActiveTab("tasks")}
        >
          Tasks
          {tasks.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 ml-1 rounded-[7px] bg-accent text-user-fg text-[9px] font-bold">{tasks.length}</span>
          )}
        </button>
        <button
          className={`flex-1 py-1.5 px-2 border-none bg-transparent text-fg-muted text-[11px] cursor-pointer text-center hover:text-fg-secondary hover:bg-accent-hover ${activeTab === "messages" ? "text-fg-primary bg-bg-primary shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}
          onClick={() => setActiveTab("messages")}
        >
          Log
          {recentMessages.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 ml-1 rounded-[7px] bg-accent text-user-fg text-[9px] font-bold">
              {recentMessages.length}
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {activeTab === "teams" && (
          <div className="flex flex-col gap-0.5 px-1">
            {teams.length === 0 ? (
              <div className="flex items-center justify-center p-4 text-fg-muted text-[11px]">
                <Icon name="users" size="md" />
                <span>No teams yet</span>
                <span className="text-[10px] text-fg-muted mt-0.5">
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
          <div className="flex flex-col gap-0.5 px-1">
            {agentStatuses.length === 0 ? (
              <div className="flex items-center justify-center p-4 text-fg-muted text-[11px]">
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
