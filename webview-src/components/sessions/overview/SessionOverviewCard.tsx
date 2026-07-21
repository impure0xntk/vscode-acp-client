import React, { useEffect, useRef, useState, useCallback } from "react";
import type { SessionOverviewItem } from "../../../types";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import { UnreadBadge } from "../../primitives/UnreadBadge";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  SessionOverviewFooter,
  ResponsePreviewList,
  sessionColorGroup,
  elapsedTier,
  snapshotToOverviewItem,
} from "./SessionOverviewCardBase";
import { MessageHistoryPreview } from "./MessageHistoryPreview";
import { useSessionStore } from "../../../store/sessionStore";
import { useRecentMessages } from "../../../hooks/useRecentMessages";
import type { TurnOutcome } from "../../primitives/StatusIcon";
import { IconClose } from "../../../lib/icons";

// Subscribes to its own session info so it re-renders only when its session changes.

interface Props {
  session: SessionOverviewItem;
  /** Agent color for the badge dot — looked up by parent from connectedAgents */
  agentColor?: string;
  isExpanded: boolean;
  unreadCount?: number;
  isActive: boolean;
  isSelected: boolean;
  selectionMode: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onCancel: () => void;
  onClose: (sessionId: string, agentId: string) => void;
  onSelect: (sessionId: string) => void;
  /** Long-press: enter selection mode and select this session */
  onLongPress: (sessionId: string) => void;
  /** Expand: drill down to this session's message history (MiniChat only) */
  onExpand?: () => void;
}

const LONG_PRESS_MS = 500;

export function SessionOverviewCard({
  session,
  agentColor,
  isExpanded,
  unreadCount = 0,
  isActive,
  isSelected,
  selectionMode,
  onToggle,
  onFocus,
  onCancel,
  onClose,
  onSelect,
  onLongPress,
  onExpand,
}: Props): React.ReactElement {
  const sessionKey = `${session.agentId}:${session.sessionId}`;
  const liveInfo = useSessionInfo(sessionKey);
  const recentMessages = useRecentMessages(sessionKey, isExpanded ? 6 : 4);

  const liveItem: SessionOverviewItem = liveInfo
    ? snapshotToOverviewItem(liveInfo, session.title)
    : session;

  const status = liveItem.status as string;
  const isCancelable =
    status === "running" ||
    status === "waiting" ||
    status === "waiting_for_input";

  const tier = elapsedTier(liveItem.progress.elapsedMs);

  const effectiveOutcome = liveItem.lastTurnOutcome;

  const prevOutcomeRef = useRef<TurnOutcome | null | undefined>(undefined);
  const [isFlashing, setIsFlashing] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    const prev = prevOutcomeRef.current;
    const current = liveItem.lastTurnOutcome;

    if (prev === undefined) {
      prevOutcomeRef.current = current;
      return;
    }

    const isTerminal =
      current === "completed" || current === "error" || current === "cancelled";
    const isNew = current !== prev;

    if (isTerminal && isNew) {
      setIsFlashing(true);
    }

    prevOutcomeRef.current = current;
  }, [liveItem.lastTurnOutcome]);

  const handleAnimationEnd = useCallback(() => {
    setIsFlashing(false);
  }, []);

  const flashingStatus = isFlashing
    ? (liveItem.lastTurnOutcome ?? liveItem.status)
    : undefined;

  const handlePointerDown = useCallback(() => {
    didLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      onLongPress(session.sessionId);
    }, LONG_PRESS_MS);
  }, [session.sessionId, onLongPress]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (didLongPressRef.current) {
      return;
    }
    if (selectionMode) {
      onSelect(session.sessionId);
    } else {
      onFocus();
    }
  }, [selectionMode, onSelect, session.sessionId, onFocus]);

  // Double-click (single click still focuses/switches) triggers drill-down.
  const handleDoubleClick = useCallback(() => {
    if (didLongPressRef.current) return;
    onExpand?.();
  }, [onExpand]);

  const statusValue =
    liveItem.status === "idle" && effectiveOutcome
      ? effectiveOutcome
      : liveItem.status;

  const colorGroup = sessionColorGroup(liveItem.status);

  const borderLeftClass =
    {
      active: "border-l-[#4fc3f7]",
      waiting: "border-l-[#ffd54f]",
      error: "border-l-error",
      done: "border-l-transparent",
    }[colorGroup] ?? "border-l-transparent";

  const animClass = (() => {
    if (flashingStatus === "completed") return "animate-soc-flash-border";
    if (tier === "critical") return "animate-soc-elapsed-critical-pulse";
    if (tier === "warning") return "animate-soc-elapsed-warning-pulse";
    if (colorGroup === "active") return "animate-soc-running-pulse";
    return "";
  })();

  return (
    <div
      className={`session-overview-card p-[6px 8px] m-[2px 4px] bg-bg-primary border border-[transparent] border-l border-[transparent] rounded-md cursor-pointer hover:border-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1 ${borderLeftClass}${isExpanded ? " bg-bg-secondary" : ""}${isActive ? " bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}${isSelected ? " border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : ""}${animClass}`}
      onAnimationEnd={handleAnimationEnd}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (selectionMode) {
            onSelect(session.sessionId);
          } else {
            onFocus();
          }
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SessionOverviewHeader session={liveItem} agentColor={agentColor} />
        </div>
        <button
          className="inline-flex shrink-0 items-center justify-center p-[0] w-[20px] h-[20px] text-xs text-fg-muted bg-transparent border-none rounded-sm cursor-pointer hover:text-user-fg hover:bg-error"
          type="button"
          aria-label="Close session"
          onClick={(e) => {
            e.stopPropagation();
            onClose(session.sessionId, session.agentId);
          }}
        >
          <IconClose size={10} />
        </button>
      </div>

      <SessionOverviewChips session={liveItem} />

      <div className="flex w-full gap-1.5 mt-1">
        <div className="flex-1 min-w-0">
          <ResponsePreviewList
            responses={liveItem.recentResponses}
            maxItems={isExpanded ? 5 : 3}
          />
        </div>
        <div className="flex-1 min-w-[180px] max-w-none md:max-w-[50%] shrink-0">
          <MessageHistoryPreview
            messages={recentMessages}
            maxItems={isExpanded ? 6 : 4}
          />
        </div>
      </div>

      <div className="flex flex-col gap-0.5 mt-1">
        <div className="flex items-center justify-between pt-1 border-t border-[color-mix(in_srgb,var(--border)_30%,transparent)]">
          <span className="text-[9px] text-fg-muted font-[var(--font-mono)]">
            {new Date(
              liveItem.lastResponseAt ?? liveItem.createdAt
            ).toLocaleTimeString()}
          </span>

          <div className="flex items-center gap-0.5 shrink-0">
            <UnreadBadge
              count={unreadCount}
              hidden={isActive}
              className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-[8px] bg-accent text-user-fg text-[9px] font-bold leading-none shadow-[0_1px_3px_rgba(0,0,0,0.35)] pointer-events-none shrink-0 ml-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
