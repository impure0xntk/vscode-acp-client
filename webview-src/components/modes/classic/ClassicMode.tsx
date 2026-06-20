import React, {
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
} from "react";
import { useShallow } from "zustand/shallow";
import { SessionView } from "../../sessions/SessionView";
import { SessionFooter } from "../../sessions/SessionFooter";
import { SessionTabBar } from "../../sessions/SessionTabBar";
import { Composer } from "../../composer/Composer";
import { useSessionStore, sessionKeyOf } from "../../../store/sessionStore";
import type {
  SessionStoreState,
  SlashCommand,
} from "../../../store/sessionStore";
import { useMessageStore } from "../../../store/messageStore";
import { selectMessageCount } from "../../../store/selectors";
import type {
  ContextAttachment,
  QueuedPrompt,
  SendTarget,
  FileCandidate,
  SuggestionItem,
} from "../../../types";
import type { TurnOutcome } from "../../primitives/StatusIcon";

export interface ClassicModeProps {
  activeSessionKey: string | null;
  disabled: boolean;
  onSend: (
    text: string,
    attachments: ContextAttachment[],
    targets?: SendTarget[],
    mode?: import("../../../types").CommunicationMode | null,
    teamId?: string
  ) => void;
  onCancel: () => void;
  onSwitchSession: (agentId: string, sessionId: string) => void;
  onRenameSession?: (agentId: string, sessionId: string, title: string) => void;
  onNewSession: () => void;
  fetchFiles: (query: string, cwd?: string) => Promise<FileCandidate[]>;
  resolveFile: (path: string) => Promise<ContextAttachment>;
  resolveSelection: () => Promise<ContextAttachment | null>;
  resolveDiff: () => Promise<ContextAttachment | null>;
  fetchSymbols: (query: string) => Promise<SuggestionItem[]>;
  resolveSymbol: (name: string) => Promise<ContextAttachment>;
  availableCommands: SlashCommand[];
  scrollToMessageRef?: React.MutableRefObject<
    ((id: string) => void) | undefined
  >;
  onCancelQueuedPrompt?: (agentId: string, sessionId: string, promptId: string) => void;
  onClearQueue?: (agentId: string, sessionId: string) => void;
}

