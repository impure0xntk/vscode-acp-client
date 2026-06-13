import React, { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { ChatContainer } from "./ChatContainer";
import { Composer } from "./Composer";
import { BottomToolbar } from "./BottomToolbar";
import { TopToolbar } from "./TopToolbar";
import { SessionTabs } from "./SessionTabs";
import { ProgressBar } from "./ProgressBar";
import { CompletionNotification } from "./CompletionNotification";
import {
  SessionHistoryPanel,
  PersistentSessionEntry,
} from "./SessionHistoryPanel";
import { SessionOverviewPanel, ResizableSessionOverviewPanel } from "./SessionOverview/SessionOverviewPanel";
import { useSessionContext } from "../hooks/useSessionContext";
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
    sessionOverviewVisible,
    sessionOverviewState,
    sessionOverviewPosition,
    sessionOverviewWidth,
    toggleSessionOverview,
    setSessionOverviewFilter,
    dispatch,
  } = ctx;

  // History panel state
  const [showHistory, setShowHistory] = React.useState(false);
  const [selectedHistorySession, setSelectedHistorySession] =
    React.useState<PersistentSessionEntry | null>(null);

  // Handle scroll state changes from ChatContainer
  const handleScrollStateChange = useCallback(
    (state: { isAtBottom: boolean; unreadCount: number }) => {
      // Show button when user has scrolled up and there are unread messages
      // or when not at bottom
      setShowScrollButton(!state.isAtBottom);
      setScrollUnreadCount(state.unreadCount);
    },
    []
  );

  const forceScrollToBottomRef = useRef<() => void>();

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

  // Per-session scroll position (scrollTop) preserved across tab switches.
  // Key: `${agentId}:${sessionId}`, Value: scrollTop.
  const sessionScrollTopsRef = useRef<Map<string, number>>(new Map());

  // Derive active session info from sessionInfoMap (source of truth from extension host)
  const activeKey =
    activeAgentId && activeSessionId
      ? sessionKey(activeAgentId, activeSessionId)
      : null;

  // Save scrollTop when leaving a session, restore when switching back.
  // Defined after activeKey to avoid TDZ access.
  const handleScrollTopChange = useCallback(
    (scrollTop: number) => {
      if (activeKey) {
        sessionScrollTopsRef.current.set(activeKey, scrollTop);
      }
    },
    [activeKey],
  );

  const activeSessionInfo = activeKey
    ? ctx.sessionInfoMap[activeKey]
    : undefined;

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

  const handleRestoreSession = React.useCallback(
    (sessionId: string, agentId: string) => {
      getVsCodeApi().postMessage({
        type: "history:restore",
        sessionId,
        agentId,
      });
      setShowHistory(false);
    },
    []
  );

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
      sendMessage(
        text,
        attachments,
        activeAgentId ?? undefined,
        activeSessionId ?? undefined
      );
      forceScrollToBottomRef.current?.();
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
  const displayTokenUsage = activeSessionInfo?.tokenUsage ?? {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const displayContextWindowMax = activeSessionInfo?.contextWindowMax;
  const displayMessageCount = activeSessionInfo?.messageCount ?? 0;
  const displaySessionStartMs = activeSessionInfo?.createdAt
    ? new Date(activeSessionInfo.createdAt).getTime()
    : undefined;

  const overviewOnLeft = sessionOverviewPosition === "left";

  // SessionOverview panel actions
  const handleOverviewFocus = useCallback(
    (sessionId: string, agentId: string) => {
      switchTab(sessionId, agentId);
    },
    [switchTab]
  );

  const handleOverviewCancel = useCallback(
    (sessionId: string, agentId: string) => {
      getVsCodeApi().postMessage({
        type: "sessionOverview:cancel",
        payload: { sessionId, agentId },
      });
    },
    []
  );

  const handleOverviewClose = useCallback(
    (sessionId: string, agentId: string) => {
      closeSession(sessionId);
    },
    [closeSession]
  );

  const handleOverviewToggleExpand = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({
      type: "sessionOverview:expand",
      payload: { sessionId },
    });
  }, []);

  const handleOverviewToggleCollapse = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({
      type: "sessionOverview:collapse",
      payload: { sessionId },
    });
  }, []);

  const handleOverviewResizeEnd = useCallback((w: number) => {
    getVsCodeApi().postMessage({
      type: "sessionOverview:setWidth",
      payload: { width: w },
    });
  }, []);

  const handleOverviewToggleSelect = useCallback(
    (sessionId: string) => {
      dispatch({ type: "TOGGLE_SESSION_OVERVIEW_SELECTED", sessionId });
    },
    [dispatch]
  );

  const handleOverviewLongPress = useCallback(
    (sessionId: string) => {
      dispatch({ type: "TOGGLE_SESSION_OVERVIEW_SELECTION", sessionId });
    },
    [dispatch]
  );

  const handleOverviewCloseSelected = useCallback(() => {
    const selectedIds = sessionOverviewState.selectedSessionIds ?? [];
    for (const sessionId of selectedIds) {
      closeSession(sessionId);
    }
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTION_MODE", enabled: false });
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTED", sessionIds: [] });
  }, [sessionOverviewState.selectedSessionIds, closeSession, dispatch]);

  const handleOverviewExitSelectionMode = useCallback(() => {
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTION_MODE", enabled: false });
    dispatch({ type: "SET_SESSION_OVERVIEW_SELECTED", sessionIds: [] });
  }, [dispatch]);

  return (
    <div
      className={`app-container${sessionOverviewVisible ? " with-overview" : ""}${overviewOnLeft ? " overview-left" : ""}`}
    >
      {overviewOnLeft && sessionOverviewVisible && (
        <ResizableSessionOverviewPanel
          isVisible={sessionOverviewVisible}
          state={sessionOverviewState}
          tabs={tabs}
          width={sessionOverviewWidth}
          onFilterChange={setSessionOverviewFilter}
          onFocus={handleOverviewFocus}
          onCancel={handleOverviewCancel}
          onClose={handleOverviewClose}
          onToggleExpand={handleOverviewToggleExpand}
          onToggleCollapse={handleOverviewToggleCollapse}
          onResizeEnd={handleOverviewResizeEnd}
          onNewSession={handleNewSession}
          onToggleSelect={handleOverviewToggleSelect}
          onLongPress={handleOverviewLongPress}
          onCloseSelected={handleOverviewCloseSelected}
          onExitSelectionMode={handleOverviewExitSelectionMode}
        />
      )}
      <div className="main-content">
        {!sessionOverviewVisible && (
          <SessionTabs
            tabs={tabs}
            activeSessionId={activeSessionId}
            sessionInfoMap={ctx.sessionInfoMap}
            connectedAgents={connectedAgents}
            overviewItems={sessionOverviewState.sessions.reduce(
              (acc, item) => {
                acc[`${item.agentId}:${item.sessionId}`] = item;
                return acc;
              },
              {} as Record<string, import("../types").SessionOverviewItem>
            )}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabReorder={() => {}}
            onNewSession={handleNewSession}
          />
        )}
        {completedNotifications.length > 0 &&
          (() => {
            // Filter out notifications for sessions that have been closed
            const validNotifications = completedNotifications.filter((notif) =>
              tabs.some(
                (t) =>
                  t.sessionId === notif.sessionId && t.agentId === notif.agentId
              )
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
          agentName={
            activeAgentId ? agentInfoMap[activeAgentId]?.name : undefined
          }
          model={displayModel}
          mode={displayMode}
          cwd={displayCwd}
          workspaceRoot={workspaceRoot}
          isTurnActive={displayIsTurnActive}
          onJumpToMessage={handleJumpToMessage}
          sessionOverviewVisible={sessionOverviewVisible}
          onToggleSessionOverview={toggleSessionOverview}
          sessionOverviewPosition={sessionOverviewPosition}
        />
        <div className="chat-container-wrapper">
          <ChatContainer
            key={activeKey ?? "none"}
            messages={ctx.messages}
            isStreaming={ctx.isStreaming}
            sessionId={activeSessionId ?? undefined}
            status={displayStatus}
            isActive={true}
            scrollToMessageRef={scrollToMessageRef}
            scrollStateRef={scrollStateRef}
            onScrollStateChange={handleScrollStateChange}
            forceScrollToBottomRef={forceScrollToBottomRef}
            savedScrollTop={activeKey ? sessionScrollTopsRef.current.get(activeKey) : undefined}
            onScrollTopChange={handleScrollTopChange}
          />
          {showScrollButton && (
            <button
              className="scroll-to-bottom-button"
              onClick={() => scrollStateRef.current?.scrollToBottom()}
              aria-label="Scroll to bottom"
            >
              <span className="scroll-to-bottom-icon">↓</span>
              {scrollUnreadCount > 0 && (
                <span className="scroll-to-bottom-badge">
                  {scrollUnreadCount}
                </span>
              )}
            </button>
          )}
        </div>
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
        <ProgressBar
          status={displayStatus}
          lastActivityMs={
            activeSessionInfo?.updatedAt
              ? new Date(activeSessionInfo.updatedAt).getTime()
              : undefined
          }
        />
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
          onForkSession={
            activeSessionId ? () => ctx.forkSession(activeSessionId) : undefined
          }
          statusline={statusline}
          cwd={displayCwd}
        />
      </div>
      {!overviewOnLeft && sessionOverviewVisible && (
        <ResizableSessionOverviewPanel
          isVisible={sessionOverviewVisible}
          state={sessionOverviewState}
          tabs={tabs}
          width={sessionOverviewWidth}
          onFilterChange={setSessionOverviewFilter}
          onFocus={handleOverviewFocus}
          onCancel={handleOverviewCancel}
          onClose={handleOverviewClose}
          onToggleExpand={handleOverviewToggleExpand}
          onToggleCollapse={handleOverviewToggleCollapse}
          onResizeEnd={handleOverviewResizeEnd}
          onNewSession={handleNewSession}
          onToggleSelect={handleOverviewToggleSelect}
          onLongPress={handleOverviewLongPress}
          onCloseSelected={handleOverviewCloseSelected}
          onExitSelectionMode={handleOverviewExitSelectionMode}
        />
      )}
    </div>
  );
}
