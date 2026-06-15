import React, { useCallback } from "react";
import { useLogger } from "../../hooks/useLogger";
import { StatusIcon } from "../StatusIcon";

export interface SectionHeaderProps {
  sessionKey: string;
  agentId: string;
  title: string;
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  color: string;
  isStreaming: boolean;
  isTurnActive: boolean;
  messageCount: number;
  isActive: boolean;
  isPinned: boolean;
  onClick: () => void;
  onTogglePin: () => void;
}

export const SectionHeader = React.memo(function SectionHeader({
  sessionKey,
  agentId,
  title,
  status,
  color,
  isStreaming,
  isTurnActive,
  messageCount,
  isActive,
  isPinned,
  onClick,
  onTogglePin,
}: SectionHeaderProps): React.ReactElement {
  const log = useLogger("SectionHeader");

  const handleClick = useCallback(() => {
    log.debug("header click", { sessionKey, agentId, isActive });
    onClick();
  }, [onClick, log, sessionKey, agentId, isActive]);

  const handleTogglePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      log.debug("pin toggle", { sessionKey, isPinned: !isPinned });
      onTogglePin();
    },
    [onTogglePin, log, sessionKey, isPinned],
  );

  log.debug("render", { sessionKey, agentId, status, isActive, isPinned, messageCount });

  return (
    <div
      className={`unified-section-header${isActive ? " unified-section-header--active" : ""}`}
    >
      <button
        className="unified-section-header-bar"
        onClick={handleClick}
        type="button"
        style={{
          borderLeftColor: color,
          backgroundColor: `${color}14`,
        }}
      >
        <span className="unified-section-header-agent">{agentId}</span>
        <StatusIcon status={status} size="sm" />
        <span className="unified-section-header-title">{title}</span>
        {isStreaming && (
          <span className="unified-section-header-streaming">streaming</span>
        )}
        {isTurnActive && (
          <span className="unified-section-header-turn">turn</span>
        )}
        <span className="unified-section-header-count">({messageCount})</span>
      </button>
      <button
        className={`unified-section-header-pin${isPinned ? " unified-section-header-pin--active" : ""}`}
        onClick={handleTogglePin}
        type="button"
        title={isPinned ? "Unpin session" : "Pin session"}
      >
        {isPinned ? "📌" : "📍"}
      </button>
    </div>
  );
});
