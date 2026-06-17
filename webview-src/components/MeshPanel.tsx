import React, { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useMeshStore } from "../store/meshStore";
import { useSessionStore } from "../store/sessionStore";
import { StatusIcon } from "./StatusIcon";
import { Icon } from "../lib/icons";
import type {
  MeshAgentStatus,
  MeshTaskEntry,
  MeshRecentMessage,
} from "../types";

// ── Props ──────────────────────────────────────────────────────────

export interface MeshPanelProps {
  onClose?: () => void;
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

/**
 * MeshPanel — sidebar panel showing agent status, task board, and recent messages.
 *
 * Design (from Section 5.3 of mesh-orchestrator-integration-design.md):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 🌐 Mesh Panel                                                  │
 * │                                                                 │
 * │ ▼ 👑 Claude Code (Lead)                                        │
 * │   ├─ 📝 refactor-auth (active) ████████░░ 45%                 │
 * │   ├─ 📝 fix-login-bug         ██████░░░░ 30%                 │
 * │   └─ 📝 add-tests             ██░░░░░░░░ 10%                 │
 * │                                                                 │
 * │ ▼ 🔧 Codex (Worker)                                            │
 * │   ├─ 📝 implement-oauth       ✅ completed                    │
 * │   └─ 📝 update-docs           ⏳ running...                   │
 * │                                                                 │
 * │ ─────────────────────────────────────────────────────────────── │
 * │ Recent Messages:                                                │
 * │ 14:01 → Codex: task_request "Implement OAuth2"                 │
 * │ 14:03 ← Codex: task_response "completed"                      │
 * └─────────────────────────────────────────────────────────────────┘
 */
export function MeshPanel({ onClose }: MeshPanelProps): React.ReactElement {
  const { agentStatuses, tasks, recentMessages } = useMeshStore(
    useShallow((s) => ({
      agentStatuses: s.agentStatuses,
      tasks: s.tasks,
      recentMessages: s.recentMessages,
    }))
  );

  const [expandedAgents, setExpandedAgents] = React.useState<Set<string>>(
    new Set()
  );
  const [activeTab, setActiveTab] = React.useState<
    "agents" | "tasks" | "messages"
  >("agents");

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

      <div className="mesh-panel-tabs">
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
          Messages
          {recentMessages.length > 0 && (
            <span className="mesh-panel-tab-badge">
              {recentMessages.length}
            </span>
          )}
        </button>
      </div>

      <div className="mesh-panel-content">
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
