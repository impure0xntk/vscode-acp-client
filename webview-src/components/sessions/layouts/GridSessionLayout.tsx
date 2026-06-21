import React from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "../../../store/sessionStore";
import type { SessionStoreState } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { SessionSection } from "./SessionSection";
import type { SessionHeaderProps } from "../SessionView";

export interface GridSessionLayoutProps {
  focusKey: string | null;
  pinnedKeys: string[];
  layoutMode: "grid";
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

export const GridSessionLayout = React.memo(function GridSessionLayout({
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
}: GridSessionLayoutProps): React.ReactElement | null {
  const { tabOrder, connectedAgents, tabTitles } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabOrder: s.tabOrder,
      connectedAgents: s.connectedAgents,
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

  if (visibleKeys.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden items-center justify-center text-xs text-fg-muted">
        <p>No sessions pinned. Pin a session to see it here.</p>
      </div>
    );
  }

  const allMessages = useMessageStore.getState().perSession;

  const cols =
    visibleKeys.length <= 1
      ? 1
      : visibleKeys.length <= 2
        ? 2
        : visibleKeys.length <= 4
          ? 3
          : 4;
  const pct = 100 / cols;

  const renderSection = (key: string, isFocus: boolean) => {
    const isPinned = pinnedKeys.includes(key);
    const idx = visibleKeys.indexOf(key);
    return (
      <SessionSection
        key={key}
        sessionKey={key}
        isFocus={isFocus}
        isPinned={isPinned}
        layoutMode="grid"
        splitDirection={splitDirection}
        splitIndex={idx}
        splitTotal={visibleKeys.length}
        splitRatios={splitRatios}
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

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden h-full flex-row overflow-y-auto">
      {visibleKeys.map((key) => renderSection(key, key === focusKey))}
    </div>
  );
});
