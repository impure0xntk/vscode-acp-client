import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useLogger } from "../hooks/useLogger";
import { CompletionNotification } from "../components/CompletionNotification";
import type { TurnOutcome } from "../components/StatusIcon";
import {
  SessionHistoryPanel,
  PersistentSessionEntry,
} from "../components/SessionHistory";
import { ResizableSessionOverviewPanel } from "../components/SessionOverview/SessionOverviewPanel";
import { MeshPanel } from "../components/MeshPanel";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import type { SessionStoreState } from "../store/sessionStore";
import { useUiStateStore } from "../store/uiStateStore";
import { useMeshStore } from "../store/meshStore";
import { getVsCodeApi } from "../lib/vscodeApi";
import { setPendingSwitch } from "../webviewMessageHandler";
import { useShallow } from "zustand/shallow";
import { useChatHandlers } from "./hooks/useChatHandlers";
import { useOverviewHandlers } from "./hooks/useOverviewHandlers";
import { ClassicMode, UnifiedMode } from "../components/modes";
import { PlanViewerOverlay } from "../components/PlanViewer";
import type { ContextAttachment, SendTarget } from "../types";

export function AppContainer(): React.ReactElement {
  const log = useLogger("AppContainer");

  const {
    activeSessionKey,
    tabOrder,
    tabTitles,
    tabIcons,
    connectedAgents,
    agentInfoMap,
    sessionCommands,
    currentPlan,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      activeSessionKey: s.activeSessionKey,
      tabOrder: s.tabOrder,
      tabTitles: s.tabTitles,
      tabIcons: s.tabIcons,
      connectedAgents: s.connectedAgents,
      agentInfoMap: s.agentInfoMap,
      sessionCommands: s.sessionCommands,
      currentPlan: s.currentPlan,
    }))
  );

  const activeSessionInfo = useMemo(
    () =>
      activeSessionKey
        ? useSessionStore.getState().sessionInfoMap[activeSessionKey]
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSessionKey]
  );

  const activeSessionId = activeSessionKey
    ? activeSessionKey.split(":")[1]
    : null;
  const activeAgentId = activeSessionKey
    ? activeSessionKey.split(":")[0]
    : null;
  const displayStatus = activeSessionInfo?.status;

  const {
    panelMode,
    overviewVisible,
    overviewWidth,
    overviewPosition,
    overviewFilter,
    overviewExpandedSessions,
    overviewSelectedSessionIds,
    overviewSelectionMode,
  } = useUiStateStore(
    useShallow((s) => ({
      panelMode: s.panelMode,
      overviewVisible: s.overviewVisible,
      overviewWidth: s.overviewWidth,
      overviewPosition: s.overviewPosition,
      overviewFilter: s.overviewFilter,
      overviewExpandedSessions: s.overviewExpandedSessions,
      overviewSelectedSessionIds: s.overviewSelectedSessionIds,
      overviewSelectionMode: s.overviewSelectionMode,
    }))
  );

  const availableCommands = activeSessionKey
    ? (sessionCommands[activeSessionKey] ?? [])
    : [];

  const overviewOnLeft = overviewPosition === "left";

  // ── Local state ─────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] =
    useState<PersistentSessionEntry | null>(null);
  const [completedNotifications, setCompletedNotifications] = useState<
    Array<{
      agentId: string;
      sessionId: string;
      title: string;
      outcome: TurnOutcome;
    }>
  >([]);

  const scrollToMessageRef = useRef<(id: string) => void>();

  // ── Mesh panel visibility ──────────────────────────────────────────
  const meshPanelVisible = useMeshStore((s) => s.meshPanelVisible);
  const setMeshPanelVisible = useMeshStore((s) => s.setMeshPanelVisible);

  // ── Auto-show MeshPanel when plan is executing ────────────────────
  useEffect(() => {
    if (currentPlan?.status === "executing") {
      setMeshPanelVisible(true);
    }
  }, [currentPlan?.status, setMeshPanelVisible]);

  // ── Actions ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    (
      text: string,
      attachments: ContextAttachment[] = [],
      agentId?: string,
      sessionId?: string,
      targets?: SendTarget[]
    ) => {
      const resolvedTargets: SendTarget[] = targets?.length
        ? targets
        : agentId && sessionId
          ? [
              {
                agentId,
                sessionId,
                label: agentId,
                status: displayStatus ?? "idle",
              },
            ]
          : activeAgentId && activeSessionId
            ? [
                {
                  agentId: activeAgentId,
                  sessionId: activeSessionId,
                  label: activeAgentId,
                  status: displayStatus ?? "idle",
                },
              ]
            : [];

      if (resolvedTargets.length === 0) {
        log.warn("sendMessage dropped — no active session", {
          textLen: text.length,
        });
        return;
      }

      getVsCodeApi().postMessage({
        type: "mesh:send",
        text,
        attachments,
        targets: resolvedTargets,
      });
    },
    [activeAgentId, activeSessionId, displayStatus]
  );

  const cancelTurn = useCallback((agentId?: string, sessionId?: string) => {
    getVsCodeApi().postMessage({ type: "cancelTurn", agentId, sessionId });
  }, []);

  const switchTab = useCallback((agentId: string, sessionId: string) => {
    const key = sessionKeyOf(agentId, sessionId);
    const prevKey = useSessionStore.getState().activeSessionKey;
    if (prevKey === key) return;
    log.info("session switch", { from: prevKey, to: key });
    useSessionStore.getState().setActiveSession(key);
    scrollToMessageRef.current = undefined;
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

  const toggleSessionOverview = useCallback(() => {
    const cur = useUiStateStore.getState().overviewVisible;
    useUiStateStore.getState().setOverviewVisible(!cur);
  }, []);

  const toggleMeshPanel = useCallback(() => {
    setMeshPanelVisible(!meshPanelVisible);
  }, [meshPanelVisible, setMeshPanelVisible]);

  const setSessionOverviewFilter = useCallback(
    (filter: typeof overviewFilter) => {
      useUiStateStore.getState().setOverviewFilter(filter);
    },
    []
  );

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

  const handleMeshSend = useCallback(
    (
      text: string,
      attachments: ContextAttachment[],
      targets?: SendTarget[]
    ) => {
      if (targets && targets.length > 0) {
        sendMessage(text, attachments, undefined, undefined, targets);
      } else {
        sendMessage(
          text,
          attachments,
          activeAgentId ?? undefined,
          activeSessionId ?? undefined
        );
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
    [
      overviewFilter,
      overviewExpandedSessions,
      overviewSelectedSessionIds,
      overviewSelectionMode,
    ]
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

  const handleRenameSession = useCallback(
    (agentId: string, sessionId: string, title: string) => {
      if (title) {
        getVsCodeApi().postMessage({
          type: "renameSession",
          agentId,
          sessionId,
          title,
        });
      }
    },
    []
  );

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

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "history:restored") {
        log.info("restoring session", {
          sessionId: e.data.sessionId,
          agentId: e.data.agentId,
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [log]);

  // ── File/symbol resolution ─────────────────────────────────────────
  const fetchFiles = useCallback((query: string) => {
    return new Promise<import("../types").FileCandidate[]>((resolve) => {
      const reqId = crypto.randomUUID();
      const handler = (event: MessageEvent) => {
        if (
          event.data.type === "fileCandidates" &&
          event.data.reqId === reqId
        ) {
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
            reject(
              new Error(
                (event.data.error as string) ?? "Failed to resolve file"
              )
            );
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
        if (
          event.data.type === "symbolCandidates" &&
          event.data.query === query
        ) {
          window.removeEventListener("message", handler);
          resolve(
            (event.data.candidates as import("../types").SuggestionItem[]) ?? []
          );
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
            reject(
              new Error(
                (event.data.error as string) ?? "Failed to resolve symbol"
              )
            );
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
        {/* Panel mode toggle */}
        <div className="panel-mode-toggle">
          <button
            className={`panel-mode-btn${panelMode === "classic" ? " panel-mode-btn--active" : ""}`}
            onClick={() => useUiStateStore.getState().setPanelMode("classic")}
            type="button"
          >
            Classic
          </button>
          <button
            className={`panel-mode-btn${panelMode === "unified" ? " panel-mode-btn--active" : ""}`}
            onClick={() => useUiStateStore.getState().setPanelMode("unified")}
            type="button"
          >
            Unified
          </button>
        </div>

        {panelMode === "unified" ? (
          <UnifiedMode
            onSendMessage={handleMeshSend}
            onCancel={handleCancel}
            onSwitchSession={switchTab}
            onRenameSession={handleRenameSession}
            onNewSession={handleNewSession}
            disabled={!activeSessionId}
            status={displayStatus}
            fetchFiles={fetchFiles}
            resolveFile={resolveFile}
            resolveSelection={resolveSelection}
            resolveDiff={resolveDiff}
            fetchSymbols={fetchSymbols}
            resolveSymbol={resolveSymbol}
            availableCommands={availableCommands}
          />
        ) : (
          <>
            <ClassicMode
              activeSessionKey={activeSessionKey}
              disabled={!activeSessionId}
              onSend={handleMeshSend}
              onCancel={handleCancel}
              onSwitchSession={switchTab}
              onRenameSession={handleRenameSession}
              onNewSession={handleNewSession}
              fetchFiles={fetchFiles}
              resolveFile={resolveFile}
              resolveSelection={resolveSelection}
              resolveDiff={resolveDiff}
              fetchSymbols={fetchSymbols}
              resolveSymbol={resolveSymbol}
              availableCommands={availableCommands}
              scrollToMessageRef={scrollToMessageRef}
            />
          </>
        )}
      </div>

      {currentPlan && (
        <PlanViewerOverlay plan={currentPlan} />
      )}

      {meshPanelVisible && (
        <MeshPanel onClose={() => setMeshPanelVisible(false)} />
      )}

      {showHistory && (
        <SessionHistoryPanel
          onClose={handleCloseHistory}
          onRestore={handleRestoreSession}
        />
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
