import React, { useCallback, useEffect, useRef, useState } from "react";
import { SessionChatContainer } from "../SessionChatContainer";
import { SessionStatusBar } from "../SessionStatusBar";
import { useSessionStore } from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { useScrollStateStore } from "../../../store/scrollStateStore";
import { useMessages } from "../../../hooks/useMessages";
import { useSessionInfo } from "../../../hooks/useSessionInfo";
import type {
  ContextAttachment,
  SendTarget,
  ChatMessage,
} from "../../../types";

export interface SingleSessionLayoutProps {
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
  useActiveScrollState: (key: string | null) => {
    isAtBottom: boolean;
    readUpToMessageId: string | null;
  };
  deriveUnread: (
    readUpToId: string | null,
    messages: ChatMessage[]
  ) => { unreadCount: number; firstUnreadId: string | null };
}

export const SingleSessionLayout = React.memo(function SingleSessionLayout({
  activeKey,
  disabled: _disabled,
  onSend,
  onCancel: _onCancel,
  scrollToMessageRef: externalScrollToMessageRef,
  forceScrollToBottomRef: externalForceScrollToBottomRef,
  scrollToUnreadRef: externalScrollToUnreadRef,
  turnStartedAtMap,
  pendingMap,
  useActiveScrollState,
  deriveUnread,
}: SingleSessionLayoutProps): React.ReactElement {
  const localForceScrollToBottomRef = useRef<() => void>();
  const localScrollToUnreadRef = useRef<(id: string) => void>();

  const forceScrollToBottomRef =
    externalForceScrollToBottomRef ?? localForceScrollToBottomRef;
  const scrollToUnreadRef = externalScrollToUnreadRef ?? localScrollToUnreadRef;

  const [localTurnStartedAt, setLocalTurnStartedAt] = useState<
    string | undefined
  >(undefined);
  const [localPending, setLocalPending] = useState(false);

  // In single mode, prefer map values (set by UnifiedMode) over local state.
  // The main send path (Composer → handleSendWithTurnTracking) sets maps,
  // not local state.  Local state is only used as a fallback.
  const mapTurnStartedAt = turnStartedAtMap?.[activeKey ?? ""];
  const mapPending = pendingMap?.[activeKey ?? ""] ?? false;
  const turnStartedAt = mapTurnStartedAt ?? localTurnStartedAt;
  const pending = mapPending || localPending;
  const setTurnStartedAt = (v: string | undefined) => {
    setLocalTurnStartedAt(v);
  };
  const setPending = (v: boolean) => {
    setLocalPending(v);
  };

  const { messages: activeMessages, isStreaming } = useMessages(
    activeKey ?? null
  );
  const scrollState = useActiveScrollState(activeKey);
  const prevStreamingRef = useRef(isStreaming);

  const { isAtBottom, readUpToMessageId } = scrollState;

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

  void prevStreamingRef;

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

  const { unreadCount, firstUnreadId } = deriveUnread(
    readUpToMessageId,
    activeMessages
  );

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

  const activeSessionInfo = useSessionInfo(activeKey);
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const sessionQueue = activeKey ? (promptQueue[activeKey] ?? []) : [];
  const status = activeSessionInfo?.status;
  const isTurnActive = status === "running";

  // Clear pending only after the agent has been running for at least
  // MIN_DISPLAY_MS milliseconds, so that "Sending…" has time to render.
  const pendingClearedRef = useRef(false);
  const prevPendingRef = useRef(false);
  useEffect(() => {
    // Reset the cleared flag whenever pending transitions from false→true
    // (i.e. a new message was sent) so the timer can fire again.
    if (pending && !prevPendingRef.current) {
      pendingClearedRef.current = false;
    }
    prevPendingRef.current = pending;

    if (isTurnActive && pending && !pendingClearedRef.current) {
      pendingClearedRef.current = true;
      const timer = setTimeout(() => {
        setPending(false);
      }, 400);
      return () => clearTimeout(timer);
    }
    if (!isTurnActive) {
      pendingClearedRef.current = false;
    }
  }, [isTurnActive, pending]);

  useEffect(() => {
    if (!isTurnActive && !pending && turnStartedAt) {
      setTurnStartedAt(undefined);
    }
    if (!isTurnActive && pending) {
      setPending(false);
      setTurnStartedAt(undefined);
    }
  }, [isTurnActive, pending, turnStartedAt]);

  // Clear pending when session status transitions to a terminal state
  // (completed/done).  Without this, if session/completed arrives before
  // session/streamEnd, isTurnActive flips to false but the 400ms timer
  // in the effect above was never armed (isTurnActive was already false
  // when pending became true, or the status skipped "running" entirely),
  // leaving the "Sending…" indicator stuck.
  const isTerminal =
    status === "completed" ||
    (status as string) === "done" ||
    status === "error" ||
    status === "cancelled";
  useEffect(() => {
    if (isTerminal && pending) {
      setPending(false);
      setTurnStartedAt(undefined);
    }
  }, [isTerminal, pending]);

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
