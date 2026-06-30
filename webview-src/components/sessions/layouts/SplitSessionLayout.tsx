import React, { useCallback, useRef, useEffect, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "../../../store/sessionStore";
import type { SessionStoreState } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { getLogger } from "../../../lib/logger";
import { SessionChatContainer } from "../SessionChatContainer";
import { SessionHeader } from "../SessionHeader";
import { SessionStatusBar } from "../SessionStatusBar";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import type { ChatMessage } from "../../../types";
import type { TurnOutcome } from "../../primitives/StatusIcon";
import type { SessionHeaderProps } from "../SessionView";

interface SessionSectionInnerProps {
  sessionKey: string;
  isFocus: boolean;
  isPinned: boolean;
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
  onAttachDiff?: (
    attachment: import("../../../types").ContextAttachment
  ) => void;
}

const SessionSectionInner = React.memo(function SessionSectionInner({
  sessionKey,
  isFocus,
  isPinned,
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
  onAttachDiff,
}: SessionSectionInnerProps): React.ReactElement | null {
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

  const flashAnimClass =
    isFlashing &&
    (info?.lastTurnOutcome === "completed" || info?.lastTurnOutcome === "error")
      ? "animate-usec-flash-border"
      : "";

  const flashColor =
    info?.lastTurnOutcome === "error"
      ? "var(--error)"
      : info?.lastTurnOutcome === "cancelled"
        ? "var(--warning)"
        : "var(--success)";

  if (!info) return null;

  const sectionClassName = [
    "unified-session-section",
    isFocus ? "flex-1" : "flex-none",
    info.isStreaming
      ? "[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,#4fc3f7_30%,transparent)]"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const ratio = splitRatios[splitIndex] ?? 1 / splitTotal;
  const pct = ratio * 100;
  const sectionStyle: React.CSSProperties = {
    flex: `0 0 ${pct}%`,
    width: `${pct}%`,
    maxWidth: `${pct}%`,
    minWidth: "10%",
  };

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
          color,
          messageCount: messages.length,
          isActive: isFocus,
          isPinned,
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
          color={color}
          messageCount={messages.length}
          isActive={isFocus}
          isPinned={isPinned}
          onTogglePin={() =>
            isPinned ? onUnpin(sessionKey) : onPin(sessionKey)
          }
          onClose={() => onClose(sessionKey)}
          onRename={onRename}
          info={info}
        />
      )}
      <div
        className="flex-1 min-h-0 min-w-0 flex flex-col min-h-0"
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
          onAttachDiff={onAttachDiff}
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

const log = getLogger("SplitSessionLayout");

export interface SplitSessionLayoutProps {
  focusKey: string | null;
  pinnedKeys: string[];
  splitRatios: number[];
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onClose: (key: string) => void;
  onRename?: (agentId: string, sessionId: string, title: string) => void;
  onSplitRatiosChange: (ratios: number[]) => void;
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
  turnStartedAtMap?: Record<string, string>;
  pendingMap?: Record<string, boolean>;
  renderHeader?: (props: SessionHeaderProps) => React.ReactNode;
  getSessionColor: (key: string) => string;
  onAttachDiff?: (
    attachment: import("../../../types").ContextAttachment
  ) => void;
}

export const SplitSessionLayout = React.memo(function SplitSessionLayout({
  focusKey,
  pinnedKeys,
  splitRatios,
  onFocusChange,
  onPin,
  onUnpin,
  onClose,
  onRename,
  onSplitRatiosChange,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
  turnStartedAtMap,
  pendingMap,
  renderHeader,
  getSessionColor,
  onAttachDiff,
}: SplitSessionLayoutProps): React.ReactElement | null {
  const { tabTitles } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabTitles: s.tabTitles,
    }))
  );

  const visibleKeys: string[] = [];
  for (const k of pinnedKeys) {
    visibleKeys.push(k);
  }
  if (focusKey && !pinnedKeys.includes(focusKey)) {
    visibleKeys.push(focusKey);
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    dividerIndex: number;
    startPos: number;
    startRatios: number[];
  } | null>(null);

  const handleDividerMouseDown = useCallback(
    (dividerIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const currentRatios =
        splitRatios.length >= visibleKeys.length
          ? [...splitRatios]
          : Array(visibleKeys.length).fill(1 / visibleKeys.length);
      dragStateRef.current = {
        dividerIndex,
        startPos: e.clientX,
        startRatios: currentRatios,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      log.debug("divider drag start", { dividerIndex });
    },
    [splitRatios, visibleKeys.length]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const delta = (e.clientX - drag.startPos) / rect.width;

      const newRatios = [...drag.startRatios];
      const i = drag.dividerIndex;
      const minRatio = 0.1;
      const newI = Math.max(
        minRatio,
        Math.min(1 - minRatio, newRatios[i] + delta)
      );
      const d = newI - newRatios[i];
      newRatios[i] = newI;
      if (i + 1 < newRatios.length) {
        newRatios[i + 1] = Math.max(minRatio, newRatios[i + 1] - d);
      }
      const sum = newRatios.reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (let j = 0; j < newRatios.length; j++) {
          newRatios[j] /= sum;
        }
      }
      onSplitRatiosChange(newRatios);
    };
    const handleMouseUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onSplitRatiosChange]);

  if (visibleKeys.length === 0) {
    log.debug("no visible sessions — rendering empty state");
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden items-center justify-center text-xs text-fg-muted">
        <p>No sessions pinned. Pin a session to see it here.</p>
      </div>
    );
  }

  const allMessages = useMessageStore.getState().perSession;

  const effectiveRatios = computeEffectiveRatios(
    splitRatios,
    visibleKeys.length
  );

  function computeEffectiveRatios(ratios: number[], count: number): number[] {
    if (count <= 0) return [];
    if (ratios.length === count) {
      const sum = ratios.reduce((a, b) => a + b, 0);
      if (sum > 0) return ratios.map((r) => r / sum);
    }
    return Array(count).fill(1 / count);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden h-full">
      <div
        className="flex flex-col flex-1 min-h-0 overflow-hidden h-full flex-row items-stretch"
        ref={containerRef}
      >
        {visibleKeys.map((key, i) => {
          const isFocus = key === focusKey;
          const section = (
            <SessionSectionInner
              key={key}
              sessionKey={key}
              isFocus={isFocus}
              isPinned={pinnedKeys.includes(key)}
              splitIndex={visibleKeys.indexOf(key)}
              splitTotal={visibleKeys.length}
              splitRatios={effectiveRatios}
              messages={allMessages[key] ?? []}
              tabTitles={tabTitles}
              turnStartedAtMap={turnStartedAtMap}
              pendingMap={pendingMap}
              onFocusChange={onFocusChange}
              onPin={onPin}
              onUnpin={onUnpin}
              onClose={onClose}
              onRename={onRename}
              scrollToMessageRef={scrollToMessageRef}
              forceScrollToBottomRef={forceScrollToBottomRef}
              scrollToUnreadRef={scrollToUnreadRef}
              renderHeader={renderHeader}
              getSessionColor={getSessionColor}
              onAttachDiff={onAttachDiff}
            />
          );
          if (i === visibleKeys.length - 1) return section;
          return (
            <React.Fragment key={key}>
              {section}
              <div
                className="shrink-0 w-[4px] h-auto cursor-col-resize self-stretch transition-colors duration-150 hover:bg-accent"
                onMouseDown={handleDividerMouseDown(i)}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});
