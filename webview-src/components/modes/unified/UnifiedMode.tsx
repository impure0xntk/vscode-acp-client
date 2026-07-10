import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { useShallow } from "zustand/shallow";
import { SessionView } from "../../sessions/SessionView";
import { SessionTabBar } from "../../sessions/SessionTabBar";
import { Composer } from "../../composer/Composer";
import { useSessionStore } from "../../../store/sessionStore";
import type {
  SessionStoreState,
  SlashCommand,
} from "../../../store/sessionStore";
import { useUiStateStore } from "../../../store/uiStateStore";
import { useMessageStore } from "../../../store/messageStore";
import { getVsCodeApi } from "../../../lib/vscodeApi";
import { useLogger } from "../../../hooks/useLogger";
import type {
  ContextAttachment,
  QueuedPrompt,
  SendTarget,
  FileCandidate,
  SuggestionItem,
} from "../../../types";

export type LayoutMode = "split";

export interface UnifiedModeProps {
  onSendMessage: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[],
    mode?: import("../../../types").CommunicationMode | null,
    teamId?: string
  ) => void;
  onCancel: (targets?: SendTarget[]) => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  onNewSession: () => void;
  disabled?: boolean;
  status?:
    | "idle"
    | "running"
    | "cancelling"
    | "completed"
    | "error"
    | "cancelled";
  fetchFiles: (query: string, cwd?: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;
  availableCommands?: SlashCommand[];
  onCancelQueuedPrompt?: (
    agentId: string,
    sessionId: string,
    promptId: string
  ) => void;
  onClearQueue?: (agentId: string, sessionId: string) => void;
  onAttachDiff?: (attachment: ContextAttachment) => void;
}

