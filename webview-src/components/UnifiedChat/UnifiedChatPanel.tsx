import React, { useCallback, useMemo } from "react";
import { useShallow } from "zustand/shallow";
import {
  useSessionStore,
  sessionKeyOf,
} from "../../store/sessionStore";
import type { SessionStoreState, SessionTabState } from "../../store/sessionStore";
import { useLogger } from "../../hooks/useLogger";
import { SessionChips } from "./SessionChips";
import { MultiSessionView } from "./MultiSessionView";
import { Composer } from "../Composer";

export interface UnifiedChatPanelProps {
  onSendMessage: (
    text: string,
    attachments: import("../../types").ContextAttachment[],
    targets?: import("../../types").SendTarget[]
  ) => void;
  onCancel: () => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
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
    }))
  );

  log.debug("render", {
    disabled,
    status,
    layoutMode,
    splitDirection,
  });

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

  // Build session chip data from tabs (structural only — no sessionInfoMap).
  // Status is read imperatively; live status rendering is handled by each
  // SessionChips consumer via useSessionInfo if needed.
  const sessionChips = useMemo(
    () =>
      tabs.map((tab: SessionTabState) => {
        const agent = connectedAgents.find((a) => a.agentId === tab.agentId);
        return {
          key: sessionKeyOf(tab.agentId, tab.sessionId),
          agentId: tab.agentId,
          title: tab.title ?? tab.sessionId.slice(0, 8),
          status: "idle" as const,
          color: agent?.color ?? "#0e639c",
          unreadCount: 0,
        };
      }),
    [tabs, connectedAgents],
  );

  const handleFocusChange = useCallback(
    (key: string) => {
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
      // Unpin first, then remove tab
      unpinSession(key);
      useSessionStore.getState().removeTab(key);
    },
    [unpinSession, log],
  );

  const handleLayoutChange = useCallback(
    (mode: "single" | "split" | "grid") => {
      log.info("layout mode change", { mode });
      setLayoutMode(mode);
    },
    [setLayoutMode, log],
  );

  const handleAddSession = useCallback(
    (key: string) => {
      log.info("add session to view", { key });
      pinSession(key);
      setFocusSession(key);
    },
    [pinSession, setFocusSession, log],
  );

  const focusKey = activeSessionKey;

  return (
    <div className={`unified-chat-panel unified-chat-panel--${layoutMode}`}>
      {/* Session chips bar */}
      <SessionChips
        sessions={sessionChips}
        activeSessionKey={activeSessionKey}
        onSelect={handleFocusChange}
        onAdd={handleAddSession}
      />

      {/* Layout mode toggle */}
      <div className="unified-layout-toggle">
        <button
          className={`unified-layout-btn${layoutMode === "single" ? " unified-layout-btn--active" : ""}`}
          onClick={() => handleLayoutChange("single")}
          title="Single view"
          type="button"
        >
          Single
        </button>
        <button
          className={`unified-layout-btn${layoutMode === "split" ? " unified-layout-btn--active" : ""}`}
          onClick={() => handleLayoutChange("split")}
          title="Split view"
          type="button"
        >
          Split
        </button>
        <button
          className={`unified-layout-btn${layoutMode === "grid" ? " unified-layout-btn--active" : ""}`}
          onClick={() => handleLayoutChange("grid")}
          title="Grid view"
          type="button"
        >
          Grid
        </button>
      </div>

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
        onSplitDirectionChange={setSplitDirection}
      />

      {/* Composer */}
      <Composer
        onSend={onSendMessage}
        onCancel={onCancel}
        onSwitchSession={onSwitchSession}
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
