import React, { useCallback, useEffect, useRef, useState } from "react";
import { SessionChatContainer } from "../SessionChatContainer";
import { SessionHeader } from "../SessionHeader";
import { SessionStatusBar } from "../SessionStatusBar";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import type { ChatMessage } from "../../../types";
import type { TurnOutcome } from "../../primitives/StatusIcon";
import type { SessionHeaderProps } from "../SessionView";

export interface SessionSectionProps {
  sessionKey: string;
  isFocus: boolean;
  isPinned: boolean;
  layoutMode: "single" | "split" | "grid";
  splitDirection: "vertical" | "horizontal";
  splitIndex: number;
  splitTotal: number;
  splitRatios: number[];
  messages: ChatMessage[];
  tabTitles: Record<string, string>;
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onClose: (key: string) => void;
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
  turnStartedAtMap?: Record<string, string>;
  pendingMap?: Record<string, boolean>;
  renderHeader?: (props: SessionHeaderProps) => React.ReactNode;
  getSessionColor: (key: string) => string;
}

export const SessionSection = React.memo(function SessionSection({
  sessionKey,
  isFocus,
  isPinned,
  layoutMode,
  splitDirection,
  splitIndex,
  splitTotal,
  splitRatios,
  messages,
  tabTitles,
  onFocusChange,
  onPin,
  onUnpin,
  onClose,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
  turnStartedAtMap,
  pendingMap,
  renderHeader,
  getSessionColor,
}: SessionSectionProps): React.ReactElement | null {
  const info = useSessionInfo(sessionKey);
  const color = getSessionColor(sessionKey);

  const prevOutcomeRef = useRef<TurnOutcome | null | undefined>(undefined);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    const prev = prevOutcomeRef.current;
    const current = info?.lastTurnOutcome ?? null;
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
  }, [info?.lastTurnOutcome]);

  const handleAnimationEnd = useCallback(() => {
    setIsFlashing(false);
  }, []);

  const flashingStatus = isFlashing
    ? (info?.lastTurnOutcome ?? info?.status)
    : undefined;

  useEffect(() => {
    if (!info) {
      onClose(sessionKey);
    }
  }, [info, onClose, sessionKey]);

  if (!info) return null;

  const sectionClassName = [
    "unified-session-section",
    isFocus
      ? "unified-session-section--focus"
      : "unified-session-section--pinned",
    info.isStreaming ? "[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,#4fc3f7_30%,transparent)]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sectionStyle: React.CSSProperties | undefined = (() => {
    if (layoutMode === "split") {
      const ratio = splitRatios[splitIndex] ?? 1 / splitTotal;
      const pct = ratio * 100;
      if (splitDirection === "horizontal") {
        return {
          flex: `0 0 ${pct}%`,
          width: `${pct}%`,
          maxWidth: `${pct}%`,
          minWidth: "10%",
        };
      }
      return {
        flex: `0 0 ${pct}%`,
        height: `${pct}%`,
        maxHeight: `${pct}%`,
        minHeight: "10%",
      };
    }
    if (layoutMode === "grid") {
      const cols =
        splitTotal <= 1 ? 1 : splitTotal <= 2 ? 2 : splitTotal <= 4 ? 3 : 4;
      const pct = 100 / cols;
      return { flex: `0 0 ${pct}%`, maxWidth: `${pct}%` };
    }
    return undefined;
  })();

  const title = tabTitles[sessionKey] ?? info.sessionId.slice(0, 8);

  return (
    <div
      className={sectionClassName}
      data-flashing={flashingStatus}
      onAnimationEnd={handleAnimationEnd}
      style={sectionStyle}
    >
      {renderHeader ? (
        renderHeader({
          sessionKey,
          agentId: info.agentId,
          title,
          status: info.status,
          color,
          messageCount: messages.length,
          isActive: isFocus,
          isPinned,
          splitDirection,
          info,
          onTogglePin: () =>
            isPinned ? onUnpin(sessionKey) : onPin(sessionKey),
          onClose: () => onClose(sessionKey),
        })
      ) : (
        <SessionHeader
          sessionKey={sessionKey}
          agentId={info.agentId}
          title={title}
          status={info.status}
          color={color}
          messageCount={messages.length}
          isActive={isFocus}
          isPinned={isPinned}
          splitDirection={splitDirection}
          onClick={() => onFocusChange(sessionKey)}
          onTogglePin={() =>
            isPinned ? onUnpin(sessionKey) : onPin(sessionKey)
          }
          onClose={() => onClose(sessionKey)}
          info={info}
        />
      )}
      <div
        className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col"
        onClick={() => onFocusChange(sessionKey)}
      >
        <SessionChatContainer
          sessionKey={sessionKey}
          agentId={info.agentId}
          sessionId={info.sessionId}
          status={info.status}
          isActive={isFocus}
          color={color}
          scrollToMessageRef={scrollToMessageRef}
          forceScrollToBottomRef={forceScrollToBottomRef}
          scrollToUnreadRef={scrollToUnreadRef}
        />
      </div>
      <SessionStatusBar
        sessionKey={sessionKey}
        active={info.status === "running"}
        turnStartedAt={turnStartedAtMap?.[sessionKey]}
        pending={pendingMap?.[sessionKey] ?? false}
        queue={[]}
        onCancelQueue={() => {}}
      />
    </div>
  );
});
