import React, { useCallback, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useLogger } from "../../hooks/useLogger";
import { useSessionStore } from "../../store/sessionStore";
import type { SessionStoreState } from "../../store/sessionStore";
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
  onAdd: (sessionKey: string) => void;
}

export const SessionChips = React.memo(function SessionChips({
  sessions,
  activeSessionKey,
  onSelect,
  onAdd,
}: SessionChipsProps): React.ReactElement {
  const log = useLogger("SessionChips");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const { tabOrder, connectedAgents } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabOrder: s.tabOrder,
      connectedAgents: s.connectedAgents,
    }))
  );

  // Sessions not yet pinned (not in the chips list)
  const availableSessions = useMemo(
    () =>
      tabOrder.filter(
        (key) => !sessions.some((chip) => chip.key === key)
      ),
    [tabOrder, sessions],
  );

  const handleSelect = useCallback(
    (key: string) => {
      log.debug("chip select", { key });
      onSelect(key);
    },
    [onSelect, log],
  );

  const handleAddClick = useCallback(() => {
    log.info("chip add — opening session picker");
    setPickerOpen(true);
  }, [log]);

  const handlePickerClose = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const handlePickSession = useCallback(
    (key: string) => {
      log.info("session picked from picker", { key });
      setPickerOpen(false);
      onAdd(key);
    },
    [onAdd, log],
  );

  // Close picker on outside click
  React.useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  log.debug("render", { count: sessions.length, activeSessionKey, pickerOpen });

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
      <div className="session-chips-add-wrapper" ref={pickerRef}>
        <button
          className="session-chip session-chip-add"
          onClick={handleAddClick}
          type="button"
        >
          + Add
        </button>
        {pickerOpen && (
          <div className="session-chips-picker">
            {availableSessions.length === 0 && (
              <div className="session-chips-picker-empty">
                No more sessions to add
              </div>
            )}
            {availableSessions.map((key) => {
              const [agentId, sessionId] = key.split(":");
              const agent = connectedAgents.find((a) => a.agentId === agentId);
              return (
                <button
                  key={key}
                  className="session-chips-picker-item"
                  onClick={() => handlePickSession(key)}
                  type="button"
                >
                  <span
                    className="session-chips-picker-dot"
                    style={{ backgroundColor: agent?.color ?? "#0e639c" }}
                  />
                  <span className="session-chips-picker-agent">{agentId}</span>
                  <span className="session-chips-picker-session">
                    {sessionId.slice(0, 12)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
