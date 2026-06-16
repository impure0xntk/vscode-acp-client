import React, { useCallback, useRef, useState } from "react";
import { useLogger } from "../../hooks/useLogger";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import {
  SessionOverviewHeader,
  SessionOverviewChips,
  ResponsePreviewList,
} from "../SessionOverview/SessionOverviewCardBase";
import { UnreadBadge } from "../ui/UnreadBadge";
import { IconPinFilled, IconClose } from "../../lib/icons";
import type { TurnOutcome } from "../StatusIcon";
import type { SessionOverviewItem, SessionProgress } from "../../types";

// ============================================================================
// UnifiedSessionOverviewCard — compact card for the Unified session bar
//
// Displays a single session's live overview: status icon, agent badge, title,
// chips (tokens, duration), and recent response previews. Clicking the card
// focuses the session. Pin indicator and close button are rendered inline.
// ============================================================================

export interface UnifiedSessionOverviewCardProps {
  /** Session key `${agentId}:${sessionId}` */
  sessionKey: string;
  /** Snapshot from the store for structural data (only needed when data isn't available via useSessionInfo) */
  overview?: SessionOverviewItem;
  /** Whether this session is the active focus */
  isActive: boolean;
  /** Whether this session is pinned in the split view */
  isPinned: boolean;
  unreadCount?: number;
  agentColor?: string;
  onClick: (key: string) => void;
  onClose: (key: string) => void;
}

// ── Helper: derive SessionOverviewItem snapshot from SessionInfoDTO ────────

function deriveSnapshotFromInfo(
  liveInfo: NonNullable<ReturnType<typeof useSessionInfo>>,
): SessionOverviewItem {
  const progress: SessionProgress = {
    elapsedMs:
      liveInfo.status === "running" && liveInfo.lastResponseAt
        ? Date.now() - new Date(liveInfo.lastResponseAt).getTime()
        : 0,
    tokenUsage: {
      input: liveInfo.tokenUsage.inputTokens,
      output: liveInfo.tokenUsage.outputTokens,
      total: liveInfo.tokenUsage.totalTokens,
    },
    contextWindow:
      liveInfo.contextWindowMax != null
        ? {
            used: liveInfo.tokenUsage.totalTokens,
            max: liveInfo.contextWindowMax,
            percentage: Math.round(
              (liveInfo.tokenUsage.totalTokens / liveInfo.contextWindowMax) * 100,
            ),
          }
        : undefined,
    messageCount: 0,
    toolCallCount: 0,
    toolCallsCompleted: 0,
  };

  return {
    sessionId: liveInfo.sessionId,
    agentId: liveInfo.agentId,
    title: liveInfo.sessionId,
    status: liveInfo.status,
    lastTurnOutcome: liveInfo.lastTurnOutcome,
    model: liveInfo.model,
    mode: liveInfo.mode,
    progress,
    recentResponses: [],
    cwd: liveInfo.cwd,
    createdAt: liveInfo.createdAt,
    lastResponseAt: liveInfo.lastResponseAt,
  };
}

// ── Component ──────────────────────────────────────────────────────────

export const UnifiedSessionOverviewCard = React.memo(
  function UnifiedSessionOverviewCard({
    sessionKey,
    overview: overviewProp,
    isActive,
    isPinned,
    unreadCount = 0,
    agentColor,
    onClick,
    onClose,
  }: UnifiedSessionOverviewCardProps): React.ReactElement | null {
    const log = useLogger("UnifiedSessionOverviewCard");
    const liveInfo = useSessionInfo(sessionKey);
    const [isHovered, setIsHovered] = useState(false);

    // Derive the item from liveInfo + optional prop snapshot.
    // When the overview prop is provided, merge live state on top.
    // When it is missing, derive everything from liveInfo.
    const item: SessionOverviewItem | null = (() => {
      if (overviewProp) {
        return liveInfo
          ? {
              ...overviewProp,
              status: liveInfo.status,
              lastTurnOutcome: liveInfo.lastTurnOutcome,
              progress: {
                ...overviewProp.progress,
                tokenUsage: {
                  input: liveInfo.tokenUsage.inputTokens,
                  output: liveInfo.tokenUsage.outputTokens,
                  total: liveInfo.tokenUsage.totalTokens,
                },
              },
              lastResponseAt: liveInfo.lastResponseAt,
            }
          : overviewProp;
      }
      return liveInfo ? deriveSnapshotFromInfo(liveInfo) : null;
    })();

    if (!item) return null;

    const rawStatus = item.status;
    const lastOutcome: TurnOutcome | null = item.lastTurnOutcome ?? null;
    const effectiveOutcome = rawStatus === "idle" && lastOutcome ? lastOutcome : rawStatus;

    const handleClick = useCallback(() => {
      log.debug("card click → focus", { sessionKey });
      onClick(sessionKey);
    }, [onClick, sessionKey, log]);

    const handleClose = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        log.info("card close", { sessionKey });
        onClose(sessionKey);
      },
      [onClose, sessionKey, log],
    );

    const cardClassName = [
      "unified-session-overview-card",
      isActive ? "unified-session-overview-card--active" : "",
      isPinned ? "unified-session-overview-card--pinned" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        className={cardClassName}
        data-status={effectiveOutcome}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick();
        }}
      >
        {/* Header row: status + agent + title + pin + close */}
        <div className="unified-session-overview-card-header">
          <div className="unified-session-overview-card-title-row">
            <SessionOverviewHeader
              session={item}
              agentColor={agentColor}
              className="unified-session-overview-card-header-inner"
            />
          </div>
          <div className="unified-session-overview-card-actions">
            {(isPinned || isHovered) && (
              <IconPinFilled size={12} className="unified-session-overview-card-pin" title="Pinned" />
            )}
            {isHovered && (
              <button
                className="unified-session-overview-card-close"
                onClick={handleClose}
                type="button"
                title="Close"
              >
                <IconClose size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Chips row */}
        <SessionOverviewChips session={item} />

        {/* Response preview */}
        <ResponsePreviewList
          responses={item.recentResponses}
          maxItems={3}
          className="unified-session-overview-card-responses"
        />

        {/* Footer: timestamp + unread badge */}
        <div className="unified-session-overview-card-footer">
          <span className="unified-session-overview-card-timestamp">
            {item.lastResponseAt
              ? new Date(item.lastResponseAt).toLocaleTimeString()
              : new Date(item.createdAt).toLocaleTimeString()}
          </span>
          <UnreadBadge count={unreadCount} hidden={isActive} />
        </div>
      </div>
    );
  },
);
