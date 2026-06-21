import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { SessionTabState } from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import { StatusIcon } from "../primitives/StatusIcon";
import type { StatusIconType } from "../primitives/StatusIcon";

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

  // Unread counts: precise tracking is local to ChatArea.
  // For the switcher dropdown, show 0 (no per-tab scroll state in Zustand).
  const unreadMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const tab of tabs) {
      map.set(`${tab.agentId}:${tab.sessionId}`, 0);
    }
    return map;
  }, [tabs]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex items-center gap-[6px] px-[10px] py-1 border border-border rounded bg-bg-input text-fg-primary cursor-pointer text-xs whitespace-nowrap max-w-[220px]"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title="Switch session"
      >
        <span className="flex items-center gap-[6px] flex-1 min-w-0">
          {activeTab ? (
            <>
              <StatusIcon status={activeTab.status ?? "idle"} />
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{activeTab.title}</span>
              <span className="text-[10px] text-fg-muted shrink-0">{activeTab.agentId}</span>
            </>
          ) : (
            <span className="text-fg-muted">No session</span>
          )}
        </span>
        <span className={`shrink-0 text-2xs transition-colors duration-150${isOpen ? " rotate-180" : ""}`}>▾</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 min-w-[240px] mt-1 bg-bg-secondary border border-border rounded shadow-[0_4px_12px_rgba(0,0,0,0.3)] z-[100] max-h-[300px] overflow-y-auto" role="listbox">
          {grouped.size === 0 ? (
            <div className="p-3 text-fg-muted text-center text-xs">No sessions available</div>
          ) : (
            Array.from(grouped.entries()).map(([agentId, sessions]) => (
              <div key={agentId} className="py-1">
                <div className="px-3 py-1 text-[11px] font-semibold text-fg-muted uppercase tracking-[0.5px]">{agentId}</div>
                {sessions.map((s) => {
                  const isActive = s.sessionId === activeSessionId;
                  return (
                    <div
                      key={`${s.agentId}:${s.sessionId}`}
                      className={`flex items-center gap-1.5 px-2 py-[5px] text-xs cursor-pointer hover:bg-accent-hover${isActive ? " text-accent" : ""}`}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelect(s.sessionId, s.agentId)}
                    >
                      <StatusIcon status={s.status ?? "idle"} />
                      <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg-primary" title={s.title}>
                        {s.title}
                      </span>
                      <span className="shrink-0 text-3xs text-fg-muted">{s.agentId}</span>
                      {(unreadMap.get(`${s.agentId}:${s.sessionId}`) ?? 0) >
                        0 && (
                        <span className="shrink-0 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-[8px] bg-accent text-user-fg text-[10px] font-semibold leading-none">
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
