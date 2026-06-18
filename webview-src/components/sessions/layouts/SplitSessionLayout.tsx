import React, { useCallback, useRef, useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "../../../store/sessionStore"
import type { SessionStoreState } from "../../../store/sessionStore"
import { useMessageStore } from "../../../store/messageStore"
import { getLogger } from "../../../lib/logger"
import { SessionSection } from "./SessionSection";
import type { SessionHeaderProps } from "../SessionView";

const log = getLogger("SplitSessionLayout");

export interface SplitSessionLayoutProps {
  focusKey: string | null;
  pinnedKeys: string[];
  layoutMode: "split";
  splitDirection: "vertical" | "horizontal";
  splitRatios: number[];
  onFocusChange: (key: string) => void;
  onPin: (key: string) => void;
  onUnpin: (key: string) => void;
  onClose: (key: string) => void;
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
}

export const SplitSessionLayout = React.memo(function SplitSessionLayout({
  focusKey,
  pinnedKeys,
  splitDirection,
  splitRatios,
  onFocusChange,
  onPin,
  onUnpin,
  onClose,
  onSplitRatiosChange,
  scrollToMessageRef,
  forceScrollToBottomRef,
  scrollToUnreadRef,
  turnStartedAtMap,
  pendingMap,
  renderHeader,
  getSessionColor,
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
        startPos: splitDirection === "horizontal" ? e.clientX : e.clientY,
        startRatios: currentRatios,
      };
      document.body.style.cursor =
        splitDirection === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      log.debug("divider drag start", { dividerIndex });
    },
    [splitDirection, splitRatios, visibleKeys.length]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pos = splitDirection === "horizontal" ? e.clientX : e.clientY;
      const startPos = drag.startPos;
      const totalSize =
        splitDirection === "horizontal" ? rect.width : rect.height;
      const delta = (pos - startPos) / totalSize;

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
  }, [splitDirection, onSplitRatiosChange]);

  if (visibleKeys.length === 0) {
    log.debug("no visible sessions — rendering empty state");
    return (
      <div className="multi-session-view multi-session-view--empty">
        <p>No sessions pinned. Pin a session to see it here.</p>
      </div>
    );
  }

  const allMessages = useMessageStore.getState().perSession;

  const effectiveRatios = computeEffectiveRatios(splitRatios, visibleKeys.length);

  /**
   * Compute effective split ratios for the current visible sections.
   *
   * The store's splitRatios may be stale after a session is closed
   * (length mismatch). When the count doesn't match, we coalesce to
   * equal distribution so remaining sections always fill 100 % of the
   * container.
   */
  function computeEffectiveRatios(
    ratios: number[],
    count: number
  ): number[] {
    if (count <= 0) return [];
    if (ratios.length === count) {
      const sum = ratios.reduce((a, b) => a + b, 0);
      if (sum > 0) return ratios.map((r) => r / sum);
    }
    // Ratios length doesn't match visible sections — reset to equal split.
    // This happens immediately after closing a session.
    return Array(count).fill(1 / count);
  }

  const renderSection = (key: string, isFocus: boolean) => {
    const isPinned = pinnedKeys.includes(key);
    const idx = visibleKeys.indexOf(key);
    return (
      <SessionSection
        key={key}
        sessionKey={key}
        isFocus={isFocus}
        isPinned={isPinned}
        layoutMode="split"
        splitDirection={splitDirection}
        splitIndex={idx}
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
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
        renderHeader={renderHeader}
        getSessionColor={getSessionColor}
      />
    );
  };

  const containerClassName = [
    "multi-session-view",
    `multi-session-view--split`,
    splitDirection === "horizontal"
      ? "multi-session-view--split-horizontal"
      : "multi-session-view--split-vertical",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="multi-session-view-wrapper">
      <div className={containerClassName} ref={containerRef}>
        {visibleKeys.map((key, i) => {
          const isFocus = key === focusKey;
          const section = renderSection(key, isFocus);
          if (i === visibleKeys.length - 1) return section;
          return (
            <React.Fragment key={key}>
              {section}
              <div
                className={`unified-split-divider unified-split-divider--${splitDirection}`}
                onMouseDown={handleDividerMouseDown(i)}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});
