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
import { Composer } from "../../Composer";
import { useSessionStore } from "../../../store/sessionStore";
import type {
  SessionStoreState,
  SlashCommand,
} from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { getVsCodeApi } from "../../../lib/vscodeApi";
import { useLogger } from "../../../hooks/useLogger";
import type {
  ContextAttachment,
  SendTarget,
  FileCandidate,
  SuggestionItem,
} from "../../../types";

export type LayoutMode = "single" | "split" | "grid";

export interface UnifiedModeProps {
  onSendMessage: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[]
  ) => void;
  onCancel: () => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  onNewSession: () => void;
  disabled?: boolean;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
  fetchFiles: (query: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;
  availableCommands?: SlashCommand[];
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
}: UnifiedModeProps): React.ReactElement {
  const log = useLogger("UnifiedMode");
  const {
    activeSessionKey,
    pinnedSessionKeys,
    layoutMode,
    splitDirection,
    splitRatios,
    connectedAgents,
    tabOrder,
    tabTitles,
    tabIcons,
    togglePin,
    setLayoutMode,
    setSplitDirection,
    setSplitRatios,
    setFocusSession,
    removeTab,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      activeSessionKey: s.activeSessionKey,
      pinnedSessionKeys: s.pinnedSessionKeys,
      layoutMode: s.layoutMode,
      splitDirection: s.splitDirection,
      splitRatios: s.splitRatios,
      connectedAgents: s.connectedAgents,
      tabOrder: s.tabOrder,
      tabTitles: s.tabTitles,
      tabIcons: s.tabIcons,
      togglePin: s.togglePin,
      setLayoutMode: s.setLayoutMode,
      setSplitDirection: s.setSplitDirection,
      setSplitRatios: s.setSplitRatios,
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
      log.info("close section", { key });
      const [agentId, sessionId] = key.split(":");
      togglePin(key); // unpin first
      removeTab(key);
      getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
    },
    [togglePin, removeTab]
  );

  const handleLayoutChange = useCallback(
    (mode: LayoutMode) => {
      log.info("layout mode change", { mode });
      setLayoutMode(mode);
    },
    [setLayoutMode]
  );

  const handleSplitDirectionChange = useCallback(
    (dir: "vertical" | "horizontal") => {
      setSplitDirection(dir);
    },
    [setSplitDirection]
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

  const handleSendWithTurnTracking = useCallback(
    (
      text: string,
      attachments: ContextAttachment[],
      targets?: SendTarget[]
    ) => {
      const key = activeSessionKey;
      if (key) {
        setTurnStartedAtMap((prev) => ({
          ...prev,
          [key]: new Date().toISOString(),
        }));
        setPendingMap((prev) => ({ ...prev, [key]: true }));
      }
      onSendMessage(text, attachments, targets);
    },
    [onSendMessage, activeSessionKey]
  );

  // Clear pending state once the agent acknowledges the turn
  useEffect(() => {
    if (
      activeSessionKey &&
      useSessionStore.getState().sessionInfoMap[activeSessionKey]?.status ===
        "running" &&
      pendingMap[activeSessionKey]
    ) {
      setPendingMap((prev) => ({ ...prev, [activeSessionKey]: false }));
    }
  }, [activeSessionKey, pendingMap]);

  const scrollToMessageRef = useRef<((id: string) => void) | undefined>(
    undefined
  );
  const forceScrollToBottomRef = useRef<(() => void) | undefined>(undefined);
  const scrollToUnreadRef = useRef<(() => void) | undefined>(undefined);

  return (
    <div className={`unified-mode unified-mode--${layoutMode}`}>
      <SessionTabBar
        tabs={tabs}
        activeSessionKey={activeSessionKey}
        connectedAgents={connectedAgents}
        overviewItems={{}}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabReorder={() => {}}
        onNewSession={onNewSession}
        onRenameSession={onRenameSession}
        pinnedSessionKeys={pinnedSessionKeys}
        onTogglePin={handleTogglePin}
        layoutMode={layoutMode}
        splitDirection={splitDirection}
        onLayoutChange={handleLayoutChange}
        onSplitDirectionChange={handleSplitDirectionChange}
      />
      <SessionView
        sessionKey={activeSessionKey}
        layoutMode={layoutMode}
        splitDirection={splitDirection}
        splitRatios={splitRatios}
        disabled={disabled}
        pinnedKeys={pinnedSessionKeys}
        onSend={handleSendWithTurnTracking}
        onCancel={onCancel}
        onFocusChange={handleFocusChange}
        onPin={handleTogglePin}
        onUnpin={handleTogglePin}
        onClose={handleClose}
        onSplitRatiosChange={setSplitRatios}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
        turnStartedAtMap={turnStartedAtMap}
        pendingMap={pendingMap}
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
      />
    </div>
  );
});
