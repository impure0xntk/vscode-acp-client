import React, { useState, useRef, useCallback } from "react";
import { ChatContainer } from "../components/ChatContainer";
import { Composer } from "../components/Composer";
import { ProgressBar } from "../components/ProgressBar";
import { useSessionContext } from "../hooks/useSessionContext";

interface ChatAreaProps {
  activeKey: string | null;
  messages: ReturnType<typeof useSessionContext>["messages"];
  isStreaming: boolean;
  status?: string;
  isTurnActive: boolean;
  disabled: boolean;
  onSend: (text: string, attachments: import("../types").ContextAttachment[]) => void;
  onCancel: () => void;
  fetchFiles: (query: string) => Promise<import("../types").FileCandidate[]>;
  resolveFile: (path: string) => Promise<import("../types").ContextAttachment>;
  resolveSelection: () => Promise<import("../types").ContextAttachment | null>;
  resolveDiff: () => Promise<import("../types").ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<import("../types").SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<import("../types").ContextAttachment>;
  availableCommands: ReturnType<typeof useSessionContext>["availableCommands"];
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
  fetchFiles,
  resolveFile,
  resolveSelection,
  resolveDiff,
  fetchSymbols,
  resolveSymbol,
  availableCommands,
}: ChatAreaProps) {
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollUnreadCount, setScrollUnreadCount] = useState(0);
  const forceScrollToBottomRef = useRef<() => void>();
  const scrollToMessageRef = useRef<(id: string) => void>();
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
    (text: string, attachments: import("../types").ContextAttachment[]) => {
      onSend(text, attachments);
      forceScrollToBottomRef.current?.();
    },
    [onSend]
  );

  return (
    <>
      <div className="chat-container-wrapper">
        <ChatContainer
          key={activeKey ?? "none"}
          messages={messages}
          isStreaming={isStreaming}
          sessionId={activeKey?.split(":")[1]}
          sessionKey={activeKey ?? undefined}
          status={status}
          isActive={true}
          scrollToMessageRef={scrollToMessageRef}
          scrollStateRef={scrollStateRef}
          onScrollStateChange={handleScrollStateChange}
          forceScrollToBottomRef={forceScrollToBottomRef}
        />
        {showScrollButton && (
          <button
            className="scroll-to-bottom-button"
            onClick={() => scrollStateRef.current?.scrollToBottom()}
            aria-label="Scroll to bottom"
          >
            <span className="scroll-to-bottom-icon">↓</span>
            {scrollUnreadCount > 0 && (
              <span className="scroll-to-bottom-badge">{scrollUnreadCount}</span>
            )}
          </button>
        )}
      </div>
      <Composer
        onSend={handleSend}
        onCancel={onCancel}
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
      <ProgressBar status={status} lastActivityMs={undefined} />
    </>
  );
}
