import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useLogger } from "../hooks/useLogger";
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
import { MeshPanel } from "../components/MeshPanel";
import {
  useSessionStore,
  sessionKeyOf,
  selectTabs,
  selectOverviewItemsMap,
} from "../store/sessionStore";
import type { SessionState, SessionTabState } from "../store/sessionStore";
import { useMessageStore } from "../store/messageStore";
import { useUiStateStore } from "../store/uiStateStore";
import { useMeshStore } from "../store/meshStore";
import { getVsCodeApi } from "../lib/vscodeApi";
import { useShallow } from "zustand/shallow";
import { useChatHandlers } from "./hooks/useChatHandlers";
import { useOverviewHandlers } from "./hooks/useOverviewHandlers";
import { ChatArea } from "./ChatArea";
import type { ContextAttachment, SendTarget } from "../types";

export function AppContainer(): React.ReactElement {
  const log = useLogger("AppContainer");
  // ── Direct store subscriptions ──────────────────────────────────────
  // Subscribe to activeSessionKey (triggers re-render on session switch)
  // AND sessionInfoMap (triggers re-render when sessions are added/removed).
  // We use useShallow to avoid re-renders on every streaming field change —
  // the no-op guards in store actions ensure referential stability.
  const {
    activeSessionKey,
    sessionInfoMap,
    tabOrder,
    tabTitles,
    tabIcons,
    workspaceRoot,
    connectedAgents,
    agentInfoMap,
    sessionCommands,
    statusline,
  } = useSessionStore(useShallow((s: SessionState) => ({
    activeSessionKey: s.activeSessionKey,
    sessionInfoMap: s.sessionInfoMap,
    tabOrder: s.tabOrder,
    tabTitles: s.tabTitles,
    tabIcons: s.tabIcons,
    workspaceRoot: s.workspaceRoot,
    connectedAgents: s.connectedAgents,
    agentInfoMap: s.agentInfoMap,
    sessionCommands: s.sessionCommands,
    statusline: s.statusline,
  })));

  // Derive tabs from already-subscribed store primitives.
  const tabs = useMemo<SessionTabState[]>(() => {
    const orderedKeys = tabOrder.length > 0
      ? tabOrder
      : Object.keys(sessionInfoMap);
    return orderedKeys
      .filter((key) => sessionInfoMap[key])
      .map((key): SessionTabState => {
        const [agentId, sessionId] = key.split(":");
        return {
          sessionId,
          agentId,
          title: tabTitles[key] ?? sessionId,
          agentIcon: tabIcons[key],
        };
      });
  }, [sessionInfoMap, tabOrder, tabTitles, tabIcons]);

  const {
    overviewVisible,
    overviewWidth,
    overviewPosition,
    overviewFilter,
    overviewExpandedSessions,
    overviewSelectedSessionIds,
    overviewSelectionMode,
  } = useUiStateStore(useShallow((s) => ({
    overviewVisible: s.overviewVisible,
    overviewWidth: s.overviewWidth,
    overviewPosition: s.overviewPosition,
    overviewFilter: s.overviewFilter,
    overviewExpandedSessions: s.overviewExpandedSessions,
    overviewSelectedSessionIds: s.overviewSelectedSessionIds,
    overviewSelectionMode: s.overviewSelectionMode,
  })));

  // ── Derived values ──────────────────────────────────────────────────
  const activeSessionId = activeSessionKey ? activeSessionKey.split(":")[1] : null;
  const activeAgentId = activeSessionKey ? activeSessionKey.split(":")[0] : null;

  const activeSessionInfo = activeSessionKey
    ? sessionInfoMap[activeSessionKey]
    : undefined;

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

  // Read messages/streaming imperatively to avoid subscribing to the
  // entire perSession/streaming maps. Subscribing causes an infinite loop
  // because every store write creates new object references, which triggers
  // re-render → new snapshot → repeat.
  const activeMessages = activeSessionKey
    ? useMessageStore.getState().perSession[activeSessionKey] ?? []
    : [];
  const activeIsStreaming = activeSessionKey
    ? useMessageStore.getState().streaming[activeSessionKey] ?? false
    : false;

  const availableCommands = activeSessionKey
    ? sessionCommands[activeSessionKey] ?? []
    : [];

  const overviewOnLeft = overviewPosition === "left";

  // ── Local state ─────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] =
    useState<PersistentSessionEntry | null>(null);
  const [completedNotifications, setCompletedNotifications] = useState<
    Array<{ agentId: string; sessionId: string; title: string }>
  >([]);

  const scrollToMessageRef = useRef<(id: string) => void>();

  // ── Mesh panel visibility ──────────────────────────────────────────
  const meshPanelVisible = useMeshStore((s) => s.meshPanelVisible);
  const setMeshPanelVisible = useMeshStore((s) => s.setMeshPanelVisible);

  // ── Actions ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    (text: string, attachments: ContextAttachment[] = [], agentId?: string, sessionId?: string, targets?: SendTarget[]) => {
      if (targets && targets.length > 0) {
        getVsCodeApi().postMessage({ type: "mesh:directMulti", text, attachments, targets });
      } else {
        getVsCodeApi().postMessage({ type: "sendMessage", text, attachments, agentId, sessionId });
      }
    },
    []
  );

  const cancelTurn = useCallback((agentId?: string, sessionId?: string) => {
    getVsCodeApi().postMessage({ type: "cancelTurn", agentId, sessionId });
  }, []);

  const switchTab = useCallback((agentId: string, sessionId: string) => {
    getVsCodeApi().postMessage({ type: "switchSession", sessionId, agentId });
  }, []);

  const newSessionWithPicker = useCallback(() => {
    getVsCodeApi().postMessage({ type: "openNewSessionPicker" });
  }, []);

  const closeSession = useCallback((agentId: string, sessionId: string) => {
    const store = useSessionStore.getState();
    const key = sessionKeyOf(agentId, sessionId);
    store.removeTab(key);
    useUiStateStore.getState().clearScrollState(key);
    getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
  }, []);

  const forkSession = useCallback((sessionId: string) => {
    getVsCodeApi().postMessage({ type: "forkSession", sessionId });
  }, []);

  const toggleSessionOverview = useCallback(() => {
    const cur = useUiStateStore.getState().overviewVisible;
    useUiStateStore.getState().setOverviewVisible(!cur);
  }, []);

  const toggleMeshPanel = useCallback(() => {
    setMeshPanelVisible(!meshPanelVisible);
  }, [meshPanelVisible, setMeshPanelVisible]);

  const setSessionOverviewFilter = useCallback((filter: typeof overviewFilter) => {
    useUiStateStore.getState().setOverviewFilter(filter);
  }, []);

  const toggleSessionOverviewSelection = useCallback((sessionId: string) => {
    useUiStateStore.getState().toggleOverviewSelected(sessionId);
  }, []);

  const setSessionOverviewSelection = useCallback((sessionIds: string[]) => {
    useUiStateStore.getState().setOverviewSelectedSessionIds(sessionIds);
  }, []);

  const dismissCompletedNotification = useCallback(() => {
    setCompletedNotifications((prev) => prev.slice(1));
  }, []);

  // ── Handlers via hooks ──────────────────────────────────────────────
  const forceScrollToBottomRef = useRef<() => void>();
  const { handleSend, handleCancel } = useChatHandlers({
    activeAgentId,
    activeSessionId,
    sendMessage,
    cancelTurn,
    forceScrollToBottomRef,
  });

  // Mesh-aware send handler that accepts targets from Composer
  const handleMeshSend = useCallback(
    (text: string, attachments: ContextAttachment[], targets?: SendTarget[]) => {
      if (targets && targets.length > 0) {
        sendMessage(text, attachments, undefined, undefined, targets);
      } else {
        sendMessage(text, attachments, activeAgentId ?? undefined, activeSessionId ?? undefined);
      }
      forceScrollToBottomRef.current?.();
    },
    [sendMessage, forceScrollToBottomRef, activeAgentId, activeSessionId]
  );

  const overviewState = useMemo(
    () => ({
      filter: overviewFilter,
      expandedSessions: overviewExpandedSessions,
      selectedSessionIds: overviewSelectedSessionIds,
      selectionMode: overviewSelectionMode,
    }),
    [overviewFilter, overviewExpandedSessions, overviewSelectedSessionIds, overviewSelectionMode]
  );

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
    sessionOverviewState: overviewState,
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
        log.info("restoring session", { sessionId: e.data.sessionId, agentId: e.data.agentId });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [log]);

  // ── Derived data ────────────────────────────────────────────────────
  const validNotifications = useMemo(
    () =>
      completedNotifications.filter((notif) =>
        tabs.some(
          (t) =>
            t.sessionId === notif.sessionId && t.agentId === notif.agentId,
        ),
      ),
    [completedNotifications, tabs],
  );

  // Derive overview items as a lookup map.
  // selectOverviewItemsMap returns a new object each call, so we memoize
  // based on the upstream primitives (sessionInfoMap, tabOrder, tabTitles)
  // that are already subscribed above. This avoids triggering re-renders
  // from a separate store subscription.
  const overviewItemsMap = useMemo(
    () => selectOverviewItemsMap(useSessionStore.getState()),
    [sessionInfoMap, tabOrder, tabTitles],
  );

  // ── File/symbol resolution (kept as-is for now) ─────────────────────
  const fetchFiles = useCallback((query: string) => {
    return new Promise<import("../types").FileCandidate[]>((resolve) => {
      const reqId = crypto.randomUUID();
      const handler = (event: MessageEvent) => {
        if (event.data.type === "fileCandidates" && event.data.reqId === reqId) {
          window.removeEventListener("message", handler);
          resolve(event.data.candidates ?? []);
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "fetchFiles", query, reqId });
    });
  }, []);

  const resolveFile = useCallback((path: string) => {
    return new Promise<ContextAttachment>((resolve, reject) => {
      const reqId = crypto.randomUUID();
      const handler = (event: MessageEvent) => {
        if (event.data.type === "resolvedFile" && event.data.reqId === reqId) {
          window.removeEventListener("message", handler);
          if (event.data.attachment) {
            resolve(event.data.attachment as ContextAttachment);
          } else {
            reject(new Error((event.data.error as string) ?? "Failed to resolve file"));
          }
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "resolveFile", path, reqId });
    });
  }, []);

  const resolveSelection = useCallback(() => {
    return new Promise<ContextAttachment | null>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "resolvedSelection") {
          window.removeEventListener("message", handler);
          resolve(event.data.attachment as ContextAttachment | null);
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "resolveSelection" });
    });
  }, []);

  const resolveDiff = useCallback(() => {
    return new Promise<ContextAttachment | null>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "resolvedDiff") {
          window.removeEventListener("message", handler);
          resolve(event.data.attachment as ContextAttachment | null);
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "resolveDiff" });
    });
  }, []);

  const fetchSymbols = useCallback((query: string) => {
    return new Promise<import("../types").SuggestionItem[]>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "symbolCandidates" && event.data.query === query) {
          window.removeEventListener("message", handler);
          resolve((event.data.candidates as import("../types").SuggestionItem[]) ?? []);
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "fetchSymbols", query });
    });
  }, []);

  const resolveSymbol = useCallback((name: string) => {
    return new Promise<ContextAttachment>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        if (event.data.type === "resolvedSymbol" && event.data.name === name) {
          window.removeEventListener("message", handler);
          if (event.data.attachment) {
            resolve(event.data.attachment as ContextAttachment);
          } else {
            reject(new Error((event.data.error as string) ?? "Failed to resolve symbol"));
          }
        }
      };
      window.addEventListener("message", handler);
      getVsCodeApi().postMessage({ type: "resolveSymbol", name });
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      className={`app-container${overviewVisible ? " with-overview" : ""}${overviewOnLeft ? " overview-left" : ""}`}
    >
      {overviewOnLeft && overviewVisible && (
        <ResizableSessionOverviewPanel
          isVisible={overviewVisible}
          state={overviewState}
          connectedAgents={connectedAgents}
          width={overviewWidth}
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
        {!overviewVisible && (
          <SessionTabs
            tabs={tabs}
            activeSessionId={activeSessionId}
            activeAgentId={activeAgentId}
            connectedAgents={connectedAgents}
            overviewItems={overviewItemsMap}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabReorder={(tabs) => {
              const order = tabs.map((t) => sessionKeyOf(t.agentId, t.sessionId));
              useSessionStore.getState().setTabOrder(order);
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
          messages={activeMessages}
          agentId={activeAgentId ?? undefined}
          agentName={activeAgentId ? agentInfoMap[activeAgentId]?.name : undefined}
          connectedAgents={connectedAgents}
          model={displayModel}
          mode={displayMode}
          cwd={displayCwd}
          workspaceRoot={workspaceRoot}
          isTurnActive={displayIsTurnActive}
          onJumpToMessage={handleJumpToMessage}
          sessionOverviewVisible={overviewVisible}
          onToggleSessionOverview={toggleSessionOverview}
          sessionOverviewPosition={overviewPosition}
        />
        <ChatArea
          activeKey={activeSessionKey}
          messages={activeMessages}
          isStreaming={activeIsStreaming}
          status={displayStatus}
          isTurnActive={displayIsTurnActive}
          disabled={!activeSessionId}
          onSend={handleMeshSend}
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
          statusline={statusline}
          cwd={displayCwd}
        />
      </div>

      {meshPanelVisible && (
        <MeshPanel onClose={() => setMeshPanelVisible(false)} />
      )}

      {showHistory && (
        <SessionHistoryPanel onClose={handleCloseHistory} onRestore={handleRestoreSession} />
      )}

      {!overviewOnLeft && overviewVisible && (
        <ResizableSessionOverviewPanel
          isVisible={overviewVisible}
          state={overviewState}
          connectedAgents={connectedAgents}
          width={overviewWidth}
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
