import React, { useState, useRef, useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { ChatContainer } from "../components/ChatContainer";
import { Composer } from "../components/Composer";
import { StreamingStatus } from "../components/StreamingStatus";
import { QueuedPromptList } from "../components/QueuedPromptList";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import type { SessionState } from "../store/sessionStore";
import { useUiStateStore } from "../store/uiStateStore";
import type { SendTarget } from "../types";
import type { SessionStatus } from "../components/StatusIcon";


interface ChatAreaProps {
  activeKey: string | null;
  messages: import("../types").ChatMessage[];
  isStreaming: boolean;
  status?: SessionStatus;
  isTurnActive: boolean;
  disabled: boolean;
  onSend: (
    text: string,
    attachments: import("../types").ContextAttachment[],
    targets?: SendTarget[]
  ) => void;
  onCancel: () => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
  fetchFiles: (query: string) => Promise<import("../types").FileCandidate[]>;
  resolveFile: (path: string) => Promise<import("../types").ContextAttachment>;
  resolveSelection: () => Promise<import("../types").ContextAttachment | null>;
  resolveDiff: () => Promise<import("../types").ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<import("../types").SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<import("../types").ContextAttachment>;
  availableCommands: import("../store/sessionStore").SlashCommand[];
  /** Ref setter that receives the internal scrollToMessage function */
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
}

export function ChatArea({
  activeKey,
  messages,
  isStreaming,
  status,
  isTurnActive,
  disabled,
  onSend,
  onCancel,
  onSwitchSession,
  fetchFiles,
  resolveFile,
  resolveSelection,
  resolveDiff,
  fetchSymbols,
  resolveSymbol,
  availableCommands,
  scrollToMessageRef: externalScrollToMessageRef,
}: ChatAreaProps) {
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollUnreadCount, setScrollUnreadCount] = useState(0);
  const forceScrollToBottomRef = useRef<() => void>();
  const scrollToUnreadRef = useRef<() => void>();
  const scrollStateRef = useRef<{
    isAtBottom: boolean;
    unreadCount: number;
    scrollToBottom: () => void;
  }>({ isAtBottom: true, unreadCount: 0, scrollToBottom: () => {} });

  const handleScrollStateChange = useCallback(
    (state: { isAtBottom: boolean; unreadCount: number }) => {
      setShowScrollButton(!state.isAtBottom);
      setScrollUnreadCount(state.unreadCount);
    },
    []
  );

  const handleSend = useCallback(
    (
      text: string,
      attachments: import("../types").ContextAttachment[],
      targets?: SendTarget[]
    ) => {
      onSend(text, attachments, targets);
      forceScrollToBottomRef.current?.();
    },
    [onSend]
  );

  // Subscribe to sessionInfoMap + promptQueue for this session
  const { sessionInfoMap, promptQueue } = useSessionStore(useShallow((s: SessionState) => ({
    sessionInfoMap: s.sessionInfoMap,
    promptQueue: s.promptQueue,
  })));
  const activeSessionInfo = activeKey ? sessionInfoMap[activeKey] : undefined;
  const lastResponseAt = activeSessionInfo?.lastResponseAt;
  const sessionQueue = activeKey ? (promptQueue[activeKey] ?? []) : [];

  return (
    <>
      <div className="chat-container-wrapper">
        <ChatContainer
          key={activeKey ?? "none"}
          messages={messages}
          isStreaming={isStreaming || isTurnActive}
          sessionId={activeKey?.split(":")[1]}
          sessionKey={activeKey ?? undefined}
          status={status}
          isActive={true}
          scrollToMessageRef={externalScrollToMessageRef}
          scrollStateRef={scrollStateRef}
          onScrollStateChange={handleScrollStateChange}
          forceScrollToBottomRef={forceScrollToBottomRef}
          scrollToUnreadRef={scrollToUnreadRef}
        />

        {showScrollButton && (
          <button
            className="scroll-to-bottom-button"
            onClick={() => {
              if (scrollUnreadCount > 0) {
                scrollToUnreadRef.current?.();
              } else {
                scrollStateRef.current?.scrollToBottom();
              }
            }}
            aria-label={scrollUnreadCount > 0 ? "Scroll to unread" : "Scroll to bottom"}
          >
            <span className="scroll-to-bottom-icon">{scrollUnreadCount > 0 ? "↧" : "↓"}</span>
            {scrollUnreadCount > 0 && (
              <span className="scroll-to-bottom-badge">{scrollUnreadCount}</span>
            )}
          </button>
        )}
      </div>
      <StreamingStatus
        action={isTurnActive ? `Waiting for ${activeKey?.split(":")[0] ?? "agent"}…` : undefined}
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
          vscode?.postMessage({ type: "queue:cancel", agentId, sessionId, promptId });
        }}
      />
      <Composer
        onSend={handleSend}
        onCancel={onCancel}
        onSwitchSession={onSwitchSession}
        isTurnActive={isTurnActive}
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
}