export const UnifiedMode = React.memo(function UnifiedMode({
  onSendMessage,
  onCancel,
  onSwitchSession,
  onRenameSession,
  onNewSession,
  disabled = false,
  status = "idle",
  fetchFiles,
  resolveFile,
  resolveSelection,
  resolveDiff,
  fetchSymbols,
  resolveSymbol,
  availableCommands = [],
  onCancelQueuedPrompt,
  onClearQueue,
  onAttachDiff,
}: UnifiedModeProps): React.ReactElement {
  const log = useLogger("UnifiedMode");

  const splitDirection = useUiStateStore((s) => s.splitDirection);
  const splitRatios = useUiStateStore((s) => s.splitRatios);
  const {
    activeSessionKey,
    pinnedSessionKeys,
    connectedAgents,
    tabOrder,
    tabTitles,
    tabIcons,
    togglePin,
    setFocusSession,
    removeTab,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      activeSessionKey: s.activeSessionKey,
      pinnedSessionKeys: s.pinnedSessionKeys,
      connectedAgents: s.connectedAgents,
      tabOrder: s.tabOrder,
      tabTitles: s.tabTitles,
      tabIcons: s.tabIcons,
      togglePin: s.togglePin,
      setFocusSession: s.setFocusSession,
      removeTab: s.removeTab,
    }))
  );

  // Derive tabs locally
  const tabs = useMemo(
    () =>
      tabOrder.map((key) => {
        const [agentId, sessionId] = key.split(":");
        return {
          sessionId,
          agentId,
          title: tabTitles[key] ?? sessionId,
          agentIcon: tabIcons[key],
        };
      }),
    [tabOrder, tabTitles, tabIcons]
  );

  // Turn tracking for pending/waiting indicator (per-session)
  const [turnStartedAtMap, setTurnStartedAtMap] = useState<
    Record<string, string>
  >({});
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});

  // Clean up turn tracking when a session is removed
  const prevTabOrderRef = useRef(tabOrder);
  useEffect(() => {
    const prevKeys = new Set(prevTabOrderRef.current);
    const currentKeys = new Set(tabOrder);
    const removed = [...prevKeys].filter((k) => !currentKeys.has(k));
    if (removed.length > 0) {
      setTurnStartedAtMap((prev) => {
        const next = { ...prev };
        for (const k of removed) delete next[k];
        return next;
      });
      setPendingMap((prev) => {
        const next = { ...prev };
        for (const k of removed) delete next[k];
        return next;
      });
    }
    prevTabOrderRef.current = tabOrder;
  }, [tabOrder]);

  const handleFocusChange = useCallback(
    (key: string) => {
      const current = useSessionStore.getState().activeSessionKey;
      if (current === key) return;
      setFocusSession(key);
      const [agentId, sessionId] = key.split(":");
      log.info("session focus change", { key, agentId, sessionId });
      onSwitchSession(agentId, sessionId);
    },
    [setFocusSession, onSwitchSession]
  );

  const handleTogglePin = useCallback(
    (key: string) => {
      log.debug("toggle pin", { key });
      togglePin(key);
    },
    [togglePin]
  );

  const handleClose = useCallback(
    (key: string) => {
      log.info("close session", { key });
      const [agentId, sessionId] = key.split(":");
      togglePin(key); // unpin first
      removeTab(key);
      getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
    },
    [togglePin, removeTab]
  );

  const handleTabClick = useCallback(
    (sessionKey: string) => {
      handleFocusChange(sessionKey);
    },
    [handleFocusChange]
  );

  const handleTabClose = useCallback(
    (sessionKey: string) => {
      handleClose(sessionKey);
    },
    [handleClose]
  );

  const handleSplitDirectionChange = useCallback(
    (direction: "horizontal" | "vertical") => {
      useUiStateStore.getState().setSplitDirection(direction);
    },
    []
  );

  // Persist split ratios so dragging a divider actually resizes the layout.
  // Without this the drag handler had nowhere to write the new ratios
  // (SessionView's onSplitRatiosChange defaulted to a no-op), so the
  // SessionChatContainer never changed size.
  const handleSplitRatiosChange = useCallback((ratios: number[]) => {
    useUiStateStore.getState().setSplitRatios(ratios);
  }, []);

  // Read activeSessionKey from store at call time to avoid stale closure.
  // The closure value may be stale when the store updates (e.g., tab switch)
  // but React hasn't re-rendered yet — causing "Sending…" to appear on
  // the wrong session.
  //
  // When targets are provided (multi-@ or send-to-all-pinned), set pending
  // for each target session — not the active session — so "Sending…"
  // appears on the correct session(s).
  const handleSendWithTurnTracking = useCallback(
    (
      text: string,
      attachments: ContextAttachment[],
      targets?: SendTarget[]
    ) => {
      const activeKey = useSessionStore.getState().activeSessionKey;
      const now = new Date().toISOString();

      // Determine which sessions should show "Sending…"
      const targetKeys = targets?.length
        ? targets.map((t) => `${t.agentId}:${t.sessionId}`)
        : activeKey
          ? [activeKey]
          : [];

      if (targetKeys.length > 0) {
        setTurnStartedAtMap((prev) => {
          const next = { ...prev };
          for (const k of targetKeys) next[k] = now;
          return next;
        });
        setPendingMap((prev) => {
          const next = { ...prev };
          for (const k of targetKeys) next[k] = true;
          return next;
        });
      }
      onSendMessage(text, attachments, targets);
    },
    [onSendMessage]
  );

  // Clear pending state for any session whose agent has acknowledged the turn
  // (status became "running") or reached a terminal state (completed/error/
  // cancelled).  Previously only "running" was checked, causing sessions that
  // respond too fast (skipping "running") to stay stuck on "Sending…" forever.
  // Use a ref to always read the latest pendingMap inside the subscription.
  const pendingMapRef = useRef(pendingMap);
  pendingMapRef.current = pendingMap;
  useEffect(() => {
    return useSessionStore.subscribe((state) => {
      const infoMap = state.sessionInfoMap;
      const currentPending = pendingMapRef.current;
      let pendingChanged = false;
      const nextPending = { ...currentPending };
      for (const [key, isPending] of Object.entries(currentPending)) {
        if (!isPending) continue;
        const info = infoMap[key];
        if (!info) continue;
        const shouldClear =
          info.status === "running" ||
          info.status === "completed" ||
          info.status === "error" ||
          info.status === "cancelled";
        if (shouldClear) {
          nextPending[key] = false;
          pendingChanged = true;
        }
      }
      if (pendingChanged) setPendingMap(nextPending);
    });
  }, []);

  const scrollToMessageRef = useRef<((id: string) => void) | undefined>(
    undefined
  );
  const forceScrollToBottomRef = useRef<(() => void) | undefined>(undefined);
  const scrollToUnreadRef = useRef<(() => void) | undefined>(undefined);

  // Queue for the active session
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const sessionQueue: QueuedPrompt[] = activeSessionKey
    ? (promptQueue[activeSessionKey] ?? [])
    : [];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden h-full unified-mode--split">
      <SessionTabBar
        tabs={tabs}
        activeSessionKey={activeSessionKey}
        connectedAgents={connectedAgents}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onNewSession={onNewSession}
        onRenameSession={onRenameSession}
        pinnedSessionKeys={pinnedSessionKeys}
        onTogglePin={handleTogglePin}
        splitDirection={splitDirection}
        onSplitDirectionChange={handleSplitDirectionChange}
      />
      <SessionView
        sessionKey={activeSessionKey}
        disabled={disabled}
        pinnedKeys={pinnedSessionKeys}
        splitDirection={splitDirection}
        splitRatios={splitRatios}
        onSplitRatiosChange={handleSplitRatiosChange}
        onSend={handleSendWithTurnTracking}
        onCancel={onCancel}
        onFocusChange={handleFocusChange}
        onPin={handleTogglePin}
        onUnpin={handleTogglePin}
        onClose={handleClose}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
        turnStartedAtMap={turnStartedAtMap}
        pendingMap={pendingMap}
        onAttachDiff={(attachment) => {
          // Add attachment to composer's context bar
          // The Composer manages its own attachments state, so we need
          // to use a global event or direct state injection.
          // For now, dispatch a custom event that Composer listens to.
          window.dispatchEvent(
            new CustomEvent("acp:attachDiff", {
              detail: { attachment },
            })
          );
        }}
      />
      <Composer
        onSend={handleSendWithTurnTracking}
        onCancel={onCancel}
        onSwitchSession={onSwitchSession}
        onRenameSession={onRenameSession}
        disabled={disabled}
        status={status}
        fetchFiles={fetchFiles}
        resolveFile={resolveFile}
        resolveSelection={resolveSelection}
        resolveDiff={resolveDiff}
        fetchSymbols={fetchSymbols}
        resolveSymbol={resolveSymbol}
        availableCommands={availableCommands}
        queue={sessionQueue}
        onAttachDiff={onAttachDiff}
        onSendNow={(promptId) => {
          const entry = sessionQueue.find((e) => e.id === promptId);
          if (!entry) return;
          // Cancel on extension side so the queued entry is dequeued
          if (onCancelQueuedPrompt) {
            onCancelQueuedPrompt(entry.agentId, entry.sessionId, promptId);
          }
          // Send the message as a new prompt
          onSendMessage(entry.text, entry.attachments ?? []);
          // Remove from local store
          if (activeSessionKey) {
            useSessionStore
              .getState()
              .removeQueuedPrompt(activeSessionKey, promptId);
          }
        }}
        onRemoveQueueItem={(promptId) => {
          if (activeSessionKey) {
            const [agentId, sessionId] = activeSessionKey.split(":");
            onCancelQueuedPrompt?.(agentId, sessionId, promptId);
            useSessionStore
              .getState()
              .removeQueuedPrompt(activeSessionKey, promptId);
          }
        }}
        onClearQueue={() => {
          if (activeSessionKey) {
            const [agentId, sessionId] = activeSessionKey.split(":");
            onClearQueue?.(agentId, sessionId);
            useSessionStore.getState().clearQueue(activeSessionKey);
          }
        }}
      />
    </div>
  );
});
