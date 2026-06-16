import React, { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/shallow";
import {
  useSessionStore,
  sessionKeyOf,
} from "../../store/sessionStore";
import type { SessionStoreState, SessionTabState } from "../../store/sessionStore";
import { useLogger } from "../../hooks/useLogger";
import { getVsCodeApi } from "../../lib/vscodeApi";
import { UnifiedSessionBar } from "./UnifiedSessionBar";
import { MultiSessionView } from "./MultiSessionView";
import { CommandCenter } from "../CommandCenter/CommandCenter";
import { Composer } from "../Composer";


export interface UnifiedChatPanelProps {
  onSendMessage: (
    text: string,
    attachments: import("../../types").ContextAttachment[],
    targets?: import("../../types").SendTarget[]
  ) => void;
  onCancel: () => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  onNewSession: () => void;
  disabled?: boolean;
  status?: "idle" | "running" | "completed" | "error" | "cancelled";
  // For Composer
  fetchFiles: (query: string) => Promise<import("../ContextPicker").FileCandidate[]>;
  resolveFile: (path: string) => Promise<import("../../types").ContextAttachment>;
  resolveSelection: () => Promise<import("../../types").ContextAttachment | null>;
  resolveDiff: () => Promise<import("../../types").ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<import("../../types").SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<import("../../types").ContextAttachment>;
  availableCommands?: import("../../store/sessionStore").SlashCommand[];
}

export const UnifiedChatPanel = React.memo(function UnifiedChatPanel({
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
}: UnifiedChatPanelProps): React.ReactElement {
  const log = useLogger("UnifiedChatPanel");

  const {
    activeSessionKey,
    pinnedSessionKeys,
    layoutMode,
    splitDirection,
    splitRatios,
    connectedAgents,
    sessionCommands,
    tabOrder,
    tabTitles,
    tabIcons,
    pinSession,
    unpinSession,
    setLayoutMode,
    setSplitDirection,
    setSplitRatios,
    setFocusSession,
    removeTab,
    commandCenterExpanded,
    commandCenterSelectedKey,
    setCommandCenterSelectedKey,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      activeSessionKey: s.activeSessionKey,
      pinnedSessionKeys: s.pinnedSessionKeys,
      layoutMode: s.layoutMode,
      splitDirection: s.splitDirection,
      splitRatios: s.splitRatios,
      connectedAgents: s.connectedAgents,
      sessionCommands: s.sessionCommands,
      tabOrder: s.tabOrder,
      tabTitles: s.tabTitles,
      tabIcons: s.tabIcons,
      pinSession: s.pinSession,
      unpinSession: s.unpinSession,
      setLayoutMode: s.setLayoutMode,
      setSplitDirection: s.setSplitDirection,
      setSplitRatios: s.setSplitRatios,
      setFocusSession: s.setFocusSession,
      removeTab: s.removeTab,
      commandCenterExpanded: s.commandCenterExpanded,
      commandCenterSelectedKey: s.commandCenterSelectedKey,
      setCommandCenterSelectedKey: s.setCommandCenterSelectedKey,
    }))
  );

  // Derive tabs locally from already-subscribed fields instead of calling
  // selectTabs (which returns a new array on every store change, triggering
  // re-renders of the entire UnifiedChatPanel subtree).
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

  const handleFocusChange = useCallback(
    (key: string) => {
      // Skip if already focused — prevents infinite re-render loop
      const current = useSessionStore.getState().activeSessionKey;
      if (current === key) return;
      setFocusSession(key);
      const [agentId, sessionId] = key.split(":");
      log.info("session focus change", { key, agentId, sessionId });
      onSwitchSession(agentId, sessionId);
    },
    [setFocusSession, onSwitchSession, log],
  );

  const handlePin = useCallback(
    (key: string) => {
      log.debug("pin session", { key });
      pinSession(key);
    },
    [pinSession, log],
  );

  const handleUnpin = useCallback(
    (key: string) => {
      log.debug("unpin session", { key });
      unpinSession(key);
    },
    [unpinSession, log],
  );

  const handleClose = useCallback(
    (key: string) => {
      log.info("close section", { key });
      const [agentId, sessionId] = key.split(":");
      // Unpin first, then remove tab from local state
      unpinSession(key);
      removeTab(key);
      // Notify extension to actually close the session and release resources.
      // Without this, the session lingers in the extension host and gets
      // re-added to tabOrder on the next sessionInfoMap / tab sync.
      getVsCodeApi().postMessage({ type: "closeSession", sessionId, agentId });
    },
    [unpinSession, removeTab, log],
  );

  const handleLayoutChange = useCallback(
    (mode: "single" | "split" | "grid") => {
      log.info("layout mode change", { mode });
      setLayoutMode(mode);
    },
    [setLayoutMode, log],
  );

  const focusKey = activeSessionKey;

  // ── Scroll refs — shared across all sections ───────────────────────
  const scrollToMessageRef = useRef<((id: string) => void) | undefined>(undefined);
  const forceScrollToBottomRef = useRef<(() => void) | undefined>(undefined);
  const scrollToUnreadRef = useRef<(() => void) | undefined>(undefined);

  return (
    <div className={`unified-chat-panel unified-chat-panel--${layoutMode}`}>
      {/* Session bar (includes layout toggle + new session button) */}
      <UnifiedSessionBar
        tabs={tabs}
        activeSessionKey={activeSessionKey}
        pinnedSessionKeys={pinnedSessionKeys}
        connectedAgents={connectedAgents}
        onFocusChange={handleFocusChange}
        onClose={handleClose}
        onNewSession={onNewSession}
        layoutMode={layoutMode}
        splitDirection={splitDirection}
        onLayoutChange={handleLayoutChange}
        onSplitDirectionChange={setSplitDirection}
      />

      {/* Multi-session view */}
      <MultiSessionView
        focusKey={focusKey}
        pinnedKeys={pinnedSessionKeys}
        layoutMode={layoutMode}
        splitDirection={splitDirection}
        splitRatios={splitRatios}
        onFocusChange={handleFocusChange}
        onPin={handlePin}
        onUnpin={handleUnpin}
        onClose={handleClose}
        onSplitRatiosChange={setSplitRatios}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
        scrollToUnreadRef={scrollToUnreadRef}
      />

      {/* Command Center — between chat view and Composer */}
      <CommandCenter
        selectedSessionKey={commandCenterSelectedKey}
        onSelectSession={(agentId, sessionId) => {
          const key = sessionKeyOf(agentId, sessionId);
          setCommandCenterSelectedKey(key);
          handleFocusChange(key);
        }}
      />

      {/* Composer */}
      <Composer
        onSend={onSendMessage}
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
