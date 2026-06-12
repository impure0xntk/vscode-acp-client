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
import type { ContextAttachment } from "../types";
import { getVsCodeApi } from "../lib/vscodeApi";

function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

export function App(): React.ReactElement {
  const ctx = useSessionContext();

  const {
    sendMessage,
    cancelTurn,
    tabs,
    activeSessionId,
    activeAgentId,
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
    dispatch,
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

  // Derive active session info from sessionInfoMap (source of truth from extension host)
  const activeKey = activeAgentId && activeSessionId
    ? sessionKey(activeAgentId, activeSessionId)
    : null;

  const activeSessionInfo = activeKey ? ctx.sessionInfoMap[activeKey] : undefined;

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
    getVsCodeApi().postMessage({ type: "history:restore", sessionId, agentId });
    setShowHistory(false);
  }, []);

  // Listen for history restore message from extension
  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "history:restored") {
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

  // Derive display values from sessionInfoMap
  const displayModel = activeSessionInfo?.model;
  const displayMode = activeSessionInfo?.mode;
  const displayCwd = activeSessionInfo?.cwd;
  const displayStatus = activeSessionInfo?.status;
  const displayIsTurnActive = activeSessionInfo?.isTurnActive ?? false;
  const displayTokenUsage = activeSessionInfo?.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const displayContextWindowMax = activeSessionInfo?.contextWindowMax;
  const displayMessageCount = activeSessionInfo?.messageCount ?? 0;
  const displaySessionStartMs = activeSessionInfo?.createdAt
    ? new Date(activeSessionInfo.createdAt).getTime()
    : undefined;

  return (
    <div className="app-container">
      <SessionTabs
        tabs={tabs}
        activeSessionId={activeSessionId}
        sessionInfoMap={ctx.sessionInfoMap}
        connectedAgents={connectedAgents}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabReorder={() => {}}
        onNewSession={handleNewSession}
      />
      {completedNotifications.length > 0 && (() => {
        // Filter out notifications for sessions that have been closed
        const validNotifications = completedNotifications.filter((notif) =>
          tabs.some((t) => t.sessionId === notif.sessionId && t.agentId === notif.agentId)
        );
        if (validNotifications.length === 0) return null;
        return (
          <div className="completion-notification-stack">
            {validNotifications.map((notif, idx) => (
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
        );
      })()}
      <TopToolbar
        messages={ctx.messages}
        agentName={activeAgentId ? agentInfoMap[activeAgentId]?.name : undefined}
        model={displayModel}
        mode={displayMode}
        cwd={displayCwd}
        workspaceRoot={workspaceRoot}
        isTurnActive={displayIsTurnActive}
        onJumpToMessage={handleJumpToMessage}
      />
      <ChatContainer
        messages={ctx.messages}
        isStreaming={ctx.isStreaming}
        sessionId={activeSessionId ?? undefined}
        status={displayStatus}
        isActive={true}
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
        isTurnActive={displayIsTurnActive}
        disabled={!activeSessionId}
        fetchFiles={fetchFiles}
        resolveFile={resolveFile}
        resolveSelection={resolveSelection}
        resolveDiff={resolveDiff}
        fetchSymbols={fetchSymbols}
        resolveSymbol={resolveSymbol}
        availableCommands={availableCommands}
      />
      <ProgressBar status={displayStatus} lastActivityMs={activeSessionInfo?.updatedAt ? new Date(activeSessionInfo.updatedAt).getTime() : undefined} />
      <BottomToolbar
        model={displayModel}
        mode={displayMode}
        tokenUsage={displayTokenUsage}
        contextWindowMax={displayContextWindowMax}
        messageCount={displayMessageCount}
        isTurnActive={displayIsTurnActive}
        sessionStatus={displayStatus}
        agentInfo={activeAgentId ? agentInfoMap[activeAgentId] : undefined}
        sessionId={activeSessionId ?? undefined}
        sessionStartMs={displaySessionStartMs}
        onForkSession={activeSessionId ? () => ctx.forkSession(activeSessionId) : undefined}
        statusline={statusline}
        cwd={displayCwd}
      />
    </div>
  );
}
