import React, { useRef, useCallback, useEffect, memo } from "react";
import { useSyncExternalStore, useCallback as useCallbackReact } from "react";
import { ChatContainer } from "../components/ChatContainer";
import { Composer } from "../components/Composer";
import { StreamingStatus } from "../components/StreamingStatus";
import { QueuedPromptList } from "../components/QueuedPromptList";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import { useSessionInfo } from "../hooks/useSessionInfo";
import { useMessageStore } from "../store/messageStore";
import { useMessages } from "../hooks/useMessages";
import { useScrollStateStore, type SessionScrollState } from "../store/scrollStateStore";
import type { SendTarget } from "../types";

// ── Props ───────────────────────────────────────────────────────────────────

interface ChatAreaProps {
  activeKey: string | null;
  disabled: boolean;
  onSend: (
    text: string,
    attachments: import("../types").ContextAttachment[],
    targets?: SendTarget[]
  ) => void;
  onCancel: () => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  fetchFiles: (query: string) => Promise<import("../types").FileCandidate[]>;
  resolveFile: (path: string) => Promise<import("../types").ContextAttachment>;
  resolveSelection: () => Promise<import("../types").ContextAttachment | null>;
  resolveDiff: () => Promise<import("../types").ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<import("../types").SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<import("../types").ContextAttachment>;
  availableCommands: import("../store/sessionStore").SlashCommand[];
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
}