export const ClassicMode = React.memo(function ClassicMode({
  activeSessionKey,
  disabled,
  onSend,
  onCancel,
  onSwitchSession,
  onRenameSession,
  onNewSession,
  fetchFiles,
  resolveFile,
  resolveSelection,
  resolveDiff,
  fetchSymbols,
  resolveSymbol,
  availableCommands,
  scrollToMessageRef,
  onCancelQueuedPrompt,
  onClearQueue,
}: ClassicModeProps): React.ReactElement {
  const {
    tabOrder,
    tabTitles,
    tabIcons,
    connectedAgents,
    agentInfoMap,
    sessionInfoMap,
    statusline,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      tabOrder: s.tabOrder,
      tabTitles: s.tabTitles,
      tabIcons: s.tabIcons,
      connectedAgents: s.connectedAgents,
      agentInfoMap: s.agentInfoMap,
      sessionInfoMap: s.sessionInfoMap,
      statusline: s.statusline,
    }))
  );

  const forceScrollToBottomRef = useRef<() => void>();

  // Derive tabs from tabOrder
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

  // Derive active session info
  const activeSessionInfo = activeSessionKey
    ? sessionInfoMap[activeSessionKey]
    : undefined;

  const activeSessionId = activeSessionKey?.split(":")[1] ?? null;
  const activeAgentId = activeSessionKey?.split(":")[0] ?? null;

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
  const displayMessageCount = activeSessionKey
    ? selectMessageCount(
        useMessageStore.getState(),
        activeSessionKey.split(":")[0],
        activeSessionKey.split(":")[1]
      )
    : 0;
  const displaySessionStartMs = activeSessionInfo?.createdAt
    ? new Date(activeSessionInfo.createdAt).getTime()
    : undefined;
  const displayLastTurnOutcome = activeSessionInfo?.lastTurnOutcome ?? null;
  const displayLastResponseAt = activeSessionInfo?.lastResponseAt ?? null;

  // Queue for the active session
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const sessionQueue: QueuedPrompt[] = activeSessionKey
    ? promptQueue[activeSessionKey] ?? []
    : [];

  // Overview items map
  const overviewItemsMap = useMemo(() => {
    const acc: Record<string, import("../../../types").SessionOverviewItem> =
      {};
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

  const handleTabClick = useCallback(
    (sessionKey: string) => {
      const [agentId, sessionId] = sessionKey.split(":");
      onSwitchSession(agentId, sessionId);
    },
    [onSwitchSession]
  );

  const handleTabClose = useCallback((sessionKey: string) => {
    const [agentId, sessionId] = sessionKey.split(":");
    useSessionStore.getState().removeTab(sessionKey);
    const vscode = (window as any).acquireVsCodeApi?.();
    vscode?.postMessage({ type: "closeSession", sessionId, agentId });
  }, []);

  const handleTabReorder = useCallback((newTabs: typeof tabs) => {
    const order = newTabs.map((t) => sessionKeyOf(t.agentId, t.sessionId));
    useSessionStore.getState().setTabOrder(order);
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden h-full">
      <SessionTabBar
        tabs={tabs}
        activeSessionKey={activeSessionKey}
        connectedAgents={connectedAgents}
        overviewItems={overviewItemsMap}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabReorder={handleTabReorder}
        onNewSession={onNewSession}
        onRenameSession={onRenameSession}
      />
      <SessionView
        sessionKey={activeSessionKey}
        layoutMode="single"
        disabled={disabled}
        onSend={onSend}
        onCancel={onCancel}
        scrollToMessageRef={scrollToMessageRef}
        forceScrollToBottomRef={forceScrollToBottomRef}
      />
      <SessionFooter
        model={displayModel}
        mode={displayMode}
        tokenUsage={displayTokenUsage}
        contextWindowMax={displayContextWindowMax}
        messageCount={displayMessageCount}
        sessionStatus={displayStatus}
        agentInfo={activeAgentId ? agentInfoMap[activeAgentId] : undefined}
        sessionId={activeSessionId ?? undefined}
        sessionStartMs={displaySessionStartMs}
        statusline={statusline}
        cwd={displayCwd}
        lastTurnOutcome={displayLastTurnOutcome}
        lastResponseAt={displayLastResponseAt}
      />
      <Composer
        onSend={onSend}
        onCancel={onCancel}
        onSwitchSession={onSwitchSession}
        onRenameSession={onRenameSession}
        disabled={disabled}
        status={displayStatus}
        fetchFiles={fetchFiles}
        resolveFile={resolveFile}
        resolveSelection={resolveSelection}
        resolveDiff={resolveDiff}
        fetchSymbols={fetchSymbols}
        resolveSymbol={resolveSymbol}
        availableCommands={availableCommands}
        queue={sessionQueue}
        onSendNow={(promptId) => {
          const entry = sessionQueue.find((e) => e.id === promptId);
          if (!entry) return;
          if (onCancelQueuedPrompt) {
            onCancelQueuedPrompt(entry.agentId, entry.sessionId, promptId);
          }
          onSend(entry.text, entry.attachments ?? []);
          if (activeSessionKey) {
            useSessionStore.getState().removeQueuedPrompt(activeSessionKey, promptId);
          }
        }}
        onRemoveQueueItem={(promptId) => {
          if (activeSessionKey) {
            const [agentId, sessionId] = activeSessionKey.split(":");
            onCancelQueuedPrompt?.(agentId, sessionId, promptId);
            useSessionStore.getState().removeQueuedPrompt(activeSessionKey, promptId);
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
