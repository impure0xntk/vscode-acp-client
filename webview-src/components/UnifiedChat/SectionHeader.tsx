import React from "react";
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
  onClick: () => void;
}

export const SectionHeader = React.memo(function SectionHeader({
  agentId,
  title,
  status,
  color,
  isStreaming,
  isTurnActive,
  messageCount,
  isActive,
  onClick,
}: SectionHeaderProps): React.ReactElement {
  return (
    <button
      className={`unified-section-header${isActive ? " unified-section-header--active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span
        className="unified-section-header-bar"
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
      </span>
    </button>
  );
});
