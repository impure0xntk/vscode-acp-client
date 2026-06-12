import React, { useMemo, useRef, useCallback, useState } from "react";
import { ChatContainer } from "./ChatContainer";
import { Composer } from "./Composer";
import { BottomToolbar } from "./BottomToolbar";
import { TopToolbar } from "./TopToolbar";
import { SessionTabs } from "./SessionTabs";
import { ProgressBar } from "./ProgressBar";
import { CompletionNotification } from "./CompletionNotification";
import { SessionHistoryPanel, PersistentSessionEntry } from "./SessionHistoryPanel";
import { useSessionContext } from "../hooks/useSessionContext";
import { ErrorBoundary } from "./ErrorBoundary";
import type { ChatMessage, ContextAttachment } from "../types";
import { getVsCodeApi } from "../lib/vscodeApi";

function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

export function App(): React.ReactElement {
  const ctx = useSessionContext();

  const {
    messages,
    isStreaming,
    isTurnActive,
    tokenUsage,
    contextWindowMax,
    agentName,
    sendMessage,
    cancelTurn,
    tabs,
    activeSessionId,
    activeAgentId,
    sessions,
    workspaceRoot,
    connectedAgents,
    agentInfoMap,
    workspaceFolders,
    completedNotifications,
    dismissCompletedNotification,
    switchTab,
    newSession,
    newSessionWithPicker,
    closeSession,
    fetchFiles,
    resolveFile,
    resolveSelection,
    resolveDiff,
    fetchSymbols,
    resolveSymbol,
    availableCommands,
    statusline,
  } = ctx;

  // History panel state
  const [showHistory, setShowHistory] = React.useState(false);
  const [selectedHistorySession, setSelectedHistorySession] = React.useState<PersistentSessionEntry | null>(null);

  // Scroll-to-message handler (passed through to TopToolbar)
  const scrollToMessageRef = useRef<(id: string) => void>();
  const handleJumpToMessage = useCallback((messageId: string) => {
    scrollToMessageRef.current?.(messageId);
  }, []);

  // Scroll state for fixed scroll-to-bottom button
  const scrollStateRef = useRef<{
    isAtBottom: boolean;
    unreadCount: number;
    scrollToBottom: () => void;
  }>({ isAtBottom: true, unreadCount: 0, scrollToBottom: () => {} });
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollUnreadCount, setScrollUnreadCount] = useState(0);

  // Poll scroll state at 200ms interval (lightweight, avoids prop-drilling complexity)
  React.useEffect(() => {
    const interval = setInterval(() => {
      const s = scrollStateRef.current;
      setShowScrollButton(!s.isAtBottom);
      setScrollUnreadCount(s.unreadCount);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Derive active session info
  const activeTab = useMemo(
    () => tabs.find((t) => t.sessionId === activeSessionId),
    [tabs, activeSessionId]
  );

  const activeKey = activeAgentId && activeSessionId
    ? sessionKey(activeAgentId, activeSessionId)
    : null;

  const activeMessages = useMemo(
    () => (activeKey && sessions[activeKey]?.messages)
      ? sessions[activeKey].messages
      : messages,
    [activeKey, sessions, messages]
  );

  const activeStreaming = useMemo(
    () => (activeKey && sessions[activeKey])
      ? sessions[activeKey].isStreaming
      : isStreaming,
    [activeKey, sessions, isStreaming]
  );

  const activeTurn = useMemo(
    () => (activeKey && sessions[activeKey])
      ? sessions[activeKey].isTurnActive
      : isTurnActive,
    [activeKey, sessions, isTurnActive]
  );

  const handleTabClick = React.useCallback(
    (sessionId: string, agentId: string) => {
      switchTab(sessionId, agentId);
    },
    [switchTab]
  );

  const handleTabClose = React.useCallback(
    (sessionId: string) => {
      closeSession(sessionId);
    },
    [closeSession]
  );

  const handleNewSession = React.useCallback(() => {
    newSessionWithPicker();
  }, [newSessionWithPicker]);

  const handleShowHistory = React.useCallback(() => {
    setShowHistory(true);
  }, []);

  const handleCloseHistory = React.useCallback(() => {
    setShowHistory(false);
    setSelectedHistorySession(null);
  }, []);

  const handleRestoreSession = React.useCallback((sessionId: string, agentId: string) => {
    // Find the agent and create a new session or restore existing
    getVsCodeApi().postMessage({ type: "history:restore", sessionId, agentId });
    setShowHistory(false);
  }, []);

  // Listen for history restore message from extension
  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "history:restored") {
        // Handle session restoration in extension
        console.log("Restoring session:", e.data.sessionId, e.data.agentId);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);


  const handleSend = React.useCallback(
    (text: string, attachments: ContextAttachment[]) => {
      sendMessage(text, attachments, activeAgentId ?? undefined, activeSessionId ?? undefined);
    },
    [sendMessage, activeAgentId, activeSessionId]
  );

  const handleCancel = React.useCallback(() => {
    cancelTurn(activeAgentId ?? undefined, activeSessionId ?? undefined);
  }, [cancelTurn, activeAgentId, activeSessionId]);

  return (
    <div className="app-container">
      <SessionTabs
        tabs={tabs}
        activeSessionId={activeSessionId}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabReorder={() => {}}
        onNewSession={handleNewSession}
      />
      {completedNotifications.length > 0 && (
        <div className="completion-notification-stack">
          {completedNotifications.map((notif, idx) => (
            <CompletionNotification
              key={`${notif.agentId}:${notif.sessionId}:${idx}`}
              agentId={notif.agentId}
              sessionId={notif.sessionId}
              title={notif.title}
              onDismiss={dismissCompletedNotification}
              onSwitchTab={handleTabClick}
            />
          ))}
        </div>
      )}
      <TopToolbar
        messages={activeMessages}
        agentName={activeAgentId ? agentInfoMap[activeAgentId]?.name : undefined}
        model={activeTab?.model}
        mode={activeTab?.mode}
        cwd={activeTab?.cwd}
        workspaceRoot={workspaceRoot}
        isTurnActive={activeTurn}
        onJumpToMessage={handleJumpToMessage}
      />
      <ChatContainer
        messages={activeMessages}
        isStreaming={activeStreaming}
        sessionId={activeSessionId ?? undefined}
        status={activeTab?.status}
        scrollToMessageRef={scrollToMessageRef}
        scrollStateRef={scrollStateRef}
      />
      {showScrollButton && (
        <button
          className="scroll-to-bottom-button"
          onClick={() => scrollStateRef.current.scrollToBottom()}
          aria-label="Scroll to bottom"
        >
          <span className="scroll-to-bottom-icon">↓</span>
          {scrollUnreadCount > 0 && (
            <span className="scroll-to-bottom-badge">{scrollUnreadCount}</span>
          )}
        </button>
      )}
      <Composer
        onSend={handleSend}
        onCancel={handleCancel}
        isTurnActive={activeTurn}
        disabled={!activeSessionId}
        fetchFiles={fetchFiles}
        resolveFile={resolveFile}
        resolveSelection={resolveSelection}
        resolveDiff={resolveDiff}
        fetchSymbols={fetchSymbols}
        resolveSymbol={resolveSymbol}
        availableCommands={availableCommands}
      />
      <ProgressBar status={activeTab?.status} />
      <BottomToolbar
        model={activeTab?.model}
        mode={activeTab?.mode}
        tokenUsage={activeTab?.tokenUsage ?? tokenUsage}
        contextWindowMax={activeTab?.contextWindowMax ?? ctx.contextWindowMax}
        messageCount={activeMessages.length}
        isTurnActive={activeTurn}
        sessionStatus={activeTab?.status}
        agentInfo={activeAgentId ? agentInfoMap[activeAgentId] : undefined}
        sessionId={activeSessionId ?? undefined}
        sessionStartMs={activeTab?.sessionStartMs}
        onForkSession={activeSessionId ? () => ctx.forkSession(activeSessionId) : undefined}
        statusline={statusline}
      />
    </div>
  );
}
