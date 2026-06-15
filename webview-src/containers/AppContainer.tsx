import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useLogger } from "../hooks/useLogger";
import { BottomToolbar } from "../components/toolbar";
import { TopToolbar } from "../components/TopToolbar";
import { SessionTabs } from "../components/SessionTabs";
import { CompletionNotification } from "../components/CompletionNotification";
import type { TurnOutcome } from "../components/StatusIcon";
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
} from "../store/sessionStore";
import type { SessionStoreState, SessionTabState } from "../store/sessionStore";
import { useMessageStore } from "../store/messageStore";
import { useUiStateStore } from "../store/uiStateStore";
import { useMeshStore } from "../store/meshStore";
import { getVsCodeApi } from "../lib/vscodeApi";
import { setPendingSwitch } from "../webviewMessageHandler";
import { useShallow } from "zustand/shallow";
import { useChatHandlers } from "./hooks/useChatHandlers";
import { useOverviewHandlers } from "./hooks/useOverviewHandlers";
import { ChatArea } from "./ChatArea";
import type { ContextAttachment, SendTarget } from "../types";

export function AppContainer(): React.ReactElement {
  const log = useLogger("AppContainer");
  // ── Direct store subscriptions ──────────────────────────────────────
  // Subscribe only to structural state — NOT sessionInfoMap.
  // Every streaming field update creates a new immer object, so subscribing to
  // sessionInfoMap would re-render the entire tree on every token/status change.
  // Instead, activeSessionInfo is read imperatively when activeSessionKey changes,
  // and live fields (status, elapsed) are read directly by child components.
  const {
    activeSessionKey,
    tabOrder,
    tabTitles,
    tabIcons,
    workspaceRoot,
    connectedAgents,
    agentInfoMap,
    sessionCommands,
    statusline,
  } = useSessionStore(useShallow((s: SessionStoreState) => ({
    activeSessionKey: s.activeSessionKey,
    tabOrder: s.tabOrder,
    tabTitles: s.tabTitles,
    tabIcons: s.tabIcons,
    workspaceRoot: s.workspaceRoot,
    connectedAgents: s.connectedAgents,
    agentInfoMap: s.agentInfoMap,
    sessionCommands: s.sessionCommands,
    statusline: s.statusline,
  })));

  // Derive activeSessionInfo imperatively — only re-read when activeSessionKey changes.
  const activeSessionInfo = useMemo(
    () => (activeSessionKey ? useSessionStore.getState().sessionInfoMap[activeSessionKey] : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSessionKey],
  );

  // Derive tabs from tabOrder only — no sessionInfoMap dependency.
  // tabOrder is the sole source of truth for which tabs exist and their order.
  const tabs = useMemo<SessionTabState[]>(
    () =>
      tabOrder.map((key: string): SessionTabState => {
        const [agentId, sessionId] = key.split(":");
        return {
          sessionId,
          agentId,
          title: tabTitles[key] ?? sessionId,
          agentIcon: tabIcons[key],
        };
      }),
    [tabOrder, tabTitles, tabIcons],
  );

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

  const displayModel = activeSessionInfo?.model;
  const displayMode = activeSessionInfo?.mode;
  const displayCwd = activeSessionInfo?.cwd;
  const displayStatus = activeSessionInfo?.status;
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

  const availableCommands = activeSessionKey
    ? sessionCommands[activeSessionKey] ?? []
    : [];

  const overviewOnLeft = overviewPosition === "left";

  // ── Local state ─────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] =
    useState<PersistentSessionEntry | null>(null);
  const [completedNotifications, setCompletedNotifications] = useState<
    Array<{ agentId: string; sessionId: string; title: string; outcome: TurnOutcome }>
  >([]);

  const scrollToMessageRef = useRef<(id: string) => void>();

  // ── Mesh panel visibility ──────────────────────────────────────────
  const meshPanelVisible = useMeshStore((s) => s.meshPanelVisible);
  const setMeshPanelVisible = useMeshStore((s) => s.setMeshPanelVisible);

  // ── Actions ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    (text: string, attachments: ContextAttachment[] = [], agentId?: string, sessionId?: string, targets?: SendTarget[]) => {
      // Always route through mesh:directMulti for a single code path (DRY).
      // Build targets from explicit targets or fall back to the active session.
      const resolvedTargets: SendTarget[] = targets?.length
        ? targets
        : agentId && sessionId
          ? [{ agentId, sessionId, label: displayModel ?? agentId, status: displayStatus ?? "idle" }]
          : activeAgentId && activeSessionId
            ? [{ agentId: activeAgentId, sessionId: activeSessionId, label: displayModel ?? activeAgentId, status: displayStatus ?? "idle" }]
            : [];

      // Guard: if no targets resolved, the session is not yet established.
      // Dropping the message prevents it from being silently lost.
      if (resolvedTargets.length === 0) {
        log.warn("sendMessage dropped — no active session", { textLen: text.length });
        return;
      }

      getVsCodeApi().postMessage({ type: "mesh:send", text, attachments, targets: resolvedTargets });
    },
    [activeAgentId, activeSessionId, displayModel, displayStatus]
  );

  const cancelTurn = useCallback((agentId?: string, sessionId?: string) => {
    getVsCodeApi().postMessage({ type: "cancelTurn", agentId, sessionId });
  }, []);

  const switchTab = useCallback((agentId: string, sessionId: string) => {
    const key = sessionKeyOf(agentId, sessionId);
    const prevKey = useSessionStore.getState().activeSessionKey;
    log.info("session switch", { from: prevKey, to: key });
    useSessionStore.getState().setActiveSession(key);
    scrollToMessageRef.current = undefined;
    // Set the guard so that a stale session/switch echo from the extension
    // (arriving after a subsequent switch) is discarded.
    setPendingSwitch(agentId, sessionId);
    getVsCodeApi().postMessage({ type: "switchSession", sessionId, agentId });
  }, []);

  const newSessionWithPicker = useCallback(() => {
    log.info("new session picker requested");
    getVsCodeApi().postMessage({ type: "openNewSessionPicker" });
  }, []);

  const closeSession = useCallback((agentId: string, sessionId: string) => {
    const store = useSessionStore.getState();
    const key = sessionKeyOf(agentId, sessionId);
    log.info("close session", { agentId, sessionId });
    store.removeTab(key);
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

  // Derive overview items as a lookup map — structural data only.
  // Does NOT read sessionInfoMap. Live status/fields are handled by each
  // SessionOverviewCard via useSessionInfo(sessionKey).
  const overviewItemsMap = useMemo(() => {
    const acc: Record<string, import("../types").SessionOverviewItem> = {};
    for (const key of tabOrder) {
      const [agentId, sessionId] = key.split(":");
      acc[key] = {
        sessionId,
        agentId,
        title: tabTitles[key] ?? sessionId,
        status: "idle",
        lastTurnOutcome: null,
        progress: {
          elapsedMs: 0,
          tokenUsage: { input: 0, output: 0, total: 0 },
          messageCount: 0,
          toolCallCount: 0,
          toolCallsCompleted: 0,
        },
        recentResponses: [],
        createdAt: new Date().toISOString(),
        lastResponseAt: null,
      };
    }
    return acc;
  }, [tabOrder, tabTitles]);

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
                outcome={notif.outcome}
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
          status={displayStatus}
          onJumpToMessage={handleJumpToMessage}
          sessionOverviewVisible={overviewVisible}
          onToggleSessionOverview={toggleSessionOverview}
          sessionOverviewPosition={overviewPosition}
        />
        <ChatArea
          activeKey={activeSessionKey}
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
