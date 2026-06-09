import React, { useMemo } from "react";
import { ChatContainer } from "./ChatContainer";
import { Composer } from "./Composer";
import { Toolbar } from "./Toolbar";
import { SessionTabs } from "./SessionTabs";
import { RunningToolOverlay } from "./RunningToolOverlay";
import { CompletionNotification } from "./CompletionNotification";
import { SessionHistoryPanel, PersistentSessionEntry } from "./SessionHistoryPanel";
import { useSessionContext } from "../hooks/useSessionContext";
import { ErrorBoundary } from "./ErrorBoundary";
import type { ContextAttachment } from "../types";

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
    latestRunningTool,
    completedNotification,
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
  } = ctx;

  // History panel state
  const [showHistory, setShowHistory] = React.useState(false);
  const [selectedHistorySession, setSelectedHistorySession] = React.useState<PersistentSessionEntry | null>(null);

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
    vscode.postMessage({ type: "history:restore", sessionId, agentId });
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
      {completedNotification && (
        <CompletionNotification
          agentId={completedNotification.agentId}
          sessionId={completedNotification.sessionId}
          title={completedNotification.title}
          onDismiss={dismissCompletedNotification}
          onSwitchTab={handleTabClick}
        />
      )}
      <RunningToolOverlay tool={latestRunningTool} />
      <ChatContainer
        messages={activeMessages}
        isStreaming={activeStreaming}
        sessionId={activeSessionId ?? undefined}
        status={activeTab?.status}
      />
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
      <Toolbar
        model={activeTab?.model}
        mode={activeTab?.mode}
        cwd={activeTab?.cwd}
        workspaceRoot={workspaceRoot}
        tokenUsage={activeTab?.tokenUsage ?? tokenUsage}
        contextWindowMax={activeTab?.contextWindowMax ?? ctx.contextWindowMax}
        messageCount={activeMessages.length}
        isTurnActive={activeTurn}
        sessionStatus={activeTab?.status}
        agentInfo={activeAgentId ? agentInfoMap[activeAgentId] : undefined}
        sessionId={activeSessionId ?? undefined}
        sessionStartMs={activeTab?.sessionStartMs}
        onForkSession={activeSessionId ? () => ctx.forkSession(activeSessionId) : undefined}
      />
    </div>
  );
}
