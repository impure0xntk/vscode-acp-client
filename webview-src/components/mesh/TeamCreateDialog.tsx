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
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-fg-secondary">
          Lead <span className="text-error">*</span>
        </label>

        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {totalSessions === 0 ? (
            <div className="flex items-center gap-1.5 p-3 text-fg-muted text-[12px] italic">
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
                    className={`flex items-center gap-2 py-1.5 px-2.5 border rounded-[4px] bg-transparent text-fg-primary text-[12px] cursor-pointer text-left hover:bg-accent-hover focus-visible:outline focus-visible:outline-accent focus-visible:outline-offset-[-1px] ${isLead ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border-[color-mix(in_srgb,var(--accent)_30%,transparent)]" : "border-transparent"}`}
                    onClick={() =>
                      handleSetLead(session.agentId, session.sessionId)
                    }
                    type="button"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: session.color ?? "var(--accent)" }}
                    />
                    <Icon
                      name={isLead ? "crown" : "layers"}
                      size="sm"
                      className="flex-shrink-0 text-fg-muted"
                    />
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]">
                      {session.agentName}
                    </span>
                    <span className="font-mono text-[10px] text-fg-muted flex-shrink-0 max-w-[60px] overflow-hidden text-ellipsis">
                      {session.sessionId.slice(0, 8)}
                    </span>
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-fg-muted">
                      {session.sessionTitle}
                    </span>
                    {isLead && (
                      <span className="text-[9px] px-1.5 py-px rounded-[3px] bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning font-semibold uppercase flex-shrink-0">Lead</span>
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
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-fg-secondary">
          Members{" "}
          {members.length > 0 && (
            <span className="text-[10px] text-fg-muted font-normal ml-1">
              {members.length} selected
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {totalSessions === 0 ? (
            <div className="flex items-center gap-1.5 p-3 text-fg-muted text-[12px] italic">No sessions available</div>
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
                    className={`flex items-center gap-2 py-1.5 px-2.5 border rounded-[4px] bg-transparent text-fg-primary text-[12px] cursor-pointer text-left hover:bg-accent-hover focus-visible:outline focus-visible:outline-accent focus-visible:outline-offset-[-1px] disabled:opacity-60 disabled:cursor-default ${isMember ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border-[color-mix(in_srgb,var(--accent)_30%,transparent)]" : "border-transparent"}`}
                    onClick={() =>
                      handleToggleMember(session.agentId, session.sessionId)
                    }
                    disabled={isLead}
                    type="button"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: session.color ?? "var(--accent)" }}
                    />
                    {isLead ? (
                      <Icon
                        name="crown"
                        size="sm"
                        className="flex-shrink-0 text-fg-muted"
                      />
                    ) : (
                      <Icon
                        name={isMember ? "check" : "circle-outline"}
                        size="sm"
                        className="flex-shrink-0 text-fg-muted"
                      />
                    )}
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]">
                      {session.agentName}
                    </span>
                    <span className="font-mono text-[10px] text-fg-muted flex-shrink-0 max-w-[60px] overflow-hidden text-ellipsis">
                      {session.sessionId.slice(0, 8)}
                    </span>
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-fg-muted">
                      {session.sessionTitle}
                    </span>
                    {isLead && (
                      <span className="text-[9px] px-1.5 py-px rounded-[3px] bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning font-semibold uppercase flex-shrink-0">Lead</span>
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
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[480px] max-w-[90vw] max-h-[80vh] flex flex-col bg-bg-secondary border border-border rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create Team"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Icon name="users" size="sm" />
            <span className="text-sm font-semibold text-fg-primary">Create Team</span>
          </div>
          <button
            className="inline-flex items-center justify-center w-6 h-6 p-0 border-none rounded-[4px] bg-transparent text-fg-muted cursor-pointer hover:bg-error hover:text-user-fg"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="team-name" className="text-[11px] font-semibold text-fg-secondary">
              Team Name <span className="text-error">*</span>
            </label>
            <input
              id="team-name"
              className="py-1.5 px-2.5 border border-border rounded-[4px] bg-bg-input text-fg-primary text-[13px] outline-none focus:border-accent placeholder:text-fg-muted"
              value={teamName}
              onChange={(e) => {
                setTeamName(e.target.value);
                setError("");
              }}
              placeholder="e.g. Refactor Team"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="team-desc" className="text-[11px] font-semibold text-fg-secondary">
              Description
            </label>
            <input
              id="team-desc"
              className="py-1.5 px-2.5 border border-border rounded-[4px] bg-bg-input text-fg-primary text-[13px] outline-none focus:border-accent placeholder:text-fg-muted"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — what is this team working on?"
            />
          </div>

          {renderLeadPicker()}
          {renderMemberPicker()}

          {error && (
            <div className="flex items-center gap-1.5 py-2 px-3 rounded-[4px] bg-[color-mix(in_srgb,var(--error)_10%,transparent)] border border-[color-mix(in_srgb,var(--error)_20%,transparent)] text-error text-[12px]" role="alert">
              <Icon name="circle-filled" size="sm" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
          <button
            className="py-1.5 px-3.5 border border-border rounded-[4px] bg-transparent text-fg-secondary text-[12px] cursor-pointer hover:bg-accent-hover hover:text-fg-primary"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-1.5 py-1.5 px-4 border-none rounded-[4px] bg-accent text-user-fg text-[12px] font-medium cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_80%,white)] disabled:opacity-50 disabled:cursor-not-allowed"
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
