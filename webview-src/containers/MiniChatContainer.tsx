import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SessionOverviewPanel,
} from "../components/sessions/overview/SessionOverviewPanel";
import { SessionView } from "../components/sessions/SessionView";
import { Composer } from "../components/composer/Composer";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import type { SessionStoreState } from "../store/sessionStore";
import { useUiStateStore } from "../store/uiStateStore";
import type { UiStateStore } from "../store/uiStateStore";
import { getVsCodeApi } from "../lib/vscodeApi";
import { useShallow } from "zustand/shallow";
import { useOverviewHandlers } from "../hooks/useOverviewHandlers";
import type {
  CommunicationMode,
  ContextAttachment,
  SendTarget,
  SuggestionItem,
} from "../types";

// MiniChat: lightweight panel = Session Overview + Composer only.
// ChatArea is NOT rendered by default (FR-5); the drill-down is an explicit
// expand from an Overview card (FR-12/FR-13). Reuses the same stores/handlers
// as the full AppContainer so session state stays in sync.
export function MiniChatContainer(): React.ReactElement {
  const {
    activeSessionKey,
    connectedAgents,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      activeSessionKey: s.activeSessionKey,
      connectedAgents: s.connectedAgents,
    }))
  );

  const activeSessionId = activeSessionKey
    ? activeSessionKey.split(":")[1]
    : null;
  const activeAgentId = activeSessionKey
    ? activeSessionKey.split(":")[0]
    : null;

  const {
    overviewFilter,
    overviewExpandedSessions,
    overviewSelectedSessionIds,
    overviewSelectionMode,
  } = useUiStateStore(
    useShallow((s: UiStateStore) => ({
      overviewFilter: s.overviewFilter,
      overviewExpandedSessions: s.overviewExpandedSessions,
      overviewSelectedSessionIds: s.overviewSelectedSessionIds,
      overviewSelectionMode: s.overviewSelectionMode,
    }))
  );

  // Track container width for full-width layout.
  // SessionOverviewPanel fills the entire MiniChat width without resize handles
  // (sidebar-ready with no internal size constraints).
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(300);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // FR-12/FR-13: drill-down key is null unless the user expands a session.
  const [drillDownKey, setDrillDownKey] = useState<string | null>(null);

  const sendMessage = useCallback(
    (
      text: string,
      attachments: ContextAttachment[] = [],
      targets?: SendTarget[],
      mode?: CommunicationMode | null
    ) => {
      const resolvedTargets: SendTarget[] = targets?.length
        ? targets
        : activeAgentId && activeSessionId
          ? [
              {
                agentId: activeAgentId,
                sessionId: activeSessionId,
                label: activeAgentId,
                status: "idle" as const,
              },
            ]
          : [];
      if (resolvedTargets.length === 0) return;
      getVsCodeApi().postMessage({
        type: "mesh:send",
        text,
        attachments,
        targets: resolvedTargets,
        mode,
      });
    },
    [activeAgentId, activeSessionId]
  );

  const cancelTurn = useCallback(
    (_targets?: SendTarget[]) => {
      getVsCodeApi().postMessage({
        type: "cancelTurn",
        agentId: activeAgentId,
        sessionId: activeSessionId,
      });
    },
    [activeAgentId, activeSessionId]
  );

  const handleSend = useCallback(
    (
      text: string,
      attachments: ContextAttachment[],
      targets?: SendTarget[],
      mode?: CommunicationMode | null
    ) => sendMessage(text, attachments, targets, mode),
    [sendMessage]
  );

  const handleCancel = useCallback(
    (targets?: SendTarget[]) => cancelTurn(targets),
    [cancelTurn]
  );

  const switchTab = useCallback((agentId: string, sessionId: string) => {
    const key = sessionKeyOf(agentId, sessionId);
    const prevKey = useSessionStore.getState().activeSessionKey;
    if (prevKey === key) return;
    useSessionStore.getState().setActiveSession(key);
    getVsCodeApi().postMessage({ type: "switchSession", sessionId, agentId });
  }, []);

  const closeSession = useCallback((agentId: string, sessionId: string) => {
    const store = useSessionStore.getState();
    const key = sessionKeyOf(agentId, sessionId);
    store.removeTab(key);
    getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
  }, []);

  const newSessionWithPicker = useCallback(() => {
    getVsCodeApi().postMessage({ type: "openNewSessionPicker" });
  }, []);

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
    handleToggleSelect: handleOverviewToggleSelect,
    handleLongPress: handleOverviewLongPress,
    handleCloseSelected: handleOverviewCloseSelected,
    handleExitSelectionMode: handleOverviewExitSelectionMode,
  } = useOverviewHandlers({
    switchTab,
    closeSession,
    sessionOverviewState: overviewState,
  });

  const clearQueue = useCallback(() => {}, []);
  const removeQueueItem = useCallback((_promptId: string) => {}, []);

  // Mock context resolvers — MiniChat does not support rich context attach.
  const noopResolver = useCallback(
    () => Promise.resolve(null as ContextAttachment | null),
    []
  );
  const noopFileResolver = useCallback(
    (_path: string) => Promise.resolve(null as ContextAttachment | null),
    []
  );
  const noopSymbolResolver = useCallback(
    (_name: string) => Promise.resolve(null as ContextAttachment | null),
    []
  );
  const noopOutputResolver = useCallback(
    (_ref: string) => Promise.resolve(null as ContextAttachment | null),
    []
  );
  const noopFileCandidates = useCallback(
    () => Promise.resolve([] as { relativePath: string; name: string }[]),
    []
  );
  const noopSymbols = useCallback(
    (_query: string) => Promise.resolve([] as SuggestionItem[]),
    []
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <SessionOverviewPanel
        isVisible={true}
        state={overviewState}
        connectedAgents={connectedAgents}
        width={containerWidth}
        onFilterChange={(f) =>
          useUiStateStore.getState().setOverviewFilter(f)
        }
        onFocus={handleOverviewFocus}
        onCancel={handleOverviewCancel}
        onClose={handleOverviewClose}
        onToggleExpand={handleOverviewToggleExpand}
        onToggleCollapse={handleOverviewToggleCollapse}
        onNewSession={newSessionWithPicker}
        onToggleSelect={handleOverviewToggleSelect}
        onLongPress={handleOverviewLongPress}
        onCloseSelected={handleOverviewCloseSelected}
        onExitSelectionMode={handleOverviewExitSelectionMode}
        // FR-12: expand icon / double-click on an Overview card drills down.
        onExpand={(sessionId, agentId) =>
          setDrillDownKey(`${agentId}:${sessionId}`)
        }
      />

      {/* FR-13: drill-down history renders only when explicitly expanded. */}
      {drillDownKey && (
        <div className="flex-1 min-h-0 flex flex-col border-t border-border">
          <div className="flex items-center justify-between px-2 py-1 bg-bg-secondary shrink-0">
            <span className="text-[10px] text-fg-secondary font-medium">
              History
            </span>
            <button
              className="inline-flex items-center justify-center w-[18px] h-[18px] text-xs text-fg-muted bg-transparent border-none rounded-sm cursor-pointer hover:text-user-fg hover:bg-error"
              type="button"
              aria-label="Close history"
              onClick={() => setDrillDownKey(null)}
            >
              ×
            </button>
          </div>
          <SessionView
            sessionKey={drillDownKey}
            disabled={!activeSessionId}
            splitDirection="vertical"
            splitRatios={[]}
            onSend={handleSend}
            onCancel={handleCancel}
            onFocusChange={(k) => {
              const [agentId, sessionId] = k.split(":");
              switchTab(agentId, sessionId);
            }}
            onClose={() => setDrillDownKey(null)}
            onAttachDiff={(attachment) => {
              window.dispatchEvent(
                new CustomEvent("acp:attachDiff", { detail: { attachment } })
              );
            }}
          />
        </div>
      )}

      <Composer
        onSend={handleSend}
        onCancel={handleCancel}
        disabled={!activeSessionId}
        status={
          (useSessionStore.getState().sessionInfoMap[activeSessionKey ?? ""]
            ?.status as
            | "idle"
            | "running"
            | "cancelling"
            | "completed"
            | "error"
            | "cancelled") ?? "idle"
        }
        fetchFiles={noopFileCandidates}
        resolveFile={noopFileResolver}
        resolveSelection={noopResolver}
        resolveDiff={noopResolver}
        fetchSymbols={noopSymbols}
        resolveSymbol={noopSymbolResolver}
        resolveOutput={noopOutputResolver}
        availableCommands={[]}
        onRemoveQueueItem={removeQueueItem}
        onClearQueue={clearQueue}
        onAttachDiff={(a) =>
          window.dispatchEvent(
            new CustomEvent("acp:attachDiff", { detail: { attachment: a } })
          )
        }
      />
    </div>
  );
}
