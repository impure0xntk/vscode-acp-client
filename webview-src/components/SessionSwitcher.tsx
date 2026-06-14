import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { SessionTabState } from "../store/sessionStore";
import { useUiStateStore } from "../store/uiStateStore";
import { useMessageStore } from "../store/messageStore";
import { StatusIcon } from "./StatusIcon";

// ============================================================================
// Props
// ============================================================================

interface SessionSwitcherProps {
  tabs: SessionTabState[];
  activeSessionId: string | null;
  onSelect: (sessionId: string, agentId: string) => void;
}

// ============================================================================
// SessionSwitcher Component
// ============================================================================

export function SessionSwitcher({
  tabs,
  activeSessionId,
  onSelect,
}: SessionSwitcherProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const handleSelect = useCallback(
    (sessionId: string, agentId: string) => {
      onSelect(sessionId, agentId);
      setIsOpen(false);
    },
    [onSelect]
  );

  // Group tabs by agent
  const grouped = new Map<string, SessionTabState[]>();
  for (const tab of tabs) {
    const list = grouped.get(tab.agentId) ?? [];
    list.push(tab);
    grouped.set(tab.agentId, list);
  }

  const activeTab = tabs.find((t) => t.sessionId === activeSessionId);

  // Derive unread counts — read via getState() to avoid subscribing to
  // the entire uiStates/perSession objects (prevents infinite update loops).
  const unreadMap = useMemo(() => {
    const uiStore = useUiStateStore.getState();
    const msgStore = useMessageStore.getState();
    const map = new Map<string, number>();
    for (const tab of tabs) {
      const key = `${tab.agentId}:${tab.sessionId}`;
      const ids = (msgStore.perSession[key] ?? []).map((m) => m.id);
      map.set(key, uiStore.computeUnreadCount(key, ids));
    }
    return map;
  }, [tabs]);

  return (
    <div className="session-switcher" ref={ref}>
      <button
        className="session-switcher-trigger"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title="Switch session"
      >
        <span className="switcher-current">
          {activeTab ? (
            <>
              <StatusIcon status={activeTab.status} />
              <span className="switcher-title">{activeTab.title}</span>
              <span className="switcher-agent">{activeTab.agentId}</span>
            </>
          ) : (
            <span className="switcher-placeholder">No session</span>
          )}
        </span>
        <span className={`switcher-arrow ${isOpen ? "open" : ""}`}>▾</span>
      </button>

      {isOpen && (
        <div className="session-switcher-dropdown" role="listbox">
          {grouped.size === 0 ? (
            <div className="switcher-empty">No sessions available</div>
          ) : (
            Array.from(grouped.entries()).map(([agentId, sessions]) => (
              <div key={agentId} className="switcher-group">
                <div className="switcher-group-header">{agentId}</div>
                {sessions.map((s) => {
                  const isActive = s.sessionId === activeSessionId;
                  return (
                    <div
                      key={`${s.agentId}:${s.sessionId}`}
                      className={`switcher-item ${isActive ? "active" : ""}`}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelect(s.sessionId, s.agentId)}
                    >
                      <StatusIcon status={s.status} />
                      <span className="switcher-item-title" title={s.title}>
                        {s.title}
                      </span>
                      {(unreadMap.get(`${s.agentId}:${s.sessionId}`) ?? 0) > 0 && (
                        <span className="switcher-item-badge">
                          {unreadMap.get(`${s.agentId}:${s.sessionId}`) ?? 0}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
