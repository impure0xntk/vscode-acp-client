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
      className={`command-center${commandCenterExpanded ? " command-center--expanded" : ""}`}
    >
      {/* Toggle bar */}
      <button
        className="command-center-toggle"
        onClick={toggleCommandCenter}
        type="button"
        aria-expanded={commandCenterExpanded}
      >
        <Icon name="layout-grid" size="sm" />
        <span className="command-center-toggle-label">Command Center</span>
        <span className="command-center-toggle-count">{entries.length}</span>
        <Icon
          name="chevron-down"
          size="sm"
          className={`command-center-toggle-chevron${commandCenterExpanded ? " command-center-toggle-chevron--open" : ""}`}
        />
      </button>

      {/* Card strip — horizontal scroll */}
      {commandCenterExpanded && (
        <div className="command-center-body">
          <div className="command-center-cards">
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
          <div className="command-center-summary">
            <span className="command-center-summary-tokens">
              <Icon name="brain" size="sm" />
              Total: {fmt(totalTokens)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
