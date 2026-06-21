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
  onRename?: (agentId: string, sessionId: string, title: string) => void;
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
  onRename,
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

  // ── Flash border on turn complete ─────────────────────────────────
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

  const flashAnimClass =
    isFlashing &&
    (info?.lastTurnOutcome === "completed" ||
      info?.lastTurnOutcome === "error")
      ? "animate-usec-flash-border"
      : "";

  const flashColor =
    info?.lastTurnOutcome === "error"
      ? "var(--error)"
      : info?.lastTurnOutcome === "cancelled"
        ? "var(--warning)"
        : "var(--success)";

  useEffect(() => {
    if (!info) {
      onClose(sessionKey);
    }
  }, [info, onClose, sessionKey]);

  if (!info) return null;

  const sectionClassName = [
    "unified-session-section",
    isFocus
      ? "flex-1"
      : "flex-none",
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
      className={`${sectionClassName} ${flashAnimClass} flex flex-col min-h-0 h-full`}
      onAnimationEnd={handleAnimationEnd}
      style={{
        ...sectionStyle,
        ...(isFlashing ? { "--usec-flash-color": flashColor } : {}),
      }}
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
          onRename,
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
          onRename={onRename}
          info={info}
        />
      )}
      <div
        className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col min-h-0"
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
      <div className="shrink-0">
        <SessionStatusBar
          sessionKey={sessionKey}
          active={info.status === "running"}
          turnStartedAt={turnStartedAtMap?.[sessionKey]}
          pending={pendingMap?.[sessionKey] ?? false}
          queue={[]}
          onCancelQueue={() => {}}
        />
      </div>
    </div>
  );
});
