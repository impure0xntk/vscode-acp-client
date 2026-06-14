import React, { useEffect, useRef, useCallback } from "react";
import { StatusIcon } from "../StatusIcon";

interface MentionSession {
  key: string;
  agentId: string;
  sessionId: string;
  title: string;
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  color: string;
}

export interface MentionPickerProps {
  query: string;
  sessions: MentionSession[];
  onSelect: (session: { agentId: string; sessionId: string; key: string }) => void;
  onClose: () => void;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  registerKeyHandler: (handler: ((e: KeyboardEvent) => void) | null) => void;
}

export const MentionPicker = React.memo(function MentionPicker({
  query,
  sessions,
  onSelect,
  onClose,
  selectedIndex,
  onSelectedIndexChange,
  registerKeyHandler,
}: MentionPickerProps): React.ReactElement {
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = sessions.filter((s) => {
    const q = query.toLowerCase();
    return (
      s.agentId.toLowerCase().includes(q) ||
      s.sessionId.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q)
    );
  });

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onSelectedIndexChange(Math.min(selectedIndex + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          onSelect({ agentId: item.agentId, sessionId: item.sessionId, key: item.key });
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onSelectedIndexChange, onSelect, onClose]
  );

  useEffect(() => {
    registerKeyHandler(handleKeyDown);
    return () => registerKeyHandler(null);
  }, [handleKeyDown, registerKeyHandler]);

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <ul className="mention-picker-list" ref={listRef} role="listbox">
      {filtered.map((session, idx) => (
        <li
          key={session.key}
          className={`mention-picker-item${idx === selectedIndex ? " mention-picker-item--selected" : ""}`}
          style={{ borderLeftColor: session.color }}
          role="option"
          aria-selected={idx === selectedIndex}
          onClick={() =>
            onSelect({
              agentId: session.agentId,
              sessionId: session.sessionId,
              key: session.key,
            })
          }
          onMouseEnter={() => onSelectedIndexChange(idx)}
        >
          <StatusIcon status={session.status} size="sm" />
          <span className="mention-picker-agent">{session.agentId}</span>
          {session.sessionId && (
            <span className="mention-picker-session">#{session.sessionId}</span>
          )}
          {session.title && (
            <span className="mention-picker-title">{session.title}</span>
          )}
        </li>
      ))}
      {filtered.length === 0 && (
        <li className="mention-picker-empty">No matching sessions</li>
      )}
    </ul>
  );
});
