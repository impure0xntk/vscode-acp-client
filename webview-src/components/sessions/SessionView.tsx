import React, { useCallback, useEffect, useRef } from "react";
import { useSyncExternalStore, useCallback as useCallbackReact } from "react";
import { useSessionStore } from "../../store/sessionStore";
import type { SessionInfoDTO } from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import {
  useScrollStateStore,
  type SessionScrollState,
} from "../../store/scrollStateStore";
import type { ContextAttachment, SendTarget, ChatMessage } from "../../types";
import type { TurnOutcome } from "../primitives/StatusIcon";
import { SplitSessionLayout } from "./layouts/SplitSessionLayout";

// ── Color palette (WCAG AA compliant on dark bg #1e1e1e) ──────────────────

const AGENT_COLOR_PALETTE = [
  "hsl(210, 70%, 60%)", // blue
  "hsl(270, 55%, 60%)", // purple
  "hsl(45,  80%, 55%)", // amber
  "hsl(145, 45%, 50%)", // green
  "hsl(345, 60%, 55%)", // rose
  "hsl(195, 75%, 55%)", // sky
  "hsl(25,  80%, 55%)", // orange
  "hsl(320, 50%, 55%)", // pink
] as const;

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getSessionColor(sessionKey: string): string {
  return AGENT_COLOR_PALETTE[hashKey(sessionKey) % AGENT_COLOR_PALETTE.length];
}

// ── Empty scroll state ─────────────────────────────────────────────────────

const EMPTY_SCROLL: SessionScrollState = {
  scrollTop: 0,
  readUpToMessageId: null,
  isAtBottom: true,
};

// ── SessionHeaderProps / SessionFooterProps (for custom renderers) ─────────

export interface SessionHeaderProps {
  sessionKey: string;
  agentId?: string;
  title?: string;
  status?: string;
  color?: string;
  messageCount?: number;
  isActive?: boolean;
  isPinned?: boolean;
  splitDirection?: "vertical" | "horizontal";
  info?: SessionInfoDTO;
  onTogglePin?: () => void;
  onClose?: () => void;
  onRename?: (agentId: string, sessionId: string, title: string) => void;
}

export interface SessionFooterProps {
  sessionKey: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  contextWindowMax?: number;
  messageCount: number;
  sessionStatus?: string;
  model?: string;
  mode?: string;
}

// ── SessionViewProps ────────────────────────────────────────────────────────

export interface SessionViewProps {
  sessionKey: string | null;
  disabled: boolean;
  pinnedKeys?: string[];
  splitRatios?: number[];
  onSplitRatiosChange?: (ratios: number[]) => void;
  onSend: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[]
  ) => void;
  onCancel: () => void;
  onFocusChange?: (key: string) => void;
  onPin?: (key: string) => void;
  onUnpin?: (key: string) => void;
  onClose?: (key: string) => void;
  onRename?: (agentId: string, sessionId: string, title: string) => void;
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
  turnStartedAtMap?: Record<string, string>;
  pendingMap?: Record<string, boolean>;
  renderHeader?: (props: SessionHeaderProps) => React.ReactNode;
  renderFooter?: (props: SessionFooterProps) => React.ReactNode;
}

// ── Stable scroll-state selector ───────────────────────────────────────────

function useActiveScrollState(activeKey: string | null) {
  const subscribe = useCallbackReact(
    (onStoreChange: () => void) => {
      if (!activeKey) return () => {};
      return useScrollStateStore.subscribe((state, prevState) => {
        const cur = state.perSession[activeKey];
        const prev = prevState.perSession[activeKey];
        if (cur !== prev) onStoreChange();
      });
    },
    [activeKey]
  );

  const getSnapshot = useCallbackReact((): SessionScrollState => {
    if (!activeKey) return EMPTY_SCROLL;
    return useScrollStateStore.getState().perSession[activeKey] ?? EMPTY_SCROLL;
  }, [activeKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Pure unread derivation ─────────────────────────────────────────────────

function deriveUnread(
  readUpToId: string | null,
  messages: ChatMessage[]
): { unreadCount: number; firstUnreadId: string | null } {
  if (messages.length === 0) {
    return { unreadCount: 0, firstUnreadId: null };
  }
  if (!readUpToId) {
    return {
      unreadCount: messages.length,
      firstUnreadId: messages[0].id,
    };
  }
  const idx = messages.findIndex((m) => m.id === readUpToId);
  if (idx < 0 || idx + 1 >= messages.length) {
    return { unreadCount: 0, firstUnreadId: null };
  }
  return {
    unreadCount: messages.length - idx - 1,
    firstUnreadId: messages[idx + 1].id,
  };
}

// ── SessionView (main component) ───────────────────────────────────────────

export const SessionView = React.memo(function SessionView({
  sessionKey,
  disabled,
  pinnedKeys = [],
  splitRatios = [],
  onSplitRatiosChange,
  onSend,
  onCancel,
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
  renderFooter,
}: SessionViewProps): React.ReactElement | null {
  return (
    <div className="flex-1 min-h-0">
      <SplitSessionLayout
        focusKey={sessionKey}
        pinnedKeys={pinnedKeys}
        splitRatios={splitRatios}
        onFocusChange={onFocusChange ?? (() => {})}
        onPin={onPin ?? (() => {})}
        onUnpin={onUnpin ?? (() => {})}
        onClose={onClose ?? (() => {})}
        onRename={onRename}
        onSplitRatiosChange={onSplitRatiosChange ?? (() => {})}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
        turnStartedAtMap={turnStartedAtMap}
        pendingMap={pendingMap}
        renderHeader={renderHeader}
        getSessionColor={getSessionColor}
      />
    </div>
  );
});