// ── Stable scroll-state selector (subscribes only to active session) ────────

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
    [activeKey],
  );

  const getSnapshot = useCallbackReact((): SessionScrollState => {
    if (!activeKey) return EMPTY_SCROLL;
    return useScrollStateStore.getState().perSession[activeKey] ?? EMPTY_SCROLL;
  }, [activeKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const EMPTY_SCROLL: SessionScrollState = {
  scrollTop: 0,
  readUpToMessageId: null,
  isAtBottom: true,
};

// ── Stable message-ID array selector (referentially cached) ─────────────────

function useMessageIdArray(activeKey: string | null) {
  const cacheRef = useRef<{ ids: string[]; ref: unknown }>({ ids: [], ref: undefined });

  const subscribe = useCallbackReact(
    (onStoreChange: () => void) => {
      if (!activeKey) return () => {};
      return useMessageStore.subscribe((state, prevState) => {
        if (state.perSession[activeKey] !== prevState.perSession[activeKey]) {
          onStoreChange();
        }
      });
    },
    [activeKey],
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

// ── Component ──────────────────────────────────────────────────────────────

export const ChatArea = memo(function ChatArea({
  activeKey,
  disabled,
  onSend,
  onCancel,
  onSwitchSession,
  onRenameSession,
  fetchFiles,
  resolveFile,
  resolveSelection,
  resolveDiff,
  fetchSymbols,
  resolveSymbol,
  availableCommands,
  scrollToMessageRef: externalScrollToMessageRef,
}: ChatAreaProps) {
  const forceScrollToBottomRef = useRef<() => void>();
  const scrollToUnreadRef = useRef<(id: string) => void>();

  // ── Subscribe to per-session data via stable selectors ───────────────
  const { messages: activeMessages, isStreaming } = useMessages(activeKey ?? null);
  const scrollState = useActiveScrollState(activeKey);
  const messageIds = useMessageIdArray(activeKey);

  const { isAtBottom, readUpToMessageId } = scrollState;

  // ── Imperative scroll handlers (stable references) ─────────────────
  const scrollTopRef = useRef(0);

  // ── Scroll handler from ChatContainer: update store (not local state) ─
  // Uses a ref for the callback identity so it never changes.
  const handleScroll = useCallback(
    (metrics: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      isAtBottom: boolean;
    }) => {
      if (!activeKey) return;
      const store = useScrollStateStore.getState();
      scrollTopRef.current = metrics.scrollTop;

      store.setScrollTop(activeKey, metrics.scrollTop);
      store.setIsAtBottom(activeKey, metrics.isAtBottom);

      if (metrics.isAtBottom) {
        // At bottom → mark all as read
        const ids = useMessageStore.getState().perSession[activeKey];
        const newestId = ids && ids.length > 0 ? ids[ids.length - 1].id : null;
        store.setReadUpTo(activeKey, newestId);
      }
      // When not at bottom, we update readUpTo based on the last visible message.
      // This is handled in a scroll-end debounce or on explicit user action,
      // not in the hot path of every scroll event.
    },
    [activeKey],
  );

  // ── Auto-scroll when new messages arrive AND user is at bottom ─────────
  // Read isAtBottom from the store at effect time to avoid stale prop values
  // during streaming, where the scroll handler may not have fired yet.
  const msgLen = activeMessages.length;
  const prevLenRef = useRef(msgLen);
  useEffect(() => {
    if (!activeKey) return;
    const isNewMessage = msgLen > prevLenRef.current;
    prevLenRef.current = msgLen;
    if (isNewMessage) {
      const freshIsAtBottom =
        useScrollStateStore.getState().perSession[activeKey]?.isAtBottom ?? true;
      if (freshIsAtBottom) {
        forceScrollToBottomRef.current?.();
      }
    }
  }, [activeKey, msgLen]);

  // ── When messages arrive and isAtBottom is true, advance readUpTo ────
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

  // ── Compute unread count & firstUnreadId from store data ─────────────
  // Purely derived, no setState — computed every render from stable inputs.
  const { unreadCount, firstUnreadId } = deriveUnread(
    readUpToMessageId,
    activeMessages,
    isAtBottom,
  );

  // ── Handlers ──────────────────────────────────────────────────────
  const handleSend = useCallback(
    (
      text: string,
      attachments: import("../types").ContextAttachment[],
      targets?: SendTarget[]
    ) => {
      // Local echo: immediately append the user message to the store
      // so the attachment chips appear without waiting for the round-trip
      // through the extension host.
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
            attachments.length > 0
              ? JSON.stringify(attachments)
              : undefined,
        });
      }
      onSend(text, attachments, targets);
      forceScrollToBottomRef.current?.();
    },
    [onSend, activeKey],
  );

  const handleScrollToBottomClick = useCallback(() => {
    if (unreadCount > 0 && firstUnreadId) {
      scrollToUnreadRef.current?.(firstUnreadId);
    } else {
      forceScrollToBottomRef.current?.();
    }
  }, [unreadCount, firstUnreadId]);

  // ── Session info ──────────────────────────────────────────────────
  const activeSessionInfo = useSessionInfo(activeKey);
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const sessionQueue = activeKey ? (promptQueue[activeKey] ?? []) : [];
  const lastResponseAt = activeSessionInfo?.lastResponseAt;
  const status = activeSessionInfo?.status;
  const isTurnActive = status === "running";

  return (
    <>
      <div className="chat-container-wrapper">
        <ChatContainer
          key={activeKey ?? "none"}
          sessionId={activeKey?.split(":")[1]}
          sessionKey={activeKey ?? undefined}
          agentId={activeKey?.split(":")[0]}
          status={status}
          isAtBottom={isAtBottom}
          scrollToMessageRef={externalScrollToMessageRef}
          onScroll={handleScroll}
          forceScrollToBottomRef={forceScrollToBottomRef}
          scrollToUnreadRef={scrollToUnreadRef}
        />

        {!isAtBottom && (
          <button
            className="scroll-to-bottom-button"
            onClick={handleScrollToBottomClick}
            aria-label={unreadCount > 0 ? "Scroll to unread" : "Scroll to bottom"}
          >
            <span className="scroll-to-bottom-icon">
              {unreadCount > 0 ? "↧" : "↓"}
            </span>
            {unreadCount > 0 && (
              <span className="scroll-to-bottom-badge">{unreadCount}</span>
            )}
          </button>
        )}
      </div>
      <StreamingStatus
        action={
          isTurnActive
            ? `Waiting for ${activeKey?.split(":")[0] ?? "agent"}…`
            : undefined
        }
        active={isTurnActive}
        lastResponseAt={lastResponseAt ?? undefined}
        sessionKey={activeKey ?? undefined}
      />
      <QueuedPromptList
        queue={sessionQueue}
        sessionKey={activeKey ?? ""}
        onCancel={(promptId) => {
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
      <Composer
        onSend={handleSend}
        onCancel={onCancel}
        onSwitchSession={onSwitchSession}
        onRenameSession={onRenameSession}
        status={status}
        disabled={disabled}
        fetchFiles={fetchFiles}
        resolveFile={resolveFile}
        resolveSelection={resolveSelection}
        resolveDiff={resolveDiff}
        fetchSymbols={fetchSymbols}
        resolveSymbol={resolveSymbol}
        availableCommands={availableCommands}
      />
    </>
  );
});

// ── Pure derivation (no side effects, no hooks) ────────────────────────────

function deriveUnread(
  readUpToId: string | null,
  messages: import("../types").ChatMessage[],
  isAtBottom: boolean,
): { unreadCount: number; firstUnreadId: string | null } {
  if (isAtBottom || !readUpToId || messages.length === 0) {
    return { unreadCount: 0, firstUnreadId: null };
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
