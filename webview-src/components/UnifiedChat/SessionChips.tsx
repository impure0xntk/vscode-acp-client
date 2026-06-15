import React, { useCallback } from "react";
import { useLogger } from "../../hooks/useLogger";
import { StatusIcon } from "../StatusIcon";

export interface SessionChipData {
  key: string;
  agentId: string;
  title: string;
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  color: string;
  unreadCount: number;
}

export interface SessionChipsProps {
  sessions: SessionChipData[];
  activeSessionKey: string | null;
  onSelect: (key: string) => void;
  onAdd: () => void;
}

export const SessionChips = React.memo(function SessionChips({
  sessions,
  activeSessionKey,
  onSelect,
  onAdd,
}: SessionChipsProps): React.ReactElement {
  const log = useLogger("SessionChips");

  const handleSelect = useCallback(
    (key: string) => {
      log.debug("chip select", { key });
      onSelect(key);
    },
    [onSelect, log],
  );

  const handleAdd = useCallback(() => {
    log.info("chip add — new session picker requested");
    onAdd();
  }, [onAdd, log]);

  log.debug("render", { count: sessions.length, activeSessionKey });

  return (
    <div className="session-chips-bar">
      {sessions.map((session) => {
        const isActive = session.key === activeSessionKey;
        return (
          <button
            key={session.key}
            className={`session-chip${isActive ? " session-chip--active" : ""}`}
            onClick={() => handleSelect(session.key)}
            type="button"
            style={{ borderLeftColor: session.color }}
          >
            <span className="session-chip-indicator" />
            <span className="session-chip-agent">{session.agentId}</span>
            <StatusIcon status={session.status} size="sm" />
            {session.unreadCount > 0 && (
              <span className="session-chip-unread">{session.unreadCount}</span>
            )}
          </button>
        );
      })}
      <button
        className="session-chip session-chip-add"
        onClick={handleAdd}
        type="button"
      >
        + Add
      </button>
    </div>
  );
});
