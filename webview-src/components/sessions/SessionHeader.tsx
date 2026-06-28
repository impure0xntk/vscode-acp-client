import React, { useCallback, useState, useRef, useEffect } from "react";
import { useLogger } from "../../hooks/useLogger";
import type { AgentInfo, SessionInfoDTO } from "../../store/sessionStore";
import { useSessionStore } from "../../store/sessionStore";
import { ContextBar } from "../primitives/SendTargetChip";
import { StatusIcon } from "../primitives/StatusIcon";
import type { TurnOutcome } from "../primitives/StatusIcon";
import { SectionDetailsPanel } from "./toolbar";
import { Icon, IconPin, IconPinFilled } from "../../lib/icons";
import { abbreviatePath } from "../../lib/path";

export interface SessionHeaderProps {
  sessionKey: string | null;
  agentId?: string;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  onRename?: (agentId: string, sessionId: string, title: string) => void;
  messageCount?: number;
  info?: SessionInfoDTO;
  isActive?: boolean;
  color?: string;
  onForkSession?: () => void;
}

export const SessionHeader = React.memo(function SessionHeader({
  sessionKey,
  agentId,
  isPinned,
  onTogglePin,
  onClose,
  onRename,
  messageCount = 0,
  info,
  isActive,
  color,
  onForkSession,
}: SessionHeaderProps): React.ReactElement {
  const log = useLogger("SessionHeader");
  const agentInfo = useSessionStore((s) =>
    agentId ? s.agentInfoMap[agentId] : undefined
  );

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Sync rename value from info.title or info.sessionId when not renaming
  useEffect(() => {
    if (!isRenaming && info) {
      const currentTitle = info.title ?? info.sessionId ?? agentId ?? "";
      if (renameValue !== currentTitle) {
        setRenameValue(currentTitle);
      }
    }
  }, [isRenaming, info, info?.title, info?.sessionId, agentId, renameValue]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    const currentTitle = info?.title ?? info?.sessionId ?? "";
    if (trimmed && trimmed !== currentTitle && onRename && agentId) {
      onRename(agentId, info?.sessionId ?? "", trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, info?.title, info?.sessionId, onRename, agentId]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleRenameSubmit();
      } else if (e.key === "Escape") {
        setRenameValue(info?.title ?? info?.sessionId ?? "");
        setIsRenaming(false);
      }
    },
    [handleRenameSubmit, info?.title, info?.sessionId]
  );

  return renderUnifiedHeader();

  function renderUnifiedHeader(): React.ReactElement {
    const handleClick = useCallback(() => {
      log.debug("header click", { sessionKey, agentId, isActive });
    }, [log, sessionKey, agentId, isActive]);

    const handleTogglePin = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        log.debug("pin toggle", { sessionKey, isPinned: !isPinned });
        onTogglePin?.();
      },
      [onTogglePin, log, sessionKey, isPinned]
    );

    const handleClose = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        log.info("close section", { sessionKey });
        onClose?.();
      },
      [onClose, log, sessionKey]
    );

    // Turn outcome — icon only, no label
    const turnStatus: TurnOutcome | "running" | null = (() => {
      if (info?.status === "running") return "running";
      if (info?.lastTurnOutcome === "completed") return "completed";
      if (info?.lastTurnOutcome === "error") return "error";
      if (info?.lastTurnOutcome === "cancelled") return "cancelled";
      return null;
    })();

    const displayTitle = info?.title ?? info?.sessionId?.slice(0, 8) ?? agentId ?? "";
    const displayCwd = info?.cwd ? abbreviatePath(info.cwd, 24) : undefined;

    return (
      <div
        className={`flex items-center gap-1 shrink-0 bg-bg-secondary border-b border-border min-h-[32px] relative${isActive ? "" : ""}`}
        data-color={color}
        style={{
          "--section-accent-color": color,
          ...(isActive ? { backgroundColor: `${color}18` } : {}),
        } as React.CSSProperties}
      >
        <div className="absolute top-0 bottom-0 left-0 w-[3px] bg-[var(--section-accent-color,var(--accent))] shrink-0 z-10 pointer-events-none" aria-hidden="true" />
        <button
          className="flex-1 flex items-center gap-2 px-2 py-1 border-none bg-transparent text-fg-primary text-[11px] cursor-pointer text-left min-w-0 transition-colors duration-150"
          onClick={handleClick}
          type="button"
        >
          <span
            className="font-semibold font-mono text-[11px] shrink-0"
            style={{ color: color ?? "var(--vscode-descriptionForeground)" }}
          >
            {agentId}
          </span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="flex-1 min-w-[40px] text-[11px] bg-transparent border border-accent rounded px-1 py-0 outline-none text-fg-primary"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-mono text-fg-primary"
              title={`${displayTitle} (double-click to rename)`}
              onDoubleClick={(e) => {
                if (onRename && !isRenaming) {
                  e.stopPropagation();
                  setIsRenaming(true);
                  setRenameValue(displayTitle);
                }
              }}
            >
              {displayTitle}
            </span>
          )}
          {displayCwd && (
            <span
              className="shrink-0 font-mono text-[10px] text-fg-muted max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap"
              title={info?.cwd}
            >
              {displayCwd}
            </span>
          )}
          <span className="inline-flex items-center gap-[3px] ml-auto shrink-0 overflow-hidden">
            {turnStatus && <StatusIcon status={turnStatus} size="sm" />}
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <ContextBar tokenUsage={info?.tokenUsage} contextWindowMax={info?.contextWindowMax} />
          {info && (
            <ExpandButton
              info={info}
              messageCount={messageCount}
              onForkSession={onForkSession}
            />
          )}
          {onTogglePin && (
            <button
              className={`inline-flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-fg-muted cursor-pointer hover:bg-accent-hover hover:text-fg-primary${isPinned ? " text-accent" : ""}`}
              onClick={handleTogglePin}
              type="button"
              title={isPinned ? "Unpin session" : "Pin session"}
            >
              {isPinned ? <IconPinFilled size={14} /> : <IconPin size={14} />}
            </button>
          )}
          {onClose && (
            <button
              className="inline-flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-fg-muted cursor-pointer hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:text-error"
              onClick={handleClose}
              type="button"
              title="Close session"
            >
              <Icon name="close" size="sm" />
            </button>
          )}
        </div>
      </div>
    );
  }

  function ExpandButton({
    info,
    messageCount,
    onForkSession,
  }: {
      info: SessionInfoDTO;
    messageCount: number;
    onForkSession?: () => void;
  }): React.ReactElement {
    const [open, setOpen] = useState(false);

    const handleToggle = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        log.debug("toggle details", { sessionKey, open: !open });
        setOpen((v) => !v);
      },
      [log, sessionKey, open]
    );

    return (
      <div className="relative inline-flex items-center">
        <button
          className="inline-flex items-center justify-center w-6 h-6 p-0 border-none rounded bg-transparent text-fg-muted cursor-pointer hover:bg-accent-hover hover:text-fg-primary"
          onClick={handleToggle}
          type="button"
          title={open ? "Hide details" : "Show details"}
          aria-expanded={open}
          aria-label="Toggle session details"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d={open ? "M3 9L7 5L11 9" : "M3 5L7 9L11 5"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div
          className={`absolute top-full right-0 z-50 mt-1 bg-bg-secondary border border-border rounded shadow-[0_4px_16px_rgba(0,0,0,0.3)] min-w-[320px] transition-all duration-150${open ? " opacity-100 visible translate-y-0" : " opacity-0 invisible -translate-y-1"}`}
        >
          <div className="px-2.5 py-2 max-h-[300px] overflow-y-auto">
            <SectionDetailsPanel
              info={info}
              messageCount={messageCount}
              onForkSession={onForkSession}
              agentInfo={agentInfo}
            />
          </div>
        </div>
      </div>
    );
  }

});
