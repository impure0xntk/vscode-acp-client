import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSyncExternalStore, useCallback as useCallbackReact } from "react";
import { useShallow } from "zustand/shallow";
import { SessionChatContainer } from "./SessionChatContainer";
import { SessionHeader } from "./SessionHeader";
import { SessionStatusBar } from "./SessionStatusBar";
import { useSessionStore, sessionKeyOf } from "../../store/sessionStore";
import type {
  SessionStoreState,
  SessionInfoDTO,
} from "../../store/sessionStore";
import { useMessageStore } from "../../store/messageStore";
import { useMessages } from "../../hooks/useMessages";
import { useSessionInfo } from "../../hooks/useSessionInfo";
import { useSessionUnreadCount } from "../../hooks/useSessionUnreadCount";
import {
  useScrollStateStore,
  type SessionScrollState,
} from "../../store/scrollStateStore";
import { getLogger } from "../../lib/logger";
import type { ContextAttachment, SendTarget, ChatMessage } from "../../types";
import type { TurnOutcome } from "../StatusIcon";

const log = getLogger("SessionView");

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

function getSessionColor(sessionKey: string): string {
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
  layoutMode: "single" | "split" | "grid";
  splitDirection?: "vertical" | "horizontal";
  splitRatios?: number[];
  disabled: boolean;
  pinnedKeys?: string[];
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
  onSplitRatiosChange?: (ratios: number[]) => void;
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

// ── Stable message-ID array selector ───────────────────────────────────────

function useMessageIdArray(activeKey: string | null) {
  const cacheRef = useRef<{ ids: string[]; ref: unknown }>({
    ids: [],
    ref: undefined,
  });

  const subscribe = useCallbackReact(
    (onStoreChange: () => void) => {
      if (!activeKey) return () => {};
      return useMessageStore.subscribe((state, prevState) => {
        if (state.perSession[activeKey] !== prevState.perSession[activeKey]) {
          onStoreChange();
        }
      });
    },
    [activeKey]
  );

  const getSnapshot = useCallbackReact((): string[] => {
    if (!activeKey) return [];
    const msgs = useMessageStore.getState().perSession[activeKey];
    const cache = cacheRef.current;
    if (msgs === cache.ref) return cache.ids;
    const ids = msgs ? msgs.map((m) => m.id) : [];
    cache.ref = msgs;
    cache.ids = ids;
    return ids;
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

// ── Single session section (for split/grid modes) ──────────────────────────

interface SessionSectionProps {
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
}

const SessionSection = React.memo(function SessionSection({
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
}: SessionSectionProps): React.ReactElement | null {
  const info = useSessionInfo(sessionKey);
  const color = getSessionColor(sessionKey);

  // Flash on turn completion
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

  // Auto-remove disconnected sessions
  useEffect(() => {
    if (!info) {
      log.info("session disconnected — auto-closing", { sessionKey });
      onClose(sessionKey);
    }
  }, [info, onClose, sessionKey]);

  if (!info) return null;

  const sectionClassName = [
    "unified-session-section",
    isFocus
      ? "unified-session-section--focus"
      : "unified-session-section--pinned",
    info.isStreaming ? "unified-session-section--streaming" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Split flex sizing
  const sectionStyle: React.CSSProperties | undefined = (() => {
    if (layoutMode === "split") {
      const ratio = splitRatios[splitIndex] ?? 1 / splitTotal;
      const pct = ratio * 100;
      if (splitDirection === "horizontal") {
        return {
          flex: `0 0 ${pct}%`,
          maxWidth: `${pct}%`,
          minWidth: "10%",
        };
      }
      return {
        flex: `0 0 ${pct}%`,
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
        className="unified-section-chat-wrapper"
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

// ── Single-mode chat area (Classic mode) ───────────────────────────────────

interface SingleModeProps {
  activeKey: string | null;
  disabled: boolean;
  onSend: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[]
  ) => void;
  onCancel: () => void;
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  forceScrollToBottomRef?: React.MutableRefObject<(() => void) | undefined>;
  scrollToUnreadRef?: React.MutableRefObject<(() => void) | undefined>;
  turnStartedAtMap?: Record<string, string>;
  pendingMap?: Record<string, boolean>;
}

const SingleMode = React.memo(function SingleMode({
  activeKey,
  disabled: _disabled,
  onSend,
  onCancel: _onCancel,
  scrollToMessageRef: externalScrollToMessageRef,
  forceScrollToBottomRef: externalForceScrollToBottomRef,
  scrollToUnreadRef: externalScrollToUnreadRef,
  turnStartedAtMap,
  pendingMap,
}: SingleModeProps): React.ReactElement {
  const localForceScrollToBottomRef = useRef<() => void>();
  const localScrollToUnreadRef = useRef<(id: string) => void>();

  // Merge external and local refs
  const forceScrollToBottomRef =
    externalForceScrollToBottomRef ?? localForceScrollToBottomRef;
  const scrollToUnreadRef = externalScrollToUnreadRef ?? localScrollToUnreadRef;

  // Turn tracking
  const [turnStartedAt, setTurnStartedAt] = useState<string | undefined>(
    undefined
  );
  const [pending, setPending] = useState(false);

  // Subscribe to per-session data
  const { messages: activeMessages, isStreaming } = useMessages(
    activeKey ?? null
  );
  const scrollState = useActiveScrollState(activeKey);
  const messageIds = useMessageIdArray(activeKey);
  const prevStreamingRef = useRef(isStreaming);

  const { isAtBottom, readUpToMessageId } = scrollState;

  // Scroll handler
  const handleScroll = useCallback(
    (metrics: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      isAtBottom: boolean;
    }) => {
      if (!activeKey) return;
      const store = useScrollStateStore.getState();
      store.setScrollTop(activeKey, metrics.scrollTop);
      store.setIsAtBottom(activeKey, metrics.isAtBottom);
      if (metrics.isAtBottom) {
        const ids = useMessageStore.getState().perSession[activeKey];
        const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
        store.setReadUpTo(activeKey, newestId);
      }
    },
    [activeKey]
  );

  // Auto-scroll on new messages when at bottom
  const msgLen = activeMessages.length;
  const prevLenRef = useRef(msgLen);
  useEffect(() => {
    if (!activeKey) return;
    const isNewMessage = msgLen > prevLenRef.current;
    prevLenRef.current = msgLen;
    if (isNewMessage) {
      const freshIsAtBottom =
        useScrollStateStore.getState().perSession[activeKey]?.isAtBottom ??
        true;
      if (freshIsAtBottom) {
        forceScrollToBottomRef.current?.();
      }
    }
  }, [activeKey, msgLen, forceScrollToBottomRef]);

  // Advance readUpTo when at bottom and messages arrive
  const prevMsgCountForReadRef = useRef(0);
  useEffect(() => {
    if (!activeKey || !isAtBottom) return;
    if (msgLen <= prevMsgCountForReadRef.current) return;
    prevMsgCountForReadRef.current = msgLen;
    const store = useScrollStateStore.getState();
    const ids = useMessageStore.getState().perSession[activeKey];
    const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
    store.setReadUpTo(activeKey, newestId);
  }, [activeKey, isAtBottom, msgLen]);

  // Compute unread
  const { unreadCount, firstUnreadId } = deriveUnread(
    readUpToMessageId,
    activeMessages
  );

  // Send handler
  const handleSend = useCallback(
    (
      text: string,
      attachments: ContextAttachment[],
      targets?: SendTarget[]
    ) => {
      if (activeKey) {
        const [agentId, sessionId] = activeKey.split(":");
        useMessageStore.getState().appendMessage(activeKey, {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          timestamp: Date.now(),
          agentId,
          sessionId,
          attachments: attachments.length > 0 ? attachments : undefined,
          attachmentsJson:
            attachments.length > 0 ? JSON.stringify(attachments) : undefined,
        });
      }
      setTurnStartedAt(new Date().toISOString());
      setPending(true);
      onSend(text, attachments, targets);
      forceScrollToBottomRef.current?.();
    },
    [onSend, activeKey, forceScrollToBottomRef]
  );

  const handleScrollToBottomClick = useCallback(() => {
    if (unreadCount > 0 && firstUnreadId) {
      scrollToUnreadRef.current?.(firstUnreadId);
    } else {
      forceScrollToBottomRef.current?.();
    }
  }, [unreadCount, firstUnreadId, scrollToUnreadRef, forceScrollToBottomRef]);

  // Session info
  const activeSessionInfo = useSessionInfo(activeKey);
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const sessionQueue = activeKey ? (promptQueue[activeKey] ?? []) : [];
  const status = activeSessionInfo?.status;
  const isTurnActive = status === "running";

  // Clear pending when agent acknowledges
  useEffect(() => {
    if (isTurnActive && pending) {
      setPending(false);
    }
  }, [isTurnActive, pending]);

  // Clear pending when turn completes
  useEffect(() => {
    if (!isTurnActive && !pending && turnStartedAt) {
      setTurnStartedAt(undefined);
    }
    if (!isTurnActive && pending) {
      setPending(false);
      setTurnStartedAt(undefined);
    }
  }, [isTurnActive, pending, turnStartedAt]);

  // Clear pending when streaming ends
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming && pending) {
      setPending(false);
      setTurnStartedAt(undefined);
    }
  }, [isStreaming, pending]);

  // Reset turn tracking on session change
  useEffect(() => {
    setTurnStartedAt(undefined);
    setPending(false);
  }, [activeKey]);

  return (
    <>
      <div className="chat-container-wrapper">
        <SessionChatContainer
          key={activeKey ?? "none"}
          sessionKey={activeKey}
          sessionId={activeKey?.split(":")[1]}
          agentId={activeKey?.split(":")[0]}
          status={status}
          isActive={true}
          scrollToMessageRef={externalScrollToMessageRef}
          onScroll={handleScroll}
          forceScrollToBottomRef={forceScrollToBottomRef}
          scrollToUnreadRef={scrollToUnreadRef}
        />
        {unreadCount > 0 && (
          <button
            className="scroll-to-bottom-button"
            onClick={handleScrollToBottomClick}
            aria-label="Scroll to unread"
          >
            <span className="scroll-to-bottom-icon">↧</span>
            <span className="scroll-to-bottom-badge">{unreadCount}</span>
          </button>
        )}
      </div>
      <SessionStatusBar
        sessionKey={activeKey}
        active={isTurnActive}
        action={
          isTurnActive
            ? `Waiting for ${activeKey?.split(":")[0] ?? "agent"}…`
            : undefined
        }
        turnStartedAt={turnStartedAt}
        pending={pending}
        queue={sessionQueue}
        onCancelQueue={(promptId) => {
          if (!activeKey) return;
          const [agentId, sessionId] = activeKey.split(":");
          const vscode = (window as any).acquireVsCodeApi?.();
          vscode?.postMessage({
            type: "queue:cancel",
            agentId,
            sessionId,
            promptId,
          });
        }}
      />
    </>
  );
});

// ── Multi-session view (split/grid modes) ──────────────────────────────────

interface MultiSessionProps {
  focusKey: string | null;
  pinnedKeys: string[];
  layoutMode: "single" | "split" | "grid";
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
}

const MultiSessionMode = React.memo(function MultiSessionMode({
  focusKey,
  pinnedKeys,
  layoutMode,
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
}: MultiSessionProps): React.ReactElement | null {
  const { tabOrder, connectedAgents, tabTitles } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabOrder: s.tabOrder,
      connectedAgents: s.connectedAgents,
      tabTitles: s.tabTitles,
    }))
  );

  // Determine visible sections
  const visibleKeys: string[] = [];
  if (layoutMode === "single") {
    if (focusKey) visibleKeys.push(focusKey);
  } else {
    for (const k of pinnedKeys) {
      visibleKeys.push(k);
    }
    if (focusKey && !pinnedKeys.includes(focusKey)) {
      visibleKeys.push(focusKey);
    }
  }

  // Divider drag state
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

  // Read messages once per render cycle
  const allMessages = useMessageStore.getState().perSession;

  const effectiveRatios =
    splitRatios.length >= visibleKeys.length
      ? splitRatios
      : Array(visibleKeys.length).fill(1 / visibleKeys.length);

  const renderSection = (key: string, isFocus: boolean) => {
    const isPinned = pinnedKeys.includes(key);
    const idx = visibleKeys.indexOf(key);
    return (
      <SessionSection
        key={key}
        sessionKey={key}
        isFocus={isFocus}
        isPinned={isPinned}
        layoutMode={layoutMode}
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
      />
    );
  };

  const containerClassName = [
    "multi-session-view",
    `multi-session-view--${layoutMode}`,
    layoutMode === "split" && splitDirection === "horizontal"
      ? "multi-session-view--split-horizontal"
      : layoutMode === "split"
        ? "multi-session-view--split-vertical"
        : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Render with dividers for split mode
  if (layoutMode === "split") {
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
  }

  return (
    <div className={containerClassName} ref={containerRef}>
      {visibleKeys.map((key) => renderSection(key, key === focusKey))}
    </div>
  );
});

// ── SessionView (main component) ───────────────────────────────────────────

export const SessionView = React.memo(function SessionView({
  sessionKey,
  layoutMode,
  splitDirection = "vertical",
  splitRatios = [],
  disabled,
  pinnedKeys = [],
  onSend,
  onCancel,
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
  renderFooter,
}: SessionViewProps): React.ReactElement | null {
  // Single mode
  if (layoutMode === "single") {
    return (
      <SingleMode
        activeKey={sessionKey}
        disabled={disabled}
        onSend={onSend}
        onCancel={onCancel}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
        turnStartedAtMap={turnStartedAtMap}
        pendingMap={pendingMap}
      />
    );
  }

  // Split / Grid mode
  return (
    <MultiSessionMode
      focusKey={sessionKey}
      pinnedKeys={pinnedKeys}
      layoutMode={layoutMode}
      splitDirection={splitDirection}
      splitRatios={splitRatios}
      onFocusChange={onFocusChange ?? (() => {})}
      onPin={onPin ?? (() => {})}
      onUnpin={onUnpin ?? (() => {})}
      onClose={onClose ?? (() => {})}
      onSplitRatiosChange={onSplitRatiosChange ?? (() => {})}
      scrollToMessageRef={scrollToMessageRef}
      forceScrollToBottomRef={forceScrollToBottomRef}
      scrollToUnreadRef={scrollToUnreadRef}
      turnStartedAtMap={turnStartedAtMap}
      pendingMap={pendingMap}
      renderHeader={renderHeader}
    />
  );
});
