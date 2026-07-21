import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SessionOverviewPanel } from "../components/sessions/overview/SessionOverviewPanel";
import { SessionChatContainer } from "../components/sessions/SessionChatContainer";
import { getSessionColor } from "../components/sessions/SessionView";
import { Composer } from "../components/composer/Composer";
import { useSessionStore, sessionKeyOf } from "../store/sessionStore";
import type { SessionStoreState } from "../store/sessionStore";
import { useUiStateStore } from "../store/uiStateStore";
import type { UiStateStore } from "../store/uiStateStore";
import { getVsCodeApi } from "../lib/vscodeApi";
import { useShallow } from "zustand/shallow";
import { useOverviewHandlers } from "../hooks/useOverviewHandlers";
import type {
  ContextAttachment,
  CommunicationMode,
  SendTarget,
  SuggestionItem,
} from "../types";

// MiniChat: lightweight panel = Session Overview + Composer only.
// ChatArea is NOT rendered by default (FR-5); the drill-down is an explicit
// expand from an Overview card (FR-12/FR-13). Reuses the same stores/handlers
// as the full AppContainer so session state stays in sync.
//
// The drill-down history reuses SessionChatContainer directly (the same
// component UnifiedMode uses inside SplitSessionLayout) to avoid divergence
// and keep rendering logic DRY.
//
// When standalone={false} (default), this component is rendered inside
// AppContainer's single webview and shares the same Zustand stores —
// no state sync request is needed. When standalone={true} (legacy
// separate webview), it requests state sync from the extension host.
export interface MiniChatContainerProps {
  /** Whether this is a standalone webview (separate JS bundle).
   *  When false, runs inside AppContainer — no state sync needed. */
  standalone?: boolean;
}

export function MiniChatContainer({
  standalone = true,
}: MiniChatContainerProps): React.ReactElement {
  const { activeSessionKey, connectedAgents } = useSessionStore(
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

  // Track container width so SessionOverviewPanel fills the full MiniChat
  // width without a resize handle (sidebar-ready, no internal size constraints).
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

  // Request full state sync from extension host on mount (standalone mode only).
  // When rendered inside AppContainer, the single webview shares Zustand stores
  // directly — no sync needed.
  useEffect(() => {
    if (!standalone) return;
    const vscode = getVsCodeApi();
    vscode.postMessage({ type: "state/syncRequest" });
  }, [standalone]);

  // ── Drill-down history (FR-12 ~ FR-15) ─────────────────────────────
  // null = no drill-down (FR-5 lightweight state). When set, SessionChatContainer
  // is rendered for that session key.
  const [drillDownKey, setDrillDownKey] = useState<string | null>(null);

  // Close drill-down: simply hide the history view.
  // Do NOT remove messages or tabs — the session should remain in the Overview
  // (FR-13: closing returns to lightweight state, not session deletion).
  const closeDrillDown = useCallback(() => {
    setDrillDownKey(null);
  }, []);

  // ── Send / Cancel ───────────────────────────────────────────────────
  //
  // When drill-down is active (history view), the composer should send to the
  // drill-down session, not the active-session store key.  Both resolve to the
  // same session when the user is not in drill-down mode.
  const sendAgentId = drillDownKey ? drillDownKey.split(":")[0] : activeAgentId;
  const sendSessionId = drillDownKey
    ? drillDownKey.split(":")[1]
    : activeSessionId;

  const sendMessage = useCallback(
    (
      text: string,
      attachments: ContextAttachment[] = [],
      targets?: SendTarget[],
      mode?: CommunicationMode | null
    ) => {
      const resolvedTargets: SendTarget[] = targets?.length
        ? targets
        : sendAgentId && sendSessionId
          ? [
              {
                agentId: sendAgentId,
                sessionId: sendSessionId,
                label: sendAgentId,
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
    [sendAgentId, sendSessionId]
  );

  const cancelTurn = useCallback(
    (_targets?: SendTarget[]) => {
      getVsCodeApi().postMessage({
        type: "cancelTurn",
        agentId: sendAgentId,
        sessionId: sendSessionId,
      });
    },
    [sendAgentId, sendSessionId]
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

  // ── Session tab switching ──────────────────────────────────────────
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

  // ── Overview state + handlers ──────────────────────────────────────
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

  // ── Composer queue stubs (MiniChat does not surface queue UI) ──────
  const clearQueue = useCallback(() => {}, []);
  const removeQueueItem = useCallback((_promptId: string) => {}, []);

  // Mock context resolvers — MiniChat does not support rich context attach.
  // Return a dummy ContextAttachment to satisfy Composer's non-null contract.
  const noopAttachment: ContextAttachment = useMemo(
    () => ({
      id: "",
      type: "file",
      path: "",
      label: "",
      tokenCount: 0,
      content: "",
    }),
    []
  );
  const noopResolver = useCallback(
    () => Promise.resolve(noopAttachment),
    [noopAttachment]
  );
  const noopFileResolver = useCallback(
    (_path: string) => Promise.resolve(noopAttachment),
    [noopAttachment]
  );
  const noopSymbolResolver = useCallback(
    (_name: string) => Promise.resolve(noopAttachment),
    [noopAttachment]
  );
  const noopOutputResolver = useCallback(
    (_ref: string) => Promise.resolve(noopAttachment),
    [noopAttachment]
  );
  const noopFileCandidates = useCallback(
    () => Promise.resolve([] as { relativePath: string; name: string }[]),
    []
  );
  const noopSymbols = useCallback(
    (_query: string) => Promise.resolve([] as SuggestionItem[]),
    []
  );

  // Drill-down session info for SessionChatContainer.
  // Use optional chaining with defaults so the drill-down stays rendered
  // even if sessionInfoMap temporarily lacks the entry (e.g. during setTabs).
  const drillDownInfo = drillDownKey
    ? useSessionStore.getState().sessionInfoMap[drillDownKey]
    : undefined;
  const drillDownColor = drillDownKey ? getSessionColor(drillDownKey) : "";
  const [drillAgentId, drillSessionId] = drillDownKey
    ? drillDownKey.split(":")
    : ["", ""];

  return (
    <div className="flex flex-col h-screen overflow-hidden" ref={containerRef}>
      {/* Flex-1 wrapper so SessionOverviewPanel's internal h-full
          fills available space without pushing the Composer out of view. */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
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
          // Also set the active session so the Composer sends to the correct
          // session and reflects the right status.
          onExpand={(sessionId, agentId) => {
            const key = sessionKeyOf(agentId, sessionId);
            setDrillDownKey(key);
            useSessionStore.getState().setActiveSession(key);
          }}
        />
      </div>

      {/* FR-13: drill-down history renders only when explicitly expanded.
          Reuses SessionChatContainer (same component as UnifiedMode) so the
          rendering pipeline stays DRY and bug-free.
          Render when drillDownKey exists; provide defaults for status/color
          so the chat doesn't disappear if sessionInfoMap temporarily lacks
          the entry (e.g. during setTabs update from extension). */}
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
              onClick={closeDrillDown}
            >
              ×
            </button>
          </div>
          <SessionChatContainer
            sessionKey={drillDownKey}
            sessionId={drillSessionId}
            agentId={drillAgentId}
            status={drillDownInfo?.status ?? "idle"}
            isActive={true}
            color={drillDownColor}
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
        disabled={!sendAgentId || !sendSessionId}
        status={
          (useSessionStore.getState().sessionInfoMap[
            drillDownKey ?? activeSessionKey ?? ""
          ]?.status as
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
