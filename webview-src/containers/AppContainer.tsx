import React, { useMemo, useRef, useState, useEffect } from "react";
import { BottomToolbar } from "../components/toolbar";
import { TopToolbar } from "../components/TopToolbar";
import { SessionTabs } from "../components/SessionTabs";
import { CompletionNotification } from "../components/CompletionNotification";
import {
  SessionHistoryPanel,
  PersistentSessionEntry,
} from "../components/SessionHistory";
import {
  ResizableSessionOverviewPanel,
} from "../components/SessionOverview/SessionOverviewPanel";
import { useSessionContext } from "../hooks/useSessionContext";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import { useMessageStore } from "../store/messageStore";
import { useChatHandlers } from "./hooks/useChatHandlers";
import { useOverviewHandlers } from "./hooks/useOverviewHandlers";
import { ChatArea } from "./ChatArea";

// ── Legacy compat: sessionKey for components that still use agentId+sessionId ──
function sessionKey(agentId: string, sessionId: string): string {
  return sessionKeyOf(agentId, sessionId);
}

export function AppContainer(): React.ReactElement {
  const ctx = useSessionContext();

  const {
    tabs,
    activeSessionId,
    activeAgentId,
    workspaceRoot,
    connectedAgents,
    agentInfoMap,
    dismissCompletedNotification,
    switchTab,
    newSessionWithPicker,
    closeSession,
    fetchFiles,
    resolveFile,
    resolveSelection,
    resolveDiff,
    fetchSymbols,
    resolveSymbol,
    availableCommands,
    sessionOverviewVisible,
    sessionOverviewState,
    sessionOverviewPosition,
    sessionOverviewWidth,
    toggleSessionOverview,
    setSessionOverviewFilter,
    dispatch,
    forkSession,
  } = ctx;

  // History panel state
  const [showHistory, setShowHistory] = React.useState(false);
  const [selectedHistorySession, setSelectedHistorySession] =
    React.useState<PersistentSessionEntry | null>(null);

  const scrollToMessageRef = useRef<(id: string) => void>();

  const activeKey =
    activeAgentId && activeSessionId
      ? sessionKey(activeAgentId, activeSessionId)
      : null;

  const activeSessionInfo = activeKey
    ? ctx.sessionInfoMap[activeKey]
    : undefined;

  // Derived display values — all from sessionInfoMap
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

  // ── Handlers via hooks ──────────────────────────────────────────────

  const forceScrollToBottomRef = useRef<() => void>();
  const { handleSend, handleCancel } = useChatHandlers({
    activeAgentId,
    activeSessionId,
    sendMessage: ctx.sendMessage,
    cancelTurn: ctx.cancelTurn,
    forceScrollToBottomRef,
  });

  const {
    handleFocus: handleOverviewFocus,
    handleCancel: handleOverviewCancel,
    handleClose: handleOverviewClose,
    handleToggleExpand: handleOverviewToggleExpand,
    handleToggleCollapse: handleOverviewToggleCollapse,
    handleResizeEnd: handleOverviewResizeEnd,
    handleToggleSelect: handleOverviewToggleSelect,
    handleLongPress: handleOverviewLongPress,
    handleCloseSelected: handleOverviewCloseSelected,
    handleExitSelectionMode: handleOverviewExitSelectionMode,
  } = useOverviewHandlers({
    switchTab,
    closeSession,
    sessionOverviewState,
    dispatch,
  });

  const handleJumpToMessage = (messageId: string) => {
    scrollToMessageRef.current?.(messageId);
  };

  const handleTabClick = (sessionId: string, agentId: string) => {
    switchTab(agentId, sessionId);
  };

  const handleTabClose = (sessionId: string, agentId: string) => {
    closeSession(agentId, sessionId);
  };

  const handleNewSession = () => {
    newSessionWithPicker();
  };

  const handleShowHistory = () => setShowHistory(true);
  const handleCloseHistory = () => {
    setShowHistory(false);
    setSelectedHistorySession(null);
  };

  const handleRestoreSession = (sessionId: string, agentId: string) => {
    switchTab(agentId, sessionId);
    setShowHistory(false);
  };

  // Listen for history restore message from extension
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "history:restored") {
        console.log("Restoring session:", e.data.sessionId, e.data.agentId);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Derived data ────────────────────────────────────────────────────

  const validNotifications = useMemo(
    () =>
      ctx.completedNotifications.filter((notif) =>
        tabs.some(
          (t) =>
            t.sessionId === notif.sessionId && t.agentId === notif.agentId,
        ),
      ),
    [ctx.completedNotifications, tabs],
  );

  // Subscribe to perSession so the memo recomputes when messages change.
  const perSession = useMessageStore((s) => s.perSession);
  // Derive overview items as a lookup map — single source of truth via getOverviewItems()
  const overviewItemsMap = useMemo(() => {
    const items = useSessionStore.getState().getOverviewItems();
    const acc: Record<string, import("../types").SessionOverviewItem> = {};
    for (const item of items) {
      acc[`${item.agentId}:${item.sessionId}`] = item;
    }
    return acc;
  }, [tabs, ctx.sessionInfoMap, perSession]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      className={`app-container${sessionOverviewVisible ? " with-overview" : ""}${overviewOnLeft ? " overview-left" : ""}`}
    >
      {overviewOnLeft && sessionOverviewVisible && (
        <ResizableSessionOverviewPanel
          isVisible={sessionOverviewVisible}
          state={sessionOverviewState}
          connectedAgents={connectedAgents}
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
            activeAgentId={activeAgentId}
            connectedAgents={connectedAgents}
            overviewItems={overviewItemsMap}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabReorder={(tabs) => {
              dispatch({ type: "REORDER_TABS", tabs });
            }}
            onNewSession={handleNewSession}
          />
        )}
        {validNotifications.length > 0 && (
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
        )}
        <TopToolbar
          messages={ctx.messages}
          agentId={activeAgentId ?? undefined}
          agentName={activeAgentId ? agentInfoMap[activeAgentId]?.name : undefined}
          connectedAgents={connectedAgents}
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
        <ChatArea
          activeKey={activeKey}
          messages={ctx.messages}
          isStreaming={ctx.isStreaming}
          status={displayStatus}
          isTurnActive={displayIsTurnActive}
          disabled={!activeSessionId}
          onSend={handleSend}
          onCancel={handleCancel}
          onSwitchSession={switchTab}
          fetchFiles={fetchFiles}
          resolveFile={resolveFile}
          resolveSelection={resolveSelection}
          resolveDiff={resolveDiff}
          fetchSymbols={fetchSymbols}
          resolveSymbol={resolveSymbol}
          availableCommands={availableCommands}
          scrollToMessageRef={scrollToMessageRef}
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
          onForkSession={activeSessionId ? () => forkSession(activeSessionId) : undefined}
          statusline={ctx.statusline}
          cwd={displayCwd}
        />
      </div>

      {showHistory && (
        <SessionHistoryPanel onClose={handleCloseHistory} onRestore={handleRestoreSession} />
      )}

      {!overviewOnLeft && sessionOverviewVisible && (
        <ResizableSessionOverviewPanel
          isVisible={sessionOverviewVisible}
          state={sessionOverviewState}
          connectedAgents={connectedAgents}
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
