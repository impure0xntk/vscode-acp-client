import React, { useState, useEffect, useRef, useCallback } from "react";
import type { SessionTabState } from "../../store/sessionStore";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { StatusIcon } from "../primitives/StatusIcon";
import type { StatusIconType, TurnOutcome } from "../primitives/StatusIcon";
import { UnreadBadge } from "../primitives/UnreadBadge";
import { getLogger } from "../../lib/logger";

const log = getLogger("webview.SessionTab");

interface SessionTabProps {
  tab: SessionTabState;
  isActive: boolean;
  isHovered: boolean;
  /** Agent color from connected agents list */
  agentColor?: string;
  /** Unread message count */
  unreadCount: number;
  onClick: () => void;
  onClose: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onRename?: (agentId: string, sessionId: string, title: string) => void;
}

export function SessionTab({
  tab,
  isActive,
  isHovered,
  agentColor,
  unreadCount,
  onClick,
  onClose,
  onMouseEnter,
  onMouseLeave,
  onRename,
}: SessionTabProps): React.ReactElement {
  const sessionKey = `${tab.agentId}:${tab.sessionId}`;
  const info = useSessionInfo(sessionKey);

  const rawStatus = info?.status ?? "idle";
  const lastOutcome: TurnOutcome | null = info?.lastTurnOutcome ?? null;

  const status: StatusIconType =
    rawStatus === "running"
      ? "running"
      : rawStatus === "idle" && lastOutcome
        ? lastOutcome
        : rawStatus === "idle"
          ? "idle"
          : rawStatus;

  const showCloseButton = isActive || isHovered;

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.title);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Sync rename value when tab.title changes externally
  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(tab.title);
    }
  }, [tab.title, isRenaming]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== tab.title && onRename) {
      onRename(tab.agentId, tab.sessionId, trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, tab.title, tab.agentId, tab.sessionId, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleRenameSubmit();
      } else if (e.key === "Escape") {
        setRenameValue(tab.title);
        setIsRenaming(false);
      }
    },
    [handleRenameSubmit, tab.title]
  );

  return (
    <div
      className={`group flex flex-col justify-center px-2.5 py-1 min-w-[120px] max-w-[280px] min-h-[48px] cursor-pointer select-none bg-transparent transition-colors duration-150 relative overflow-hidden border-r border-border focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent${isActive ? " bg-bg-primary" : ""}${isHovered ? " bg-bg-secondary" : ""}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ borderTop: `2px solid ${agentColor ?? "transparent"}` }}
    >
      {/* Row 1: Status + Agent name */}
      <div className="flex items-center gap-1 min-w-0 h-[18px]">
        <StatusIcon status={status} />
        <span
          className="text-[10px] font-semibold font-mono text-fg-secondary overflow-hidden text-ellipsis whitespace-nowrap leading-none"
          style={{ color: agentColor ?? "var(--vscode-descriptionForeground)" }}
          title={tab.agentId}
        >
          {tab.agentId}
        </span>
      </div>

      {/* Row 2: Session title */}
      <div
        className="flex items-center gap-1 min-w-0 h-[20px] mt-[2px]"
        onDoubleClick={(e) => {
          if (onRename && !isRenaming) {
            e.stopPropagation();
            setIsRenaming(true);
            setRenameValue(tab.title);
          }
        }}
        title={isRenaming ? "" : `${tab.title} (double-click to rename)`}
      >
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="text-[11px] bg-transparent border-none outline-none text-fg-primary w-full"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-fg-primary leading-[1.2]">{tab.title}</span>
        )}
      </div>

      {/* Unread badge */}
      <UnreadBadge
        count={unreadCount}
        hidden={isActive}
        className="absolute top-1.5 right-1 z-10 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-lg bg-accent text-user-fg text-[9px] font-bold leading-none shadow-[0_1px_3px_rgba(0,0,0,0.35)] pointer-events-none"
      />

      {/* Close button */}
      <div
        className={`absolute top-1 right-1 flex items-center gap-0.5 z-10 transition-opacity duration-150 ${showCloseButton ? "opacity-100" : "opacity-0"}`}
      >
        <button
          className="shrink-0 flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-bg-secondary text-fg-secondary text-xs leading-none cursor-pointer transition-colors duration-150 hover:bg-error hover:text-user-fg"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close session"
        >
          ×
        </button>
      </div>
    </div>
  );
}
