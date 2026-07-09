import React, { useCallback, useState, useEffect, useRef } from "react";
import type {
  SessionTabState,
  ConnectedAgentInfo,
} from "../../store/sessionStore";
import { sessionKeyOf } from "../../store/sessionStore";
import { StatusIcon } from "../primitives/StatusIcon";
import type { StatusIconType, TurnOutcome } from "../primitives/StatusIcon";
import { UnreadBadge } from "../primitives/UnreadBadge";
import { IconClose, IconPin, IconPinFilled, IconRows, IconColumns } from "../../lib/icons";
import { useSessionInfo } from "../../hooks/useSessionInfo";

export interface SessionTabBarProps {
  tabs: SessionTabState[];
  activeSessionKey: string | null;
  connectedAgents: ConnectedAgentInfo[];
  onTabClick: (sessionKey: string) => void;
  onTabClose: (sessionKey: string) => void;
  onNewSession: () => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  pinnedSessionKeys?: string[];
  onTogglePin?: (key: string) => void;
  splitDirection?: "horizontal" | "vertical";
  onSplitDirectionChange?: (direction: "horizontal" | "vertical") => void;
}

interface UnifiedTabProps {
  tab: SessionTabState;
  isActive: boolean;
  isPinned: boolean;
  agentColor?: string;
  unreadCount: number;
  onClick: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  onRename?: (agentId: string, sessionId: string, title: string) => void;
}

const UnifiedTab = React.memo(function UnifiedTab({
  tab,
  isActive,
  isPinned,
  agentColor,
  unreadCount,
  onClick,
  onClose,
  onTogglePin,
  onRename,
}: UnifiedTabProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.title);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sessionKey = sessionKeyOf(tab.agentId, tab.sessionId);
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

  // Inline rename state
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
      className={`inline-flex items-center gap-1 px-2 py-1 border border-transparent rounded bg-transparent text-[11px] whitespace-nowrap cursor-pointer shrink-0 transition-all duration-150${isActive ? " bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-fg-primary font-semibold" : " text-fg-secondary"}${isHovered && !isActive ? " bg-accent-hover" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        borderLeft: `3px solid ${agentColor ?? "transparent"}`,
        boxShadow: isActive
          ? `inset 0 -2px 0 0 ${agentColor ?? "var(--accent)"}`
          : "none",
      }}
    >
      <StatusIcon status={status} />
      <span
        className="font-semibold font-mono text-[11px] shrink-0"
        style={{ color: agentColor ?? "var(--vscode-descriptionForeground)" }}
        title={tab.agentId}
      >
        {tab.agentId}
      </span>
      {isRenaming ? (
        <input
          ref={renameInputRef}
          className="min-w-[40px] max-w-[100px] text-[11px] bg-transparent border border-accent rounded px-1 py-0 outline-none text-fg-primary"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={handleRenameKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="max-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap shrink min-w-0 text-[11px] text-fg-secondary"
          title={`${tab.title} (double-click to rename)`}
          onDoubleClick={(e) => {
            if (onRename && !isRenaming) {
              e.stopPropagation();
              setIsRenaming(true);
              setRenameValue(tab.title);
            }
          }}
        >
          {tab.title.length > 12 ? `${tab.title.slice(0, 12)}…` : tab.title}
        </span>
      )}
      {/* Pin button */}
      <button
        className="shrink-0 w-[18px] h-[18px] inline-flex items-center justify-center p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer transition-all duration-150 opacity-70 hover:bg-accent-hover hover:text-fg-primary"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={isPinned ? "Unpin session" : "Pin session"}
        type="button"
      >
        {isPinned ? (
          <IconPinFilled size={12} />
        ) : (
          <IconPin size={12} className="opacity-25" />
        )}
      </button>
      <UnreadBadge count={unreadCount} hidden={isActive} className="shrink-0" />
      {/* Close button */}
      <button
        className={`inline-flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-transparent text-fg-muted cursor-pointer shrink-0 transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:text-error ${isActive || isHovered ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close"
        type="button"
      >
        <IconClose size={12} />
      </button>
    </div>
  );
});

export const SessionTabBar = React.memo(function SessionTabBar({
  tabs,
  activeSessionKey,
  connectedAgents,
  onTabClick,
  onTabClose,
  onNewSession,
  onRenameSession,
  pinnedSessionKeys = [],
  onTogglePin = () => {},
  splitDirection = "horizontal",
  onSplitDirectionChange = () => {},
}: SessionTabBarProps): React.ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1 p-[4px 8px] overflow-x-auto bg-bg-secondary border-b border-border">
      <div className="flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const key = sessionKeyOf(tab.agentId, tab.sessionId);
          const isActive = key === activeSessionKey;
          const isPinned = pinnedSessionKeys.includes(key);
          const agent = connectedAgents.find((a) => a.agentId === tab.agentId);

          return (
            <UnifiedTab
              key={key}
              tab={tab}
              isActive={isActive}
              isPinned={isPinned}
              agentColor={agent?.color}
              unreadCount={0}
              onClick={() => onTabClick(key)}
              onClose={() => onTabClose(key)}
              onTogglePin={() => onTogglePin(key)}
              onRename={onRenameSession}
            />
          );
        })}
      </div>

      {/* Split direction toggle — only meaningful when multiple sessions are
          visible (pinned + focused). Shown as a small segmented control. */}
      <div className="shrink-0 flex items-center border border-border rounded-sm overflow-hidden">
        <button
          className={`flex items-center justify-center w-7 h-7 border-none bg-transparent cursor-pointer transition-colors duration-150${splitDirection === "horizontal" ? " bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-fg-primary" : " text-fg-muted hover:bg-accent-hover"}`}
          onClick={() => onSplitDirectionChange("horizontal")}
          type="button"
          title="Split side by side (horizontal)"
          aria-pressed={splitDirection === "horizontal"}
        >
          <IconColumns size={14} />
        </button>
        <button
          className={`flex items-center justify-center w-7 h-7 border-none bg-transparent cursor-pointer transition-colors duration-150 border-l border-border${splitDirection === "vertical" ? " bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-fg-primary" : " text-fg-muted hover:bg-accent-hover"}`}
          onClick={() => onSplitDirectionChange("vertical")}
          type="button"
          title="Split top and bottom (vertical)"
          aria-pressed={splitDirection === "vertical"}
        >
          <IconRows size={14} />
        </button>
      </div>

      <button
        className="shrink-0 flex items-center justify-center w-7 h-full min-h-[32px] border-none bg-transparent text-fg-secondary text-base cursor-pointer transition-colors duration-150"
        onClick={onNewSession}
        type="button"
        title="New session"
      >
        <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 500 }}>+</span>
      </button>
    </div>
  );
});
