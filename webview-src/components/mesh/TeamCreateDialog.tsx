import React, { useState, useCallback, useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "../../store/sessionStore";
import type { SessionStoreState } from "../../store/sessionStore";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { Icon } from "../../lib/icons";

// ── Props ──────────────────────────────────────────────────────────

export interface TeamCreateDialogProps {
  onClose: () => void;
}

// ── Option types ────────────────────────────────────────────────────

interface AgentOption {
  kind: "agent";
  id: string;
  agentId: string;
  name: string;
  color?: string;
  sessionCount: number;
  sessions: SessionOption[];
}

interface SessionOption {
  kind: "session";
  id: string;
  agentId: string;
  sessionId: string;
  agentName: string;
  sessionTitle: string;
  color?: string;
  status: string;
}

// ── Component ───────────────────────────────────────────────────────

export function TeamCreateDialog({
  onClose,
}: TeamCreateDialogProps): React.ReactElement {
  const { connectedAgents, sessionInfoMap, tabTitles } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      connectedAgents: s.connectedAgents,
      sessionInfoMap: s.sessionInfoMap,
      tabTitles: s.tabTitles,
    }))
  );

  const [teamName, setTeamName] = useState("");
  const [description, setDescription] = useState("");
  const [lead, setLead] = useState<{
    agentId: string;
    sessionId: string;
  } | null>(null);
  const [members, setMembers] = useState<
    Array<{ agentId: string; sessionId: string }>
  >([]);
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // ── Build agent tree with nested sessions from sessionInfoMap ─────

  const agentOptions = useMemo((): AgentOption[] => {
    return connectedAgents.map((agent) => {
      const sessions: SessionOption[] = Object.entries(sessionInfoMap)
        .filter(([key]) => key.startsWith(`${agent.agentId}:`))
        .map(([key, info]) => ({
          kind: "session" as const,
          id: key,
          agentId: agent.agentId,
          sessionId: info.sessionId,
          agentName: agent.name ?? agent.agentId,
          sessionTitle: tabTitles[key] ?? info.sessionId,
          color: agent.color,
          status: info.status,
        }));
      return {
        kind: "agent" as const,
        id: agent.agentId,
        agentId: agent.agentId,
        name: agent.name ?? agent.agentId,
        color: agent.color,
        sessionCount: sessions.length,
        sessions,
      };
    });
  }, [connectedAgents, sessionInfoMap, tabTitles]);

  // ── Handlers ──────────────────────────────────────────────────────

  const memberKey = (agentId: string, sessionId: string) =>
    `${agentId}:${sessionId}`;

  const handleToggleMember = useCallback(
    (agentId: string, sessionId: string) => {
      setMembers((prev) => {
        const key = memberKey(agentId, sessionId);
        const exists = prev.some(
          (m) => memberKey(m.agentId, m.sessionId) === key
        );
        if (exists) {
          return prev.filter((m) => memberKey(m.agentId, m.sessionId) !== key);
        }
        return [...prev, { agentId, sessionId }];
      });
    },
    []
  );

  const handleSetLead = useCallback((agentId: string, sessionId: string) => {
    setLead({ agentId, sessionId });
    setMembers((prev) => {
      const key = memberKey(agentId, sessionId);
      if (prev.some((m) => memberKey(m.agentId, m.sessionId) === key))
        return prev;
      return [...prev, { agentId, sessionId }];
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (submitting) return;

    if (!teamName.trim()) {
      setError("Team name is required");
      return;
    }
    if (!lead) {
      setError("Lead is required");
      return;
    }

    if (members.length === 0) {
      setError("At least one member (the lead) must be selected");
      return;
    }

    setSubmitting(true);
    setError("");

    const teamId = `team-${Date.now()}`;

    getVsCodeApi().postMessage({
      type: "mesh:startTeam",
      teamId,
      name: teamName.trim(),
      description: description.trim(),
      lead,
      members,
    });

    onClose();
  }, [teamName, description, lead, members, onClose, submitting]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  // ── Render: Lead picker ───────────────────────────────────────────

  function renderLeadPicker() {
    const totalSessions = agentOptions.reduce(
      (sum, a) => sum + a.sessions.length,
      0
    );

    return (
      <div className="team-create-field">
        <label className="team-create-label">
          Lead <span className="team-create-required">*</span>
        </label>

        <div className="team-create-agent-list">
          {totalSessions === 0 ? (
            <div className="team-create-empty">
              <Icon name="info" size="sm" />
              <span>No active sessions. Connect agents first.</span>
            </div>
          ) : (
            agentOptions.map((agent) =>
              agent.sessions.map((session) => {
                const isLead =
                  lead?.agentId === session.agentId &&
                  lead?.sessionId === session.sessionId;
                return (
                  <button
                    key={`lead-sess-${session.id}`}
                    className={`team-create-agent-option team-create-agent-option--session${isLead ? " team-create-agent-option--selected" : ""}`}
                    onClick={() =>
                      handleSetLead(session.agentId, session.sessionId)
                    }
                    type="button"
                  >
                    <span
                      className="team-create-agent-color"
                      style={{ background: session.color ?? "var(--accent)" }}
                    />
                    <Icon
                      name={isLead ? "crown" : "layers"}
                      size="sm"
                      className="team-create-agent-icon"
                    />
                    <span className="team-create-agent-name">
                      {session.agentName}
                    </span>
                    <span className="team-create-session-id">
                      {session.sessionId.slice(0, 8)}
                    </span>
                    <span className="team-create-session-title">
                      {session.sessionTitle}
                    </span>
                    {isLead && (
                      <span className="team-create-agent-lead-badge">Lead</span>
                    )}
                  </button>
                );
              })
            )
          )}
        </div>
      </div>
    );
  }

  // ── Render: Member picker ─────────────────────────────────────────

  function renderMemberPicker() {
    const totalSessions = agentOptions.reduce(
      (sum, a) => sum + a.sessions.length,
      0
    );

    return (
      <div className="team-create-field">
        <label className="team-create-label">
          Members{" "}
          {members.length > 0 && (
            <span className="team-create-member-count">
              {members.length} selected
            </span>
          )}
        </label>

        <div className="team-create-agent-list">
          {totalSessions === 0 ? (
            <div className="team-create-empty">No sessions available</div>
          ) : (
            agentOptions.map((agent) =>
              agent.sessions.map((session) => {
                const isMember = members.some(
                  (m) =>
                    m.agentId === session.agentId &&
                    m.sessionId === session.sessionId
                );
                const isLead =
                  lead?.agentId === session.agentId &&
                  lead?.sessionId === session.sessionId;
                return (
                  <button
                    key={`member-sess-${session.id}`}
                    className={`team-create-agent-option team-create-agent-option--session${isMember ? " team-create-agent-option--selected" : ""}`}
                    onClick={() =>
                      handleToggleMember(session.agentId, session.sessionId)
                    }
                    disabled={isLead}
                    type="button"
                  >
                    <span
                      className="team-create-agent-color"
                      style={{ background: session.color ?? "var(--accent)" }}
                    />
                    {isLead ? (
                      <Icon
                        name="crown"
                        size="sm"
                        className="team-create-agent-icon"
                      />
                    ) : (
                      <Icon
                        name={isMember ? "check" : "circle-outline"}
                        size="sm"
                        className="team-create-agent-icon"
                      />
                    )}
                    <span className="team-create-agent-name">
                      {session.agentName}
                    </span>
                    <span className="team-create-session-id">
                      {session.sessionId.slice(0, 8)}
                    </span>
                    <span className="team-create-session-title">
                      {session.sessionTitle}
                    </span>
                    {isLead && (
                      <span className="team-create-agent-lead-badge">Lead</span>
                    )}
                  </button>
                );
              })
            )
          )}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div
      className="team-create-dialog-overlay"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="team-create-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create Team"
      >
        <div className="team-create-dialog-header">
          <div className="team-create-dialog-header-left">
            <Icon name="users" size="sm" />
            <span className="team-create-dialog-title">Create Team</span>
          </div>
          <button
            className="team-create-dialog-close"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>

        <div className="team-create-dialog-body">
          <div className="team-create-field">
            <label htmlFor="team-name" className="team-create-label">
              Team Name <span className="team-create-required">*</span>
            </label>
            <input
              id="team-name"
              className="team-create-input"
              value={teamName}
              onChange={(e) => {
                setTeamName(e.target.value);
                setError("");
              }}
              placeholder="e.g. Refactor Team"
              autoFocus
            />
          </div>

          <div className="team-create-field">
            <label htmlFor="team-desc" className="team-create-label">
              Description
            </label>
            <input
              id="team-desc"
              className="team-create-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — what is this team working on?"
            />
          </div>

          {renderLeadPicker()}
          {renderMemberPicker()}

          {error && (
            <div className="team-create-error" role="alert">
              <Icon name="circle-filled" size="sm" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="team-create-dialog-footer">
          <button
            className="team-create-cancel"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="team-create-submit"
            onClick={handleSubmit}
            disabled={agentOptions.length === 0 || submitting}
            type="button"
          >
            <Icon name={submitting ? "loading" : "pass-filled"} size="sm" />
            {submitting ? "Creating..." : "Create Team"}
          </button>
        </div>
      </div>
    </div>
  );
}
