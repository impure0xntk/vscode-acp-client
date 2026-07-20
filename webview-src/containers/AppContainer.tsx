import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useLogger } from "../hooks/useLogger";
import {
  SessionHistoryPanel,
  PersistentSessionEntry,
} from "../components/sessions/history";
import { ResizableSessionOverviewPanel } from "../components/sessions/overview/SessionOverviewPanel";
import { MeshPanel } from "../components/mesh";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import { useMessageStore } from "../store/messageStore";
import { getTurnOutput } from "../lib/sessionTurns";
import type { SessionStoreState } from "../store/sessionStore";
import { useUiStateStore } from "../store/uiStateStore";
import type { UiStateStore } from "../store/uiStateStore";
import { useMeshStore } from "../store/meshStore";
import { getVsCodeApi } from "../lib/vscodeApi";
import { setPendingSwitch } from "../messageRouter/shared/guards";
import { useShallow } from "zustand/shallow";
import { useChatHandlers } from "../hooks/useChatHandlers";
import { useOverviewHandlers } from "../hooks/useOverviewHandlers";
import { PlanViewerOverlay } from "../components/modes/supervisor/PlanViewer";
import { getPanelMode } from "../components/modes/panelModeStrategy";
import type {
  CommunicationMode,
  ContextAttachment,
  SendTarget,
} from "../types";

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

  const activeSessionInfo = useSessionStore((s) =>
    activeSessionKey ? s.sessionInfoMap[activeSessionKey] : undefined
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
    useShallow((s: UiStateStore) => ({
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

  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] =
    useState<PersistentSessionEntry | null>(null);
  const scrollToMessageRef = useRef<(id: string) => void>();

  const meshPanelVisible = useMeshStore((s) => s.meshPanelVisible);
  const setMeshPanelVisible = useMeshStore((s) => s.setMeshPanelVisible);

  useEffect(() => {
    if (currentPlan?.status === "executing") {
      setMeshPanelVisible(true);
    }
  }, [currentPlan?.status, setMeshPanelVisible]);

  const sendMessage = useCallback(
    (
      text: string,
      attachments: ContextAttachment[] = [],
      agentId?: string,
      sessionId?: string,
      targets?: SendTarget[],
      mode?: CommunicationMode | null,
      teamId?: string,
      queueMode?: import("../types").QueuedPromptMode
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
        mode,
        teamId,
        queueMode,
      });
    },
    [activeAgentId, activeSessionId, displayStatus]
  );

  const cancelTurn = useCallback(
    (targets?: SendTarget[]) => {
      if (targets && targets.length > 0) {
        for (const t of targets) {
          getVsCodeApi().postMessage({
            type: "cancelTurn",
            agentId: t.agentId,
            sessionId: t.sessionId,
          });
        }
      } else {
        getVsCodeApi().postMessage({
          type: "cancelTurn",
          agentId: activeAgentId,
          sessionId: activeSessionId,
        });
      }
    },
    [activeAgentId, activeSessionId]
  );

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
      targets?: SendTarget[],
      mode?: CommunicationMode | null,
      teamId?: string,
      queueMode?: import("../types").QueuedPromptMode
    ) => {
      if (targets && targets.length > 0) {
        sendMessage(text, attachments, undefined, undefined, targets, mode, teamId, queueMode);
      } else {
        sendMessage(
          text,
          attachments,
          activeAgentId ?? undefined,
          activeSessionId ?? undefined,
          undefined,
          mode,
          teamId,
          queueMode
        );
      }
      forceScrollToBottomRef.current?.();
    },
    [sendMessage, forceScrollToBottomRef, activeAgentId, activeSessionId]
  );

  // Stack/Inject mode send — used for running-session routing.
  const sendQueueMode = useCallback(
    (
      text: string,
      attachments: ContextAttachment[],
      queueMode: import("../types").QueuedPromptMode
    ) => {
      sendMessage(
        text,
        attachments,
        activeAgentId ?? undefined,
        activeSessionId ?? undefined,
        undefined,
        undefined,
        undefined,
        queueMode
      );
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

  const cancelQueuedPrompt = useCallback(
    (agentId: string, sessionId: string, promptId: string) => {
      getVsCodeApi().postMessage({
        type: "queue:cancel",
        agentId,
        sessionId,
        promptId,
      });
    },
    []
  );

  const clearQueue = useCallback((agentId: string, sessionId: string) => {
    getVsCodeApi().postMessage({
      type: "queue:clear",
      agentId,
      sessionId,
    });
  }, []);

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

  const fetchFiles = useCallback((query: string, cwd?: string) => {
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
      // If cwd is not provided, fall back to the active session's cwd
      const effectiveCwd =
        cwd ??
        (() => {
          const store = useSessionStore.getState();
          const key = store.activeSessionKey;
          return key ? store.sessionInfoMap[key]?.cwd : undefined;
        })();
      getVsCodeApi().postMessage({
        type: "fetchFiles",
        query,
        reqId,
        cwd: effectiveCwd,
      });
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

  const resolveOutput = useCallback((ref: string) => {
    return new Promise<ContextAttachment | null>((resolve) => {
      const [agentId, sessionId, turnIdxStr] = ref.split("::");
      const turnIndex = Number(turnIdxStr);
      if (!agentId || !sessionId || Number.isNaN(turnIndex)) {
        resolve(null);
        return;
      }
      const key = sessionKeyOf(agentId, sessionId);
      const messages = useMessageStore.getState().perSession[key] ?? [];
      const output = getTurnOutput(messages, turnIndex);
      if (output == null) {
        resolve(null);
        return;
      }
      const sessionTitle =
        useSessionStore.getState().tabTitles[key] ?? sessionId.slice(0, 8);
      // Guard against an out-of-range index produced by stale picker data.
      const userPrompt = messages[turnIndex]?.role === "user"
        ? messages[turnIndex].content.trim()
        : "";
      resolve({
        id: `turn:${ref}`,
        type: "turn",
        path: "",
        label: `${sessionTitle} · ${userPrompt.slice(0, 32)}`,
        tokenCount: Math.ceil(output.length / 4),
        content: output,
        message: sessionTitle,
      });
    });
  }, []);

  return (
    <div
      className={`prose prose-sm dark:prose-invert flex flex-col h-screen overflow-hidden relative${overviewVisible ? " with-overview" : ""}${overviewOnLeft ? " overview-left" : ""}`}
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
      <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden relative">
        {getPanelMode(panelMode.id).render({
          onSendMessage: handleMeshSend,
          onCancel: handleCancel,
          onSwitchSession: switchTab,
          onRenameSession: handleRenameSession,
          onNewSession: handleNewSession,
          disabled: !activeSessionId,
          status: displayStatus,
          fetchFiles: fetchFiles,
          resolveFile: resolveFile,
          resolveSelection: resolveSelection,
          resolveDiff: resolveDiff,
          fetchSymbols: fetchSymbols,
          resolveSymbol: resolveSymbol,
          resolveOutput: resolveOutput,
          availableCommands: availableCommands,
          onCancelQueuedPrompt: cancelQueuedPrompt,
          onClearQueue: clearQueue,
          onAttachDiff: (attachment) => {
            window.dispatchEvent(
              new CustomEvent("acp:attachDiff", {
                detail: { attachment },
              })
            );
          },
          onSendMode: (text, attachments) =>
            sendQueueMode(text, attachments, "stack"),
        })}
      </div>

      {currentPlan && <PlanViewerOverlay plan={currentPlan} />}

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
