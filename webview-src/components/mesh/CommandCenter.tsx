import React, { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "../../store/sessionStore";
import type { SessionStoreState } from "../../store/sessionStore";
import { AgentCard } from "./AgentCard";
import { Icon } from "../../lib/icons";
import { fmt } from "../sessions/toolbar/formatting";
import { getVsCodeApi } from "../../lib/vscodeApi";

export interface CommandCenterProps {
  /** Currently selected session key (agentId:sessionId) — controlled by parent */
  selectedSessionKey?: string | null;
  /** Callback when a card is selected — parent switches the active session */
  onSelectSession: (agentId: string, sessionId: string) => void;
}

export const CommandCenter = React.memo(function CommandCenter({
  selectedSessionKey,
  onSelectSession,
}: CommandCenterProps): React.ReactElement | null {
  const {
    sessionInfoMap,
    connectedAgents,
    commandCenterExpanded,
    commandCenterSelectedKey,
    toggleCommandCenter,
    setCommandCenterSelectedKey,
  } = useSessionStore(
    useShallow((s: SessionStoreState) => ({
      sessionInfoMap: s.sessionInfoMap,
      connectedAgents: s.connectedAgents,
      commandCenterExpanded: s.commandCenterExpanded,
      commandCenterSelectedKey: s.commandCenterSelectedKey,
      toggleCommandCenter: s.toggleCommandCenter,
      setCommandCenterSelectedKey: s.setCommandCenterSelectedKey,
    }))
  );

  const entries = Object.entries(sessionInfoMap);
  if (entries.length === 0) return null;

  const totalTokens = entries.reduce(
    (sum, [, info]) => sum + info.tokenUsage.totalTokens,
    0
  );

  const agentMap = new Map(connectedAgents.map((a) => [a.agentId, a]));

  const handleSelect = useCallback(
    (agentId: string, sessionId: string) => {
      const key = `${agentId}:${sessionId}`;
      setCommandCenterSelectedKey(key);
      onSelectSession(agentId, sessionId);
    },
    [onSelectSession, setCommandCenterSelectedKey]
  );

  const handleCancel = useCallback((agentId: string, sessionId: string) => {
    getVsCodeApi().postMessage({ type: "cancelTurn", agentId, sessionId });
  }, []);

  const handleClose = useCallback((agentId: string, sessionId: string) => {
    getVsCodeApi().postMessage({ type: "closeSession", agentId, sessionId });
  }, []);

  return (
    <div
      className="flex flex-col flex-shrink-0"
    >
      {/* Toggle bar */}
      <button
        className="flex items-center gap-1.5 w-full py-1.5 px-3.5 border-none bg-transparent text-[var(--fg-muted)] text-[11px] cursor-pointer text-left hover:bg-[var(--accent-hover)] hover:text-[var(--fg-primary)] focus-visible:outline focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-1px]"
        onClick={toggleCommandCenter}
        type="button"
        aria-expanded={commandCenterExpanded}
      >
        <Icon name="layout-grid" size="sm" />
        <span className="flex-1 font-medium">Command Center</span>
        <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-[7px] bg-[var(--bg-input)] text-[var(--fg-secondary)] text-[10px] font-semibold font-mono">{entries.length}</span>
        <Icon
          name="chevron-down"
          size="sm"
          className={`transition-transform duration-150${commandCenterExpanded ? " rotate-180" : ""}`}
        />
      </button>

      {/* Card strip — horizontal scroll */}
      <div
        className={`collapsible ${commandCenterExpanded ? "collapsible--open" : ""}`}
      >
        <div className="collapsible-body">
          <div className="px-2 pb-1">
            <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-thin">
              {entries.map(([key, info]) => {
                const agent = agentMap.get(info.agentId);
                return (
                  <AgentCard
                    key={key}
                    sessionInfo={info}
                    agent={agent}
                    isSelected={key === commandCenterSelectedKey}
                    onSelect={() => handleSelect(info.agentId, info.sessionId)}
                    onCancel={() => handleCancel(info.agentId, info.sessionId)}
                    onClose={() => handleClose(info.agentId, info.sessionId)}
                  />
                );
              })}
            </div>

            {/* Summary row */}
            <div className="flex items-center justify-end py-0.5 px-1 border-t border-[color-mix(in_srgb,var(--border)_40%,transparent)]">
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--fg-muted)] font-mono">
                <Icon name="brain" size="sm" />
                Total: {fmt(totalTokens)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
